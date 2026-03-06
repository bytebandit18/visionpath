const { GoogleGenAI } = require('@google/genai');

async function test() {
    try {
        console.log("Key available:", !!process.env.GEMINI_API_KEY);
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: "Say hello world"
        });
        console.log("Success:", response.text);
    } catch (err) {
        console.error("SDK Error:");
        console.error(err);
    }
}
test();
