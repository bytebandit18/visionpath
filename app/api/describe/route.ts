import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { retryWithBackoff } from "../../../lib/retry";

export async function POST(req: NextRequest) {
    try {
        const { image, mode = 'describe' } = await req.json();

        if (!image) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json({ error: "GEMINI_API_KEY is not configured in the environment." }, { status: 500 });
        }

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        const base64Data = image.includes(',') ? image.split(',')[1] : image;

        const prompt = mode === 'detect'
            ? `Return a JSON array of up to 5 main objects (such as person, chair, table, door, laptop) visible in the image. Use standard generic labels (e.g., use "person" instead of "man" or "woman"). DO NOT include "ceiling light", "light", "lamp", or "bulb" in your detected objects. Ignore all lighting fixtures. For each object, include "class" and "bbox" (array of [ymin, xmin, ymax, xmax] normalized from 0 to 1000). Return ONLY the raw JSON array without any markdown formatting or code blocks.`
            : `You are an accessibility assistant helping a visually impaired user navigate an indoor environment.
Describe the main objects visible in this image in a very concise, comma-separated list.
Focus on obstacles, furniture, architectural features, and everyday items (e.g., "laptop, speaker, wooden table, window on the right, open door").
Do not include ceiling lights or lighting fixtures in your description.
Do not write full sentences. Do not use conversational filler. Just list the objects and their general position if relevant.
Keep it under 15 words if possible.
If the image is completely blurry or you cannot distinguish anything, respond with "Nothing clear detected".`;

        // Use retry/backoff for transient errors such as rate limits or quota issues
        const response = await retryWithBackoff(() => ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
                prompt,
                {
                    inlineData: {
                        data: base64Data,
                        mimeType: "image/jpeg"
                    }
                }
            ]
        }), Number(process.env.RETRY_ATTEMPTS || 6), Number(process.env.RETRY_BASE_DELAY || 1000));

        const text = (response as any).text || "Nothing clear detected.";

        return NextResponse.json({ result: text });
    } catch (error: any) {
        console.error("Error describing environment:", error);
        console.error("Error details:", error?.message, error?.stack);

        // If the underlying error looks like a rate-limit, propagate 429 so clients can back off
        const errMsg = String(error?.message || error || '');
        if (/rate limit|quota|429/i.test(errMsg) || error?.status === 429) {
            return NextResponse.json({ error: "Rate limit or quota exceeded", details: errMsg }, { status: 429 });
        }

        return NextResponse.json({ error: "Failed to describe environment", details: error?.message || String(error) }, { status: 500 });
    }
}
