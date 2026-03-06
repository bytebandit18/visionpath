import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, createPartFromBase64 } from "@google/genai";

export async function POST(req: NextRequest) {
    try {
        const { image } = await req.json();

        if (!image) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
        }

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        const base64Data = image.includes(',') ? image.split(',')[1] : image;
        const imagePart = createPartFromBase64(base64Data, "image/jpeg");

        const prompt = `You are an expert Indian currency identifier.
Look at the image and identify any Indian Rupee note or coin.
Respond with ONLY the denomination in plain words, e.g. "Ten Rupee Note" or "Five Rupee Coin".
Valid responses: One Rupee Coin, Two Rupee Coin, Five Rupee Coin, Ten Rupee Coin, Twenty Rupee Coin, Ten Rupee Note, Twenty Rupee Note, Fifty Rupee Note, One Hundred Rupee Note, Two Hundred Rupee Note, Five Hundred Rupee Note.
If no currency is clearly visible, respond ONLY with: No currency detected.`;

        const response = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: [
                { role: "user", parts: [{ text: prompt }, imagePart] }
            ]
        });

        const text = response.text ?? "No currency detected.";
        return NextResponse.json({ result: text });

    } catch (error: any) {
        const errMsg = String(error?.message || error || '');
        console.error("[/api/currency] Error:", errMsg);
        if (/rate.?limit|quota|429/i.test(errMsg) || error?.status === 429) {
            return NextResponse.json({ error: "Rate limit exceeded", details: errMsg }, { status: 429 });
        }
        return NextResponse.json({ error: "Failed to detect currency", details: errMsg }, { status: 500 });
    }
}
