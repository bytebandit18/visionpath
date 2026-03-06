import { NextRequest, NextResponse } from "next/server";
import { retryWithBackoff } from "../../../lib/retry";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        // Proxy the request to the Node.js Express backend with retry/backoff
        let backendUrl = "http://127.0.0.1:5001/detect";

        const doFetch = async (url: string) => {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const text = await res.text();
                const err: any = new Error(`Backend error: ${res.status}`);
                err.status = res.status;
                err.details = text;
                throw err;
            }
            return res.json();
        };

        let data;
        try {
            data = await retryWithBackoff(() => doFetch(backendUrl), Number(process.env.RETRY_ATTEMPTS_BACKEND || 5), Number(process.env.RETRY_BASE_DELAY_BACKEND || 800));
        } catch (firstErr) {
            // Try localhost fallback once if 127.0.0.1 failed
            console.warn("Primary backend failed, retrying with localhost fallback", String(firstErr));
            backendUrl = "http://localhost:5001/detect";
            data = await retryWithBackoff(() => doFetch(backendUrl), Number(process.env.RETRY_ATTEMPTS_BACKEND_FALLBACK || 3), Number(process.env.RETRY_BASE_DELAY_BACKEND || 800));
        }

        return NextResponse.json(data);
    } catch (error: any) {
        console.error("Error connecting to detection backend:", error);
        const details = error?.details || error?.message || String(error);
        const status = error?.status && Number(error.status) || 500;
        return NextResponse.json(
            { error: "Failed to connect to backend", details },
            { status }
        );
    }
}
