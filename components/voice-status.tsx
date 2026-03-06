"use client"

import { Mic, MicOff, Volume2 } from "lucide-react"

interface VoiceStatusProps {
  isListening: boolean
  lastCommand: string
  onToggle: () => void
}

export function VoiceStatus({ isListening, lastCommand, onToggle }: VoiceStatusProps) {
  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={onToggle}
        className={`flex h-20 w-20 items-center justify-center rounded-full border-4 transition-all active:scale-95 ${
          isListening
            ? "border-primary bg-primary/20 text-primary shadow-[0_0_30px_rgba(0,200,150,0.3)]"
            : "border-muted bg-card text-muted-foreground"
        }`}
        aria-label={isListening ? "Voice listening active. Tap to stop." : "Voice inactive. Tap to start listening."}
        aria-pressed={isListening}
      >
        {isListening ? (
          <Mic className="h-10 w-10" />
        ) : (
          <MicOff className="h-10 w-10" />
        )}
      </button>

      <p className="text-center text-lg text-muted-foreground" aria-live="polite">
        {isListening ? "Listening for commands..." : "Tap microphone to start"}
      </p>

      {lastCommand && (
        <div
          className="flex items-center gap-2 rounded-xl bg-card px-4 py-2"
          role="log"
          aria-label={`Last command: ${lastCommand}`}
        >
          <Volume2 className="h-4 w-4 text-primary" />
          <span className="text-sm text-muted-foreground">
            {'"'}{lastCommand}{'"'}
          </span>
        </div>
      )}
    </div>
  )
}

interface CommandHelpProps {
  commands: { command: string; description: string }[]
}

export function CommandHelp({ commands }: CommandHelpProps) {
  return (
    <div className="w-full rounded-2xl bg-card p-6" role="region" aria-label="Available voice commands">
      <h3 className="mb-4 text-lg font-bold text-foreground">Voice Commands</h3>
      <ul className="flex flex-col gap-3" role="list">
        {commands.map((cmd) => (
          <li key={cmd.command} className="flex items-start gap-3">
            <span className="rounded-lg bg-primary/15 px-3 py-1 text-sm font-bold text-primary">
              {'"'}{cmd.command}{'"'}
            </span>
            <span className="text-sm text-muted-foreground">{cmd.description}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
