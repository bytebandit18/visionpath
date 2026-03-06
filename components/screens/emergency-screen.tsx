"use client"

import { SpatialCompass } from "@/components/spatial-compass"
import { getTurnInstruction, type BacktrackState } from "@/hooks/use-device-sensors"

interface EmergencyScreenProps {
  heading: number
  steps: number
  breadcrumbCount: number
  onDeactivate: () => void
  backtrackState: BacktrackState
}

export function EmergencyScreen({
  heading,
  steps,
  breadcrumbCount,
  onDeactivate,
  backtrackState,
}: EmergencyScreenProps) {
  const currentInstruction = backtrackState.currentSegment
    ? getTurnInstruction(heading, backtrackState.currentSegment.targetHeading)
    : null

  return (
    <div className="flex w-full max-w-lg flex-1 flex-col items-center gap-6">
      <div
        className={`w-full rounded-2xl border-4 p-6 text-center ${
          backtrackState.reachedStart
            ? "border-primary bg-primary/10"
            : "animate-pulse border-destructive bg-destructive/10"
        }`}
        role="alert"
        aria-live="assertive"
      >
        {backtrackState.reachedStart ? (
          <>
            <p className="text-3xl font-bold text-primary">SAFE</p>
            <p className="mt-2 text-lg text-foreground">You have reached the starting position</p>
          </>
        ) : (
          <>
            <p className="text-3xl font-bold text-destructive">EMERGENCY MODE</p>
            <p className="mt-2 text-lg text-foreground">Retracing to safe exit</p>
          </>
        )}
      </div>

      <SpatialCompass heading={heading} steps={steps} isMoving={true} isNavigating={true} />

      {/* Live backtracking guidance */}
      {backtrackState.isBacktracking && backtrackState.currentSegment && currentInstruction && (
        <div className="w-full rounded-2xl border-2 border-primary/30 bg-primary/5 p-6 text-center">
          <p className="text-2xl font-bold text-foreground">{currentInstruction.instruction}</p>
          <p className="mt-2 text-lg text-primary font-bold">
            {backtrackState.stepsRemaining} steps remaining
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Segment {backtrackState.currentSegmentIndex + 1} of {backtrackState.totalSegments} · {backtrackState.totalStepsRemaining} total steps left
          </p>
        </div>
      )}

      {!backtrackState.isBacktracking && !backtrackState.reachedStart && (
        <div className="w-full rounded-2xl bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">
            {breadcrumbCount > 0
              ? `Retracing ${breadcrumbCount} breadcrumbs to starting position. Follow audio guidance.`
              : "No path recorded. Stay calm and call for help."}
          </p>
        </div>
      )}

      <button
        onClick={onDeactivate}
        className="h-16 w-full rounded-2xl border-2 border-secondary bg-secondary text-lg font-bold text-secondary-foreground transition-all active:scale-95"
        aria-label="Deactivate emergency mode and resume navigation"
      >
        {backtrackState.reachedStart ? "Return Home" : "Deactivate Emergency"}
      </button>
    </div>
  )
}
