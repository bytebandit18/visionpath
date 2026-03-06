import { useState, useEffect, useRef, useCallback } from 'react';

export interface DetectedObject {
    class: string;
    score: number;
    bbox: [number, number, number, number];
    position?: "left" | "right" | "center";
}

interface UseObjectDetectionProps {
    isNavigating: boolean;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    invokeIntervalMs?: number;
    onDetect?: (objects: DetectedObject[]) => void;
    onDescribeScene?: (description: string) => void;
    speak?: (text: string, priority?: "polite" | "assertive") => void;
}

export function useObjectDetection({
    isNavigating,
    videoRef,
    invokeIntervalMs = 500,
    onDetect,
    onDescribeScene,
    speak
}: UseObjectDetectionProps) {
    const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
    const isProcessingRef = useRef(false);
    const isGeminiProcessingRef = useRef(false);
    const latestGeminiPredictionsRef = useRef<any[]>([]);
    const lastDescriptionTimeRef = useRef(0);
    const lastSpokeRateLimitRef = useRef(0);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const distanceHistoryRef = useRef<Record<string, number[]>>({});
    const onDetectRef = useRef(onDetect);
    const onDescribeSceneRef = useRef(onDescribeScene);

    useEffect(() => {
        onDetectRef.current = onDetect;
    }, [onDetect]);

    useEffect(() => {
        onDescribeSceneRef.current = onDescribeScene;
    }, [onDescribeScene]);

    useEffect(() => {
        // Create an off-screen canvas if it doesn't exist
        if (!canvasRef.current) {
            canvasRef.current = document.createElement('canvas');
        }
    }, []);

    const processFrame = useCallback(() => {
        if (!isNavigating || !videoRef.current || isProcessingRef.current) return;

        const video = videoRef.current;
        if (video.readyState < 2 || video.videoWidth === 0) return;

        isProcessingRef.current = true;
        const now = Date.now();

        try {
            const canvas = canvasRef.current;
            if (!canvas) return;

            // Downscale image to speed up drawing, base64 encoding and network transfer
            const scale = Math.min(1, 320 / video.videoWidth);
            const drawWidth = Math.floor(video.videoWidth * scale);
            const drawHeight = Math.floor(video.videoHeight * scale);

            canvas.width = drawWidth;
            canvas.height = drawHeight;

            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return;

            ctx.drawImage(video, 0, 0, drawWidth, drawHeight);

            // Fetch generic AI scene description every 25 seconds (if user callback provided)
            // Increased to 25 seconds to prevent hitting the 15 RPM overall limit
            if (onDescribeSceneRef.current && (now - lastDescriptionTimeRef.current > 25000)) {
                lastDescriptionTimeRef.current = now;
                // Run describe in background so it doesn't block the fast object detection loop
                const bgImage = canvas.toDataURL('image/jpeg', 0.6);
                fetch('/api/describe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: bgImage })
                })
                    .then(res => res.json())
                    .then(data => {
                        if (data.error) {
                            console.warn("Scene description API Error:", data.error);
                            return;
                        }
                        if (data.result && data.result !== "Nothing clear detected.") {
                            if (onDescribeSceneRef.current) {
                                onDescribeSceneRef.current(data.result);
                            }
                        }
                    })
                    .catch(err => console.warn("Scene description failed:", String(err)));
            }

            // Wall detection heuristic (using the downscaled image)
            // We sample a box in the center of the bottom third of the frame
            const boxWidth = Math.floor(drawWidth / 3);
            const boxHeight = Math.floor(drawHeight / 3);
            const startX = Math.floor((drawWidth / 2) - (boxWidth / 2));
            const startY = Math.floor(drawHeight * 0.6); // bottom part

            let wallPrediction = null;

            try {
                const sampleData = ctx.getImageData(startX, startY, boxWidth, boxHeight);
                const pixels = sampleData.data;
                let sumLuma = 0;
                let sumLumaSq = 0;
                let pixelCount = 0;

                // Check every 4th pixel to make it faster
                for (let i = 0; i < pixels.length; i += 16) {
                    const r = pixels[i];
                    const g = pixels[i + 1];
                    const b = pixels[i + 2];
                    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
                    sumLuma += luma;
                    sumLumaSq += luma * luma;
                    pixelCount++;
                }

                if (pixelCount > 0) {
                    const meanLuma = sumLuma / pixelCount;
                    const variance = (sumLumaSq / pixelCount) - (meanLuma * meanLuma);

                    // If the area is extremely uniform (low variance), we guess there's a flat wall close by
                    // Tightened threshold to 600 to prevent false positive walls on noisy surfaces
                    if (variance < 600) {
                        // Adjust step calculation to be more aggressive when variance is low
                        const estimatedSteps = Math.max(1, Math.floor(variance / 60));

                        // Need to scale the bbox back to the original video dimensions for consistency
                        wallPrediction = {
                            class: 'wall',
                            score: 0.85,
                            bbox: [0, Math.floor(startY / scale), video.videoWidth, Math.floor((drawHeight - startY) / scale)],
                            estimatedDistanceMeters: estimatedSteps * 0.76,
                            estimatedSteps: estimatedSteps,
                            position: "center"
                        };
                    }
                }
            } catch (err) {
                console.error("Variance check failed", err)
            }

            // AI Vision Object Detection via Gemini Proxy (Async background task)
            if (!isGeminiProcessingRef.current) {
                console.log("[SCAN] Starting new Gemini request...");
                isGeminiProcessingRef.current = true;
                const backendUrl = `/api/describe`;
                const base64Image = canvas.toDataURL('image/jpeg', 0.6); // Reduced quality for speed

                let hasRateLimitError = false;

                fetch(backendUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: base64Image, mode: 'detect' })
                })
                    .then(response => {
                        console.log("[SCAN] Received response status:", response.status);
                        if (response.status === 429) {
                            hasRateLimitError = true;
                        }
                        return response.json();
                    })
                    .then(data => {
                        if (data.error) {
                            console.warn("AI Backend Error:", data.error, data.details);
                            const errorStr = String(data.error).toLowerCase();
                            const detailsStr = String(data.details).toLowerCase();

                            if (errorStr.includes("quota") || detailsStr.includes("quota") ||
                                errorStr.includes("429") || detailsStr.includes("429") ||
                                errorStr.includes("rate limit") || hasRateLimitError) {
                                hasRateLimitError = true;
                                if (now - lastSpokeRateLimitRef.current > 60000) {
                                    // Removed voice alert for wait limit exceeded per user request
                                    lastSpokeRateLimitRef.current = now;
                                }
                            }

                            // Clear predictions so the UI doesn't freeze with stale boxes
                            latestGeminiPredictionsRef.current = [];
                            return; // Stop processing if backend returned an error
                        }

                        const rawResult = data.result || "";
                        console.log("[SCAN] Raw AI Result:", rawResult.substring(0, 100) + "...");

                        if (rawResult && rawResult !== "Nothing clear detected." && !rawResult.includes("Error")) {
                            try {
                                // Extract JSON if wrapped in markdown
                                let jsonStr = rawResult;
                                const match = rawResult.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                                if (match) {
                                    jsonStr = match[1];
                                }

                                const items = JSON.parse(jsonStr);
                                console.log("[SCAN] Parsed AI Items:", items.length);

                                if (Array.isArray(items)) {
                                    latestGeminiPredictionsRef.current = items.map((item: any) => {
                                        // item.bbox is [ymin, xmin, ymax, xmax] normalized 0 to 1000
                                        const ymin = (item.bbox[0] / 1000) * video.videoHeight;
                                        const xmin = (item.bbox[1] / 1000) * video.videoWidth;
                                        const ymax = (item.bbox[2] / 1000) * video.videoHeight;
                                        const xmax = (item.bbox[3] / 1000) * video.videoWidth;

                                        return {
                                            class: item.class ? item.class.toLowerCase() : 'unknown',
                                            score: item.score || 0.9,
                                            bbox: [xmin, ymin, xmax - xmin, ymax - ymin]
                                        };
                                    });
                                }
                            } catch (e) {
                                console.warn("Failed to parse Gemini detect JSON:", e, rawResult);
                            }
                        }
                    })
                    .catch(backendErr => {
                        // Keep error silently logged as string to avoid Next.js dev overlay intercepting the Error object
                        const errorString = String(backendErr);
                        console.warn("AI Vision request failed:", errorString);
                        // Do not lock onto old predictions if the API is failing
                        latestGeminiPredictionsRef.current = [];
                        hasRateLimitError = true;
                    })
                    .finally(() => {
                        // Use a much longer timeout if we hit a rate limit to allow the quota to reset
                        const delayMs = hasRateLimitError ? 30000 : 6000;
                        console.log(`[SCAN] Request finished. Waiting ${delayMs / 1000}s before next allowed scan.`);

                        setTimeout(() => {
                            console.log("[SCAN] Ready for next scan.");
                            isGeminiProcessingRef.current = false;
                        }, delayMs);
                    });
            }

            // Always use the latest available predictions for the frame processing
            let predictions: any[] = [];
            if (Array.isArray(latestGeminiPredictionsRef.current)) {
                predictions = [...latestGeminiPredictionsRef.current];
            }

            // Estimate distances (Since we synthesize boxes, we rely heavily on the wall heuristic or default sizes)
            const AVERAGE_HEIGHTS: Record<string, number> = {
                person: 1.7, man: 1.7, woman: 1.6, boy: 1.4, girl: 1.3, human: 1.6,
                chair: 0.9, table: 0.8, desk: 0.8, 'wooden table': 0.8,
                sofa: 0.9, couch: 0.9, bed: 0.6, door: 2.0, window: 1.5,
                laptop: 0.2, computer: 0.4, monitor: 0.4, tv: 0.6, television: 0.6,
                speaker: 0.3, socket: 0.1, 'power socket': 0.1, switch: 0.1,
                phone: 0.15, 'cell phone': 0.15, mobile: 0.15,
                cup: 0.1, bottle: 0.25, glass: 0.15, mug: 0.1,
                car: 1.5, truck: 3.5, bus: 3.0, motorcycle: 1.2, bicycle: 1.0,
                tree: 3.0, plant: 0.5, 'potted plant': 0.5, bush: 1.0,
                bag: 0.5, backpack: 0.5, suitcase: 0.6, box: 0.4,
                cat: 0.3, dog: 0.6, pet: 0.4,
                wall: 2.5, floor: 0.0, ceiling: 3.0
            };

            // Standard mobile camera focal length approximation (often ~0.8 to 1.0 depending on field of view)
            // A more standard 60-degree vertical FOV gives f = height / (2 * tan(30deg)) = height / 1.15
            const focalLength = video.videoHeight / 1.15;

            const enhancedPredictions = predictions.map((pred: any) => {
                if (!pred || !pred.bbox || pred.bbox.length !== 4) return null; // Safe check for malformed bbox array

                const [x, , width, height] = pred.bbox;

                // Try to find a matching height key, or default to 0.4m (typical small object)
                let realHeight = 0.4;
                for (const key in AVERAGE_HEIGHTS) {
                    if (pred.class.includes(key)) {
                        realHeight = AVERAGE_HEIGHTS[key];
                        break;
                    }
                }

                // Distance = (Real Height * Focal Length) / Pixel Height
                const estimatedDistanceMeters = (realHeight * focalLength) / height;

                // 1 step is approximately 0.762 meters (30 inches)
                let rawSteps = Math.max(1, Math.round(estimatedDistanceMeters / 0.762));
                rawSteps = Math.min(rawSteps, 30);

                if (!distanceHistoryRef.current[pred.class]) {
                    distanceHistoryRef.current[pred.class] = [];
                }

                const history = distanceHistoryRef.current[pred.class];
                history.push(rawSteps);
                if (history.length > 3) {
                    history.shift();
                }

                const smoothedSteps = Math.round(history.reduce((a, b) => a + b, 0) / history.length);

                const centerX = x + (width / 2);
                let position: "left" | "right" | "center" = "center";
                if (centerX < video.videoWidth / 3) {
                    position = "left"; // If it's on the left side of the screen/camera, it's left from the user's perspective
                } else if (centerX > video.videoWidth * (2 / 3)) {
                    position = "right"; // If it's on the right side of the screen/camera, it's right
                }

                return {
                    ...pred,
                    estimatedDistanceMeters: smoothedSteps * 0.76,
                    estimatedSteps: smoothedSteps,
                    position
                };
            }).filter((pred: any) => {
                if (!pred) return false;
                const lowerClass = pred.class.toLowerCase();
                // Ignore lights and ceilings
                if (lowerClass.includes('light') || lowerClass.includes('lamp') || lowerClass.includes('bulb') || lowerClass.includes('ceiling')) {
                    return false;
                }
                return true;
            }); // Filter out any nulls or lights

            if (wallPrediction) {
                if (enhancedPredictions.length < 5) {
                    enhancedPredictions.push(wallPrediction);
                }
            }

            setDetectedObjects(enhancedPredictions);

            if (onDetectRef.current && enhancedPredictions.length > 0) {
                onDetectRef.current(enhancedPredictions);
            }
        } catch (error) {
            console.error('Error in object detection loop:', error);
        } finally {
            // Fast loop reset. Gemini API rate limiting is handled by isGeminiProcessingRef.
            isProcessingRef.current = false;
        }
    }, [isNavigating, videoRef]);

    useEffect(() => {
        if (!isNavigating) {
            setDetectedObjects([]);
            latestGeminiPredictionsRef.current = [];
            isGeminiProcessingRef.current = false;
            return;
        }

        // We use a shorter interval (e.g. 250ms or 500ms) but it will skip if isProcessing is true
        const intervalId = setInterval(processFrame, invokeIntervalMs);

        return () => clearInterval(intervalId);
    }, [isNavigating, invokeIntervalMs, processFrame]);

    return { detectedObjects };
}
