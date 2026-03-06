"use client"

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react"
import { RefreshCcw } from "lucide-react"
import { useObjectDetection } from "@/hooks/use-object-detection"

export interface BackgroundCameraHandle {
    captureFrame: () => string | null;
}

interface BackgroundCameraProps {
    isNavigating: boolean
    speak: (text: string, priority?: "polite" | "assertive") => void
    showLiveView?: boolean
}

export const BackgroundCamera = forwardRef<BackgroundCameraHandle, BackgroundCameraProps>(({ isNavigating, speak, showLiveView = false }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null)
    const overlayRef = useRef<HTMLCanvasElement>(null)
    const lastSpokenRef = useRef<Record<string, number>>({})
    const [videoSize, setVideoSize] = useState({ width: 0, height: 0 })
    const [facingMode, setFacingMode] = useState<"environment" | "user">("environment")

    // Initialize camera
    useEffect(() => {
        let stream: MediaStream | null = null
        let isActive = true

        async function startCamera() {
            if (!isNavigating) return

            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    throw new Error("getUserMedia not supported in this browser (requires HTTPS or localhost).")
                }

                let requestedStream: MediaStream | null = null
                try {
                    requestedStream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: { ideal: facingMode }, width: { ideal: 640 }, height: { ideal: 480 } },
                    })
                } catch (initialErr: any) {
                    console.warn("Background camera initial request failed:", initialErr)
                    if (initialErr.name === 'NotAllowedError' || initialErr.name === 'AbortError') {
                        throw initialErr
                    }
                    requestedStream = await navigator.mediaDevices.getUserMedia({
                        video: true,
                    })
                }

                if (!isActive) {
                    if (requestedStream) {
                        requestedStream.getTracks().forEach((t) => t.stop())
                    }
                    return
                }

                stream = requestedStream
                if (videoRef.current && stream) {
                    videoRef.current.srcObject = stream
                    try {
                        await videoRef.current.play()
                    } catch (playErr: any) {
                        if (playErr.name !== 'AbortError' && playErr.name !== 'NotAllowedError') {
                            console.warn("Camera play error (ignored):", playErr)
                        }
                    }
                }
            } catch (err: any) {
                if (!isActive || err.name === 'AbortError') return
                console.error("Background camera error:", err)
            }
        }

        startCamera()

        return () => {
            isActive = false
            if (stream) {
                stream.getTracks().forEach((t) => t.stop())
            }
        }
    }, [isNavigating, facingMode])

    const { detectedObjects } = useObjectDetection({
        isNavigating,
        videoRef,
        invokeIntervalMs: 150, // Keep scanning fast so the UI is responsive, but let the voice cooldowns handle the spam
        speak,
        onDescribeScene: (description: string) => {
            speak(`Scene: ${description}`, "polite");
        },
        onDetect: (objects: any[]) => {
            const now = Date.now()

            // Filter for confident objects
            const confidentObjects = objects.filter(obj => obj.score > 0.65)

            if (confidentObjects.length === 0) return;

            // Group objects by class
            const groups: Record<string, { count: number, closestSteps: number, latestObj: any }> = {}

            confidentObjects.forEach((obj) => {
                const steps = obj.estimatedSteps || 99

                if (!groups[obj.class]) {
                    groups[obj.class] = { count: 1, closestSteps: steps, latestObj: obj }
                } else {
                    groups[obj.class].count += 1
                    groups[obj.class].closestSteps = Math.min(groups[obj.class].closestSteps, steps)
                }
            })

            // Sort groups by distance to prioritize closer things
            const sortedGroups = Object.values(groups).sort((a, b) => a.closestSteps - b.closestSteps)

            // Vehicles/hazards get priority bypassing normal cooldowns if they are close (< 15 steps)
            const hazards = ['car', 'truck', 'bus', 'motorcycle', 'wall']

            sortedGroups.forEach((group) => {
                const { count, closestSteps, latestObj } = group
                const objClass = latestObj.class
                const isHazard = hazards.includes(objClass)

                const lastSpoken = lastSpokenRef.current[objClass] || 0

                // Reduced cooldowns to prioritize fast scanning & warnings, even if it "spams" a bit more
                let cooldownMs = 12000; // Default 12 seconds
                if (isHazard) {
                    if (objClass === 'wall') {
                        // Announce walls much faster if very close
                        cooldownMs = closestSteps < 5 ? 3000 : 10000;
                    } else {
                        cooldownMs = closestSteps < 15 ? 4000 : 8000; // Moving hazards
                    }
                }

                // If it's a completely new object we haven't seen in a while, or cooldown has passed
                if (now - lastSpoken > cooldownMs) {
                    const distanceStr = closestSteps < 99
                        ? `${closestSteps} steps`
                        : "ahead"

                    // Special case for wall string formatting
                    const countStr = count > 1 && objClass !== 'wall' ? `${count} ${objClass}s` : objClass
                    const hazardPrefix = isHazard ? "Caution, " : ""

                    let positionStr = "ahead";
                    if (latestObj.position === "left") positionStr = "on your left";
                    if (latestObj.position === "right") positionStr = "on your right";

                    speak(`${hazardPrefix}${countStr} ${positionStr}, ${distanceStr}`, isHazard ? "assertive" : "polite")
                    lastSpokenRef.current[objClass] = now
                }
            })
        },
    })

    useImperativeHandle(ref, () => ({
        captureFrame: () => {
            if (!videoRef.current) return null;
            const video = videoRef.current;
            if (video.videoWidth === 0 || video.videoHeight === 0) return null;

            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            // High quality JPEG for Gemini
            return canvas.toDataURL("image/jpeg", 0.9);
        }
    }));

    // Handle overlay drawing when detected objects change
    useEffect(() => {
        if (!showLiveView || !videoRef.current || !overlayRef.current) return

        const video = videoRef.current
        const canvas = overlayRef.current
        const ctx = canvas.getContext("2d")

        if (!ctx) return

        // Wait for video dimensions
        if (video.videoWidth === 0 || video.videoHeight === 0) {
            const handleLoadedMetadata = () => {
                setVideoSize({ width: video.videoWidth, height: video.videoHeight })
            }
            video.addEventListener('loadedmetadata', handleLoadedMetadata)
            return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata)
        } else if (videoSize.width !== video.videoWidth) {
            setVideoSize({ width: video.videoWidth, height: video.videoHeight })
        }

        // Set dimensions
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight

        // Clear previous frame
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        // Draw bounding boxes
        detectedObjects.forEach((obj) => {
            if (obj.score > 0.4) {
                const [x, y, width, height] = obj.bbox

                // Draw box
                ctx.strokeStyle = "#0ea5e9" // primary color
                ctx.lineWidth = 4
                ctx.strokeRect(x, y, width, height)

                // Draw label background
                ctx.fillStyle = "#0ea5e9"
                const label = `${obj.class} ${Math.round(obj.score * 100)}%`
                const textWidth = ctx.measureText(label).width
                ctx.fillRect(x, y - 24, textWidth + 10, 24)

                // Draw text
                ctx.fillStyle = "#ffffff"
                ctx.font = "16px sans-serif"
                ctx.fillText(label, x + 5, y - 6)
            }
        })
    }, [detectedObjects, showLiveView, videoSize.width])

    // We keep it hidden from view but mounted if showLiveView is false
    return (
        <div className={`relative ${showLiveView ? 'w-full max-w-lg aspect-[3/4] overflow-hidden rounded-2xl bg-black/10' : 'fixed -z-50 opacity-0 w-[1px] h-[1px] overflow-hidden pointer-events-none'}`}>
            <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-cover"
                playsInline
                muted
                autoPlay
                aria-hidden="true"
            />
            {showLiveView && (
                <canvas
                    ref={overlayRef}
                    className="absolute inset-0 h-full w-full object-cover z-10"
                    aria-hidden="true"
                />
            )}
            {showLiveView && detectedObjects.length === 0 && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 pointer-events-none">
                    <p className="text-white bg-black/50 px-3 py-1 rounded-full text-sm">Scanning...</p>
                </div>
            )}

            {showLiveView && (
                <button
                    onClick={() => setFacingMode(prev => prev === "environment" ? "user" : "environment")}
                    className="absolute top-4 right-4 z-30 p-3 bg-black/50 text-white rounded-full hover:bg-black/70 transition-colors pointer-events-auto"
                    aria-label="Flip camera"
                >
                    <RefreshCcw className="w-6 h-6" />
                </button>
            )}
        </div>
    )
})

