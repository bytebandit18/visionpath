"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Eye, Camera, Navigation, Route, Shield, ChevronRight, MapPin, Phone, Instagram } from "lucide-react"
import { useVoiceEngine } from "@/hooks/use-voice-engine"
import { useDeviceSensors } from "@/hooks/use-device-sensors"
import { SpatialCompass, PanicButton } from "@/components/spatial-compass"
import { VoiceStatus, CommandHelp } from "@/components/voice-status"
import { BackgroundCamera, BackgroundCameraHandle } from "@/components/background-camera"

type AppScreen = "home" | "navigate" | "emergency"

const VOICE_COMMANDS = [
  { command: "allow / grant", description: "Grant camera permissions" },
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

export default function VisionPathApp() {
  const [screen, setScreen] = useState<AppScreen>("home")
  const [isPanicActive, setIsPanicActive] = useState(false)
  const [statusMessage, setStatusMessage] = useState("")
  const [showLiveCamera, setShowLiveCamera] = useState(false)
  const [triggerPermissionRequest, setTriggerPermissionRequest] = useState(false)
  const [hasInteracted, setHasInteracted] = useState(false)
  const [emergencyNumber, setEmergencyNumber] = useState("911")
  const cameraRef = useRef<BackgroundCameraHandle>(null)

  useEffect(() => {
    const savedNumber = localStorage.getItem("visionPathEmergencyNumber")
    if (savedNumber) {
      setEmergencyNumber(savedNumber)
    }
  }, [])

  const saveEmergencyNumber = useCallback((num: string) => {
    setEmergencyNumber(num)
    localStorage.setItem("visionPathEmergencyNumber", num)
  }, [])

  const { sensorData, breadcrumbs, isTracking, startTracking, stopTracking } =
    useDeviceSensors()

  const handleCommand = useCallback(
    (command: string) => {
      const cmd = command.toLowerCase().trim()

      if (cmd.includes("start") || cmd.includes("navigate") || cmd.includes("go") || cmd.includes("scan")) {
        setScreen("navigate")
        startTracking()
        speak("Navigation started. Continuous scanning is active. Follow audio guidance.", "assertive")
        setStatusMessage("Navigating and scanning environment")
      } else if (cmd.includes("stop") || cmd.includes("end") || cmd.includes("finish")) {
        stopTracking()
        setScreen("home")
        setStatusMessage("Navigation stopped")
        speak("Navigation stopped. You are on the home screen.", "assertive")
      } else if (cmd.includes("call") && (cmd.includes("help") || cmd.includes("emergency") || cmd.includes("911"))) {
        // Trigger emergency dialer
        speak(`Calling emergency contact: ${emergencyNumber}.`, "assertive")
        window.open(`tel:${emergencyNumber}`, '_self')

        setIsPanicActive(true)
        setScreen("emergency")
        setStatusMessage("EMERGENCY CALL ACTIVE")
      } else if (cmd.includes("emergency") || cmd.includes("panic") || cmd.includes("help me")) {
        setIsPanicActive(true)
        setScreen("emergency")
        speak("Emergency mode activated. Follow audio instructions to the nearest exit.", "assertive")
        setStatusMessage("EMERGENCY MODE ACTIVE")
      } else if (cmd.includes("show feed") || cmd.includes("show camera") || cmd.includes("live feed")) {
        setShowLiveCamera(true)
        speak("Live camera feed is now visible on screen.", "polite")
      } else if (cmd.includes("hide feed") || cmd.includes("hide camera")) {
        setShowLiveCamera(false)
        speak("Live camera feed hidden.", "polite")
      } else if (cmd.includes("allow") || cmd.includes("grant") || cmd.includes("permission")) {
        if (screen === "home") {
          speak("Requesting permissions.", "polite")
          setTriggerPermissionRequest(true)
        }
      } else if (cmd.includes("back") || cmd.includes("retrace") || cmd.includes("return")) {
        speak(
          `Retracing path. You have ${breadcrumbs.length} breadcrumbs recorded. Turn around and follow audio cues.`,
          "assertive"
        )
        setStatusMessage("Retracing path...")
      } else if (cmd.includes("where") || cmd.includes("position") || cmd.includes("status")) {
        speak(
          `You are facing ${getCardinalDirection(sensorData.heading)}, heading ${sensorData.heading} degrees. You have taken ${sensorData.steps} steps.`,
          "assertive"
        )
      } else if (cmd.includes("which way is")) {
        const targets: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };
        const targetStr = Object.keys(targets).find(k => cmd.includes(k));
        if (targetStr) {
          const targetHeading = targets[targetStr];
          const relative = (targetHeading - sensorData.heading + 360) % 360;
          let directionText = "straight ahead";
          if (relative > 20 && relative < 160) directionText = "to your right";
          else if (relative >= 160 && relative <= 200) directionText = "behind you";
          else if (relative > 200 && relative < 340) directionText = "to your left";
          speak(`${targetStr} is ${directionText}.`, "assertive");
        } else {
          speak("I didn't catch the direction. Ask which way is north, south, east, or west.", "polite");
        }
      } else if (cmd.includes("what is this") || cmd.includes("read currency") || cmd.includes("identify cash") || cmd.includes("how much rupee")) {
        if (!cameraRef.current) {
          speak("Camera is not active. Say start to begin navigation first.", "assertive");
          return;
        }

        const frameBase64 = cameraRef.current.captureFrame();
        if (!frameBase64) {
          speak("Failed to capture image. Please try again.", "assertive");
          return;
        }

        speak("Reading...", "polite");

        fetch("/api/currency", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: frameBase64 })
        })
          .then(res => res.json())
          .then(data => {
            if (data.result) {
              speak(data.result, "assertive");
            } else {
              speak("Sorry, I couldn't identify that.", "polite");
            }
          })
          .catch(err => {
            console.error(err);
            speak("Error connecting to vision service.", "assertive");
          });

      } else if (cmd.includes("help") || cmd.includes("commands")) {
        speak(
          "Commands: allow, start, stop, show feed, call help, emergency, back, where am I, read currency.",
          "polite"
        )
      }
    },
    [sensorData, breadcrumbs, stopTracking]
  )

  const { isListening, transcript, isSupported, startListening, stopListening, speak } =
    useVoiceEngine({ onCommand: handleCommand })

  useEffect(() => {
    if (!hasInteracted) return

    // Delay slightly so the SpeechRecognition useEffect in use-voice-engine has time to run first
    const micTimer = setTimeout(() => {
      startListening()
    }, 300)

    const welcomeTimer = setTimeout(() => {
      speak(
        "Welcome to Vision Path. Eyes-free indoor navigation. Say start to begin continuous environment scanning. Say help for available commands.",
        "assertive"
      )
    }, 1000)
    return () => {
      clearTimeout(micTimer)
      clearTimeout(welcomeTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInteracted])

  const handlePanic = useCallback(() => {
    if (isPanicActive) {
      setIsPanicActive(false)
      setScreen("navigate")
      speak("Emergency mode deactivated. Resuming navigation.", "assertive")
      setStatusMessage("Navigation resumed")
    } else {
      setIsPanicActive(true)
      setScreen("emergency")
      speak(
        "Emergency mode activated. Retracing to the starting position. Follow audio cues carefully. Stay calm.",
        "assertive"
      )
      setStatusMessage("EMERGENCY MODE ACTIVE")
    }
  }, [isPanicActive, speak])

  const toggleVoice = useCallback(() => {
    if (isListening) {
      stopListening()
      speak("Voice commands disabled.", "polite")
    } else {
      startListening()
      speak("Voice commands enabled. Listening.", "polite")
    }
  }, [isListening, startListening, stopListening, speak])

  if (!hasInteracted) {
    const handleInitialTap = async () => {
      // iOS 13+ requires explicit permission to read device orientation for the compass
      if (
        typeof DeviceOrientationEvent !== "undefined" &&
        // @ts-ignore - non-standard iOS method
        typeof DeviceOrientationEvent.requestPermission === "function"
      ) {
        try {
          // @ts-ignore
          const permissionState = await DeviceOrientationEvent.requestPermission();
          if (permissionState !== "granted") {
            console.warn("Compass permission denied");
          }
        } catch (err) {
          console.error("Error requesting orientation permission:", err);
        }
      }

      setHasInteracted(true);
    };

    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
        <button
          onClick={handleInitialTap}
          className="flex h-full w-full flex-col items-center justify-center gap-6 rounded-3xl bg-primary/10 border-4 border-primary p-8 text-primary active:bg-primary/20"
          aria-label="Tap anywhere to start Voice Assistant and grant compass permissions"
        >
          <Eye className="h-24 w-24 animate-pulse" />
          <h1 className="text-3xl font-bold text-center">Vision Path</h1>
          <p className="text-xl text-center font-medium">Tap Anywhere to Start</p>
          <p className="text-sm text-center font-medium opacity-80 mt-2">Enables voice assistant and spatial compass</p>
        </button>
      </main>
    )
  }

  return (
    <main
      className="flex min-h-dvh flex-col bg-background"
      role="application"
      aria-label="Vision Path navigation app"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 pb-4 pt-safe-top">
        <div className="flex items-center gap-3 pt-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Eye className="h-7 w-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Vision Path</h1>
            <p className="text-xs text-muted-foreground">Eyes-Free Navigation</p>
          </div>
        </div>
        <div
          className={`rounded-full px-3 py-1 text-xs font-bold ${isTracking
            ? "bg-primary/20 text-primary"
            : "bg-secondary text-secondary-foreground"
            }`}
          role="status"
          aria-label={isTracking ? "Navigation active" : "Navigation inactive"}
        >
          {isTracking ? "ACTIVE" : "READY"}
        </div>
      </header>

      {/* Status bar */}
      {statusMessage && (
        <div
          className="mx-6 mb-4 rounded-xl bg-card px-4 py-3 text-center text-sm font-medium text-foreground"
          role="status"
          aria-live="assertive"
        >
          {statusMessage}
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 flex-col items-center gap-6 px-6 pb-6">
        {screen === "home" && (
          <HomeScreen
            onStartNavigation={() => {
              setScreen("navigate")
              startTracking()
              speak("Navigation started. Continuous scanning is active.", "assertive")
            }}
            isSupported={isSupported}
            speak={speak}
            triggerPermissionRequest={triggerPermissionRequest}
            onPermissionHandled={() => setTriggerPermissionRequest(false)}
            emergencyNumber={emergencyNumber}
            onSaveEmergencyNumber={saveEmergencyNumber}
          />
        )}

        {screen === "navigate" && (
          <NavigateScreen
            heading={sensorData.heading}
            steps={sensorData.steps}
            isMoving={sensorData.isMoving}
            breadcrumbCount={breadcrumbs.length}
            onPanic={handlePanic}
            isPanicActive={isPanicActive}
            showLiveCamera={showLiveCamera}
            setShowLiveCamera={setShowLiveCamera}
          />
        )}

        {screen === "emergency" && (
          <EmergencyScreen
            heading={sensorData.heading}
            steps={sensorData.steps}
            breadcrumbCount={breadcrumbs.length}
            onDeactivate={handlePanic}
          />
        )}

        {/* Background camera for active detection during navigation */}
        {(screen === "navigate" || screen === "emergency") && (
          <BackgroundCamera
            ref={cameraRef}
            isNavigating={isTracking || isPanicActive}
            speak={speak}
            showLiveView={showLiveCamera}
          />
        )}

        {/* Voice controls - always visible */}
        <div className="mt-auto w-full max-w-lg">
          <VoiceStatus
            isListening={isListening}
            lastCommand={transcript}
            onToggle={toggleVoice}
          />
        </div>
      </div>
    </main>
  )
}

/* ----- Sub-screens ----- */

function HomeScreen({
  onStartNavigation,
  isSupported,
  speak,
  triggerPermissionRequest,
  onPermissionHandled,
  emergencyNumber,
  onSaveEmergencyNumber,
}: {
  onStartNavigation: () => void
  isSupported: boolean
  speak: (text: string, priority?: "polite" | "assertive") => void
  triggerPermissionRequest: boolean
  onPermissionHandled: () => void
  emergencyNumber: string
  onSaveEmergencyNumber: (num: string) => void
}) {
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
              onSaveEmergencyNumber(tempNumber)
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

function NavigateScreen({
  heading,
  steps,
  isMoving,
  breadcrumbCount,
  onPanic,
  isPanicActive,
  showLiveCamera,
  setShowLiveCamera,
}: {
  heading: number
  steps: number
  isMoving: boolean
  breadcrumbCount: number
  onPanic: () => void
  isPanicActive: boolean
  showLiveCamera: boolean
  setShowLiveCamera: (show: boolean) => void
}) {
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

function EmergencyScreen({
  heading,
  steps,
  breadcrumbCount,
  onDeactivate,
}: {
  heading: number
  steps: number
  breadcrumbCount: number
  onDeactivate: () => void
}) {
  return (
    <div className="flex w-full max-w-lg flex-1 flex-col items-center gap-6">
      <div
        className="w-full animate-pulse rounded-2xl border-4 border-destructive bg-destructive/10 p-6 text-center"
        role="alert"
        aria-live="assertive"
      >
        <p className="text-3xl font-bold text-destructive">EMERGENCY MODE</p>
        <p className="mt-2 text-lg text-foreground">Retracing to safe exit</p>
      </div>

      <SpatialCompass heading={heading} steps={steps} isMoving={true} isNavigating={true} />

      <div className="w-full rounded-2xl bg-card p-4 text-center">
        <p className="text-sm text-muted-foreground">
          Retracing {breadcrumbCount} breadcrumbs to starting position. Follow audio guidance.
        </p>
      </div>

      <button
        onClick={onDeactivate}
        className="h-16 w-full rounded-2xl border-2 border-secondary bg-secondary text-lg font-bold text-secondary-foreground transition-all active:scale-95"
        aria-label="Deactivate emergency mode and resume navigation"
      >
        Deactivate Emergency
      </button>
    </div>
  )
}

function getCardinalDirection(heading: number): string {
  const directions = [
    "North", "North East", "East", "South East",
    "South", "South West", "West", "North West",
  ]
  const index = Math.round(heading / 45) % 8
  return directions[index]
}
