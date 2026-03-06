"use client"

import { useState, useCallback, useEffect } from "react"
import { Eye, Camera, Navigation, Route, Shield, ChevronRight, MapPin, Phone, Instagram } from "lucide-react"
import { CommandHelp } from "@/components/voice-status"

const VOICE_COMMANDS = [
  { command: "allow / grant / give access", description: "Grant camera & microphone permissions" },
  { command: "start", description: "Begin navigation" },
  { command: "stop", description: "Stop current navigation" },
  { command: "show feed / hide feed", description: "Toggle live camera view" },
  { command: "call help", description: "Trigger emergency dialer" },
  { command: "emergency", description: "Activate emergency exit mode" },
  { command: "back", description: "Retrace your path" },
  { command: "where am i", description: "Read current position status" },
  { command: "which way is north/east/...", description: "Get directional guidance" },
  { command: "what is this / read currency", description: "Detect Indian Rupee notes & coins" },
]

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-card p-4" role="article" aria-label={`${title}: ${description}`}>
      <div className="text-primary">{icon}</div>
      <p className="text-sm font-bold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

interface HomeScreenProps {
  onStartNavigation: () => void
  isSupported: boolean
  speak: (text: string, priority?: "polite" | "assertive") => void
  triggerPermissionRequest: boolean
  onPermissionHandled: () => void
  emergencyNumber: string
  onSaveEmergencyNumber: (num: string) => void
}

export function HomeScreen({
  onStartNavigation,
  isSupported,
  speak,
  triggerPermissionRequest,
  onPermissionHandled,
  emergencyNumber,
  onSaveEmergencyNumber,
}: HomeScreenProps) {
  const [permissionsGranted, setPermissionsGranted] = useState(false)
  const [tempNumber, setTempNumber] = useState(emergencyNumber)

  useEffect(() => {
    setTempNumber(emergencyNumber)
  }, [emergencyNumber])

  const requestPermissions = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      stream.getTracks().forEach(track => track.stop())
      setPermissionsGranted(true)
      speak("Camera and microphone permissions granted.", "assertive")
    } catch (err) {
      console.error(err)
      speak("Permission denied. Please grant access in your browser settings.", "assertive")
    }
  }, [speak])

  useEffect(() => {
    if (triggerPermissionRequest) {
      requestPermissions().finally(() => {
        onPermissionHandled();
      });
    }
  }, [triggerPermissionRequest, requestPermissions, onPermissionHandled])

  return (
    <div className="flex w-full max-w-lg flex-1 flex-col items-center gap-6">
      {/* Hero */}
      <div className="flex flex-col items-center gap-3 pt-4 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-primary bg-primary/10">
          <Navigation className="h-12 w-12 text-primary" />
        </div>
        <h2 className="text-balance text-2xl font-bold text-foreground">Navigate Without Sight</h2>
        <p className="text-pretty text-muted-foreground">
          Voice-controlled, camera-assisted indoor navigation. No GPS needed.
        </p>
      </div>

      {/* Start button */}
      <button
        onClick={onStartNavigation}
        className="flex h-20 w-full items-center justify-between rounded-2xl border-2 border-primary bg-primary/10 px-6 text-left transition-all active:scale-[0.98] hover:bg-primary/20"
        aria-label="Start continuous tracking"
      >
        <div className="flex items-center gap-4">
          <Camera className="h-8 w-8 text-primary" />
          <div>
            <p className="text-lg font-bold text-foreground">Start Scanning</p>
            <p className="text-sm text-muted-foreground">Continuous object detection</p>
          </div>
        </div>
        <ChevronRight className="h-6 w-6 text-primary" />
      </button>

      {!permissionsGranted && (
        <button
          onClick={requestPermissions}
          className="w-full rounded-2xl border-2 border-primary bg-primary/20 py-4 text-center text-sm font-bold text-foreground transition-all active:scale-[0.98] hover:bg-primary/30"
          aria-label="Grant camera and microphone permissions"
        >
          Grant Permissions (Camera & Mic)
        </button>
      )}

      {/* Feature cards */}
      <div className="grid w-full grid-cols-2 gap-3">
        <FeatureCard
          icon={<Route className="h-6 w-6" />}
          title="Path Memory"
          description="Breadcrumb backtracking"
        />
        <FeatureCard
          icon={<Shield className="h-6 w-6" />}
          title="Emergency"
          description="Instant safe exit"
        />
        <FeatureCard
          icon={<MapPin className="h-6 w-6" />}
          title="No GPS"
          description="Sensor-based tracking"
        />
        <FeatureCard
          icon={<Eye className="h-6 w-6" />}
          title="Eyes-Free"
          description="Audio-only guidance"
        />
      </div>

      {/* Emergency Contact Setting */}
      <div className="w-full rounded-2xl bg-card p-4">
        <label htmlFor="emergency-input" className="block text-sm font-bold text-foreground mb-2">
          Emergency Contact Number
        </label>
        <div className="flex gap-2">
          <input
            id="emergency-input"
            type="tel"
            value={tempNumber}
            onChange={(e) => setTempNumber(e.target.value)}
            className="flex-1 rounded-xl bg-background px-4 py-2 text-foreground border-2 border-border focus:border-primary outline-none"
            placeholder="e.g. 911 or 555-0192"
            aria-label="Emergency Contact Number Input"
          />
          <button
            onClick={() => {
              const sanitized = tempNumber.replace(/[^\d+\-() ]/g, "").trim()
              if (!sanitized || sanitized.replace(/[^\d]/g, "").length < 3) {
                speak("Please enter a valid phone number.", "assertive")
                return
              }
              onSaveEmergencyNumber(sanitized)
              setTempNumber(sanitized)
              speak("Emergency number saved.", "polite")
            }}
            className="rounded-xl bg-primary px-4 py-2 font-bold text-primary-foreground hover:bg-primary/90"
            aria-label="Save Emergency Contact Number"
          >
            Save
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          This number will be dialed when you say &quot;Call help&quot; or &quot;Emergency&quot;.
        </p>
      </div>

      {/* Developer Contact Details */}
      <div className="w-full rounded-2xl bg-card p-6 border-2 border-border shadow-md">
        <h3 className="block text-center text-sm font-bold text-foreground mb-4 tracking-widest uppercase">
          Contact Details
        </h3>
        <div className="flex flex-row flex-wrap justify-center gap-4">
          <a
            href="tel:9934232827"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-background border-2 border-border focus:border-primary text-foreground transition-all hover:bg-primary/20 hover:border-primary active:scale-95 hover:-translate-y-1 shadow-sm"
            aria-label="Call support via phone"
          >
            <Phone className="h-6 w-6 text-primary" />
          </a>
          <a
            href="https://www.instagram.com/visionpathofficial/?utm_source=ig_web_button_share_sheet"
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-background border-2 border-border focus:border-primary text-foreground transition-all hover:bg-primary/20 hover:border-primary active:scale-95 hover:-translate-y-1 shadow-sm"
            aria-label="Contact support on Instagram"
          >
            <Instagram className="h-6 w-6 text-primary" />
          </a>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground opacity-80">
          Reach out on social media or direct call.
        </p>
      </div>

      {/* Voice commands */}
      <CommandHelp commands={VOICE_COMMANDS} />

      {!isSupported && (
        <div
          className="rounded-xl bg-destructive/10 p-4 text-center text-sm text-destructive"
          role="alert"
        >
          Voice recognition not supported in this browser. Use Chrome on Android for best experience.
        </div>
      )}
    </div>
  )
}
