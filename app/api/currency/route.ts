import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { retryWithBackoff } from "../../../lib/retry";

// Move instantiation down so Next.js doesn't crash on boot if the key is missing

export async function POST(req: NextRequest) {
    try {
        const { image } = await req.json();

        if (!image) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json({ error: "GEMINI_API_KEY is not configured in the environment." }, { status: 500 });
        }

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        const base64Data = image.includes(',') ? image.split(',')[1] : image;

        const prompt = `
You are an expert currency identifier, specifically for Indian Rupees (INR).
Your task is to analyze the provided image and state exactly what currency note or coin is visible. 
Do not provide a long explanation or detail what else is in the image.
If there is a clearly visible Indian Rupee note or coin, respond with ONLY the denomination in words.
Examples of valid responses: "One Rupee Coin", "Two Rupee Coin", "Five Rupee Coin", "Ten Rupee Coin", "Twenty Rupee Coin", "Ten Rupee Note", "Twenty Rupee Note", "Fifty Rupee Note", "One Hundred Rupee Note", "Two Hundred Rupee Note", "Five Hundred Rupee Note".
If you do not see any currency, or if it is too blurry to identify, respond ONLY with "No currency detected."
`;

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

        const text = (response as any).text || "No currency detected.";

        return NextResponse.json({ result: text });
    } catch (error: any) {
        console.error("Error detecting currency:", error);
        const errMsg = String(error?.message || error || '');
        if (/rate limit|quota|429/i.test(errMsg) || error?.status === 429) {
            return NextResponse.json({ error: "Rate limit or quota exceeded", details: errMsg }, { status: 429 });
        }
        return NextResponse.json({ error: "Failed to detect currency" }, { status: 500 });
    }
}
