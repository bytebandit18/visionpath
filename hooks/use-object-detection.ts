import { useState, useEffect, useRef, useCallback } from 'react';

export interface DetectedObject {
    class: string;
    score: number;
    bbox: [number, number, number, number];
    position?: "left" | "right" | "center";
    estimatedDistanceMeters?: number;
    estimatedSteps?: number;
}

interface UseObjectDetectionProps {
    isNavigating: boolean;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    invokeIntervalMs?: number;
    onDetect?: (objects: DetectedObject[]) => void;
    onDescribeScene?: (description: string) => void;
}

const AVERAGE_HEIGHTS: Record<string, number> = {
    person: 1.7, man: 1.7, woman: 1.6, boy: 1.4, girl: 1.3, human: 1.6,
    chair: 0.9, table: 0.8, desk: 0.8,
    sofa: 0.9, couch: 0.9, bed: 0.6, door: 2.0, window: 1.5,
    laptop: 0.2, computer: 0.4, monitor: 0.4, tv: 0.6, television: 0.6,
    speaker: 0.3, socket: 0.1, 'power socket': 0.1, switch: 0.1,
    phone: 0.15, 'cell phone': 0.15, mobile: 0.15, bottle: 0.25,
    cup: 0.1, glass: 0.15, mug: 0.1,
    car: 1.5, truck: 3.5, bus: 3.0, motorcycle: 1.2, bicycle: 1.0,
    tree: 3.0, plant: 0.5, bag: 0.5, backpack: 0.5, box: 0.4,
    cat: 0.3, dog: 0.6, wall: 2.5,
};

export function useObjectDetection({
    isNavigating,
    videoRef,
    invokeIntervalMs = 500,
    onDetect,
    onDescribeScene,
}: UseObjectDetectionProps) {
    const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);

    // Request gate — only one API call in-flight at a time
    const isRequestInFlightRef = useRef(false);
    // How long to wait before next call (increases on rate limit)
    const nextCallDelayMs = useRef(4000);
    const lastCallTimeRef = useRef(0);

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const onDetectRef = useRef(onDetect);
    const onDescribeSceneRef = useRef(onDescribeScene);
    const distanceHistoryRef = useRef<Record<string, number[]>>({});

    useEffect(() => { onDetectRef.current = onDetect; }, [onDetect]);
    useEffect(() => { onDescribeSceneRef.current = onDescribeScene; }, [onDescribeScene]);

    useEffect(() => {
        if (!canvasRef.current) {
            canvasRef.current = document.createElement('canvas');
        }
    }, []);

    const captureFrameBase64 = useCallback((): string | null => {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || video.videoWidth === 0) return null;

        const canvas = canvasRef.current;
        if (!canvas) return null;

        // Scale down for faster encoding and lower API payload
        const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.floor(video.videoWidth * scale);
        canvas.height = Math.floor(video.videoHeight * scale);

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.7);
    }, [videoRef]);

    const runDetection = useCallback(async () => {
        if (!isNavigating || isRequestInFlightRef.current) return;

        const now = Date.now();
        if (now - lastCallTimeRef.current < nextCallDelayMs.current) return;

        const base64Image = captureFrameBase64();
        if (!base64Image) {
            console.log('[SCAN] Frame not ready yet, skipping...');
            return;
        }

        isRequestInFlightRef.current = true;
        lastCallTimeRef.current = now;

        console.log('[SCAN] Sending frame to /api/describe (detect mode)...');

        try {
            const res = await fetch('/api/describe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Image, mode: 'detect' }),
            });

            if (res.status === 429) {
                console.warn('[SCAN] Rate limited — backing off 30s');
                nextCallDelayMs.current = 30000;
                setDetectedObjects([]);
                // Gradually recover after backoff period
                setTimeout(() => {
                    if (nextCallDelayMs.current > 4000) nextCallDelayMs.current = 10000;
                }, 30000);
                return;
            }

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                console.error('[SCAN] API error:', res.status, errData);
                nextCallDelayMs.current = 6000;
                return;
            }

            const data = await res.json();
            console.log('[SCAN] Raw response:', String(data.result || '').substring(0, 120));

            // Reset delay on success
            nextCallDelayMs.current = 4000;

            const rawResult: string = data.result || '';
            if (!rawResult || rawResult.toLowerCase().includes('nothing clear')) {
                setDetectedObjects([]);
                return;
            }

            // Parse JSON — strip any markdown code fences if present
            let jsonStr = rawResult.trim();
            const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (fenceMatch) jsonStr = fenceMatch[1].trim();

            // Find the first '[' in case there's prefix text
            const arrayStart = jsonStr.indexOf('[');
            if (arrayStart > 0) jsonStr = jsonStr.slice(arrayStart);

            let items: any[] = [];
            try {
                items = JSON.parse(jsonStr);
            } catch (e) {
                console.warn('[SCAN] Failed to parse JSON:', e, jsonStr.substring(0, 200));
                return;
            }

            if (!Array.isArray(items) || items.length === 0) {
                setDetectedObjects([]);
                return;
            }

            const video = videoRef.current;
            if (!video) return;

            // Estimate focal length from video dimensions assuming ~60° vertical FOV
            // (common for mobile phone cameras). f = h / (2 * tan(vfov/2))
            const vfovRad = (60 * Math.PI) / 180
            const focalLength = video.videoHeight / (2 * Math.tan(vfovRad / 2));

            const enhanced: DetectedObject[] = items
                .filter((item: any) => item && item.class && Array.isArray(item.bbox) && item.bbox.length === 4)
                .map((item: any) => {
                    const label = String(item.class).toLowerCase();

                    // Skip lights/ceiling items
                    if (/light|lamp|bulb|ceiling|fixture/i.test(label)) return null;

                    // bbox from API: [ymin, xmin, ymax, xmax] normalized 0-1000
                    const ymin = (item.bbox[0] / 1000) * video.videoHeight;
                    const xmin = (item.bbox[1] / 1000) * video.videoWidth;
                    const ymax = (item.bbox[2] / 1000) * video.videoHeight;
                    const xmax = (item.bbox[3] / 1000) * video.videoWidth;

                    const bboxWidth = xmax - xmin;
                    const bboxHeight = ymax - ymin;

                    // Estimate distance
                    let realHeight = 0.4;
                    for (const key in AVERAGE_HEIGHTS) {
                        if (label.includes(key)) { realHeight = AVERAGE_HEIGHTS[key]; break; }
                    }

                    const distanceM = bboxHeight > 0 ? (realHeight * focalLength) / bboxHeight : 99;
                    let rawSteps = Math.min(30, Math.max(1, Math.round(distanceM / 0.762)));

                    if (!distanceHistoryRef.current[label]) distanceHistoryRef.current[label] = [];
                    const history = distanceHistoryRef.current[label];
                    history.push(rawSteps);
                    if (history.length > 3) history.shift();
                    const smoothedSteps = Math.round(history.reduce((a, b) => a + b, 0) / history.length);

                    const centerX = xmin + bboxWidth / 2;
                    let position: "left" | "right" | "center" = "center";
                    if (centerX < video.videoWidth / 3) position = "left";
                    else if (centerX > video.videoWidth * (2 / 3)) position = "right";

                    return {
                        class: label,
                        score: item.score ?? 0.85,
                        bbox: [xmin, ymin, bboxWidth, bboxHeight] as [number, number, number, number],
                        position,
                        estimatedDistanceMeters: smoothedSteps * 0.76,
                        estimatedSteps: smoothedSteps,
                    };
                })
                .filter(Boolean) as DetectedObject[];

            console.log(`[SCAN] Detected ${enhanced.length} objects`);
            setDetectedObjects(enhanced);

            if (onDetectRef.current && enhanced.length > 0) {
                onDetectRef.current(enhanced);
            }

        } catch (err) {
            console.error('[SCAN] Fetch error:', String(err));
            nextCallDelayMs.current = 6000;
        } finally {
            isRequestInFlightRef.current = false;
        }
    }, [isNavigating, captureFrameBase64, videoRef]);

    useEffect(() => {
        if (!isNavigating) {
            setDetectedObjects([]);
            isRequestInFlightRef.current = false;
            nextCallDelayMs.current = 4000;
            lastCallTimeRef.current = 0;
            distanceHistoryRef.current = {};
            return;
        }

        // Poll rapidly; the time-gating inside runDetection controls actual API call frequency
        const id = setInterval(runDetection, invokeIntervalMs);
        return () => clearInterval(id);
    }, [isNavigating, invokeIntervalMs, runDetection]);

    return { detectedObjects };
}
