import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, createPartFromBase64 } from "@google/genai";

export async function POST(req: NextRequest) {
    try {
        const { image, mode = 'describe' } = await req.json();

        if (!image) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
        }

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        // Strip the data URI prefix if present
        const base64Data = image.includes(',') ? image.split(',')[1] : image;

        const prompt = mode === 'detect'
            ? `You are an object detection system for a visually impaired user. Look at this image and return a JSON array of up to 6 objects visible in the scene. Only include solid, real objects (e.g. person, chair, table, door, wall, laptop, bottle). Do NOT include lights, lamps, or ceiling fixtures. For each object include: "class" (a short lowercase label like "person"), "score" (confidence 0.0-1.0), and "bbox" ([ymin, xmin, ymax, xmax] normalized 0-1000). Return ONLY a raw JSON array, no markdown, no code blocks.`
            : `You are an accessibility assistant for a visually impaired user navigating indoors. In one concise comma-separated list (under 15 words), name the main objects, furniture, or obstacles visible. Do not include lights or ceiling fixtures. If nothing is clear, reply: Nothing clear detected.`;

        // Use the SDK's createPartFromBase64 helper for correct multimodal format
        const imagePart = createPartFromBase64(base64Data, "image/jpeg");

        const response = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: [
                { role: "user", parts: [{ text: prompt }, imagePart] }
            ]
        });

        const text = response.text ?? "Nothing clear detected.";

        return NextResponse.json({ result: text });

    } catch (error: any) {
        const errMsg = String(error?.message || error?.statusText || error || '');
        console.error("[/api/describe] Error:", errMsg);

        if (/rate.?limit|quota|429/i.test(errMsg) || error?.status === 429 || error?.code === 429) {
            return NextResponse.json({ error: "Rate limit exceeded", details: errMsg }, { status: 429 });
        }

        return NextResponse.json(
            { error: "Failed to process image", details: errMsg },
            { status: 500 }
        );
    }
}
