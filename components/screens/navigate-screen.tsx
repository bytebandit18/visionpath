"use client"

import { Camera, Route } from "lucide-react"
import { SpatialCompass, PanicButton } from "@/components/spatial-compass"

interface NavigateScreenProps {
  heading: number
  steps: number
  isMoving: boolean
  breadcrumbCount: number
  onPanic: () => void
  isPanicActive: boolean
  showLiveCamera: boolean
  setShowLiveCamera: (show: boolean) => void
}

export function NavigateScreen({
  heading,
  steps,
  isMoving,
  breadcrumbCount,
  onPanic,
  isPanicActive,
  showLiveCamera,
  setShowLiveCamera,
}: NavigateScreenProps) {
  return (
    <div className="flex w-full max-w-lg flex-1 flex-col items-center gap-6">
      <SpatialCompass heading={heading} steps={steps} isMoving={isMoving} isNavigating={true} />

      <div className="flex w-full items-center justify-center gap-3 rounded-2xl bg-card px-4 py-3">
        <Route className="h-5 w-5 text-primary" />
        <span className="text-sm text-muted-foreground">
          {breadcrumbCount} breadcrumbs recorded
        </span>
      </div>

      <div className="w-full" role="region" aria-label="Navigation guidance">
        <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-6 text-center">
          <p className="text-lg font-bold text-foreground">Follow the audio cues</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Walk forward. Audio beeps guide your direction. Say &quot;where am I&quot; for status.
          </p>
        </div>
      </div>

      <button
        onClick={() => setShowLiveCamera(!showLiveCamera)}
        className={`w-full rounded-2xl border-2 py-4 text-center font-bold transition-all active:scale-95 ${showLiveCamera
          ? "border-primary bg-primary text-primary-foreground"
          : "border-primary bg-primary/10 text-primary hover:bg-primary/20"
          }`}
      >
        <div className="flex items-center justify-center gap-2">
          <Camera className="h-5 w-5" />
          <span>{showLiveCamera ? "Hide Live Feed" : "Show Live Feed"}</span>
        </div>
      </button>

      <PanicButton onPanic={onPanic} isActive={isPanicActive} />
    </div>
  )
}
