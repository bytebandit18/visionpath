"use client"

import { useState, useEffect, useCallback, useRef } from "react"

interface VoiceEngineOptions {
  onCommand?: (command: string) => void
  continuous?: boolean
}

export function useVoiceEngine({ onCommand, continuous = true }: VoiceEngineOptions = {}) {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [isSupported, setIsSupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const transcriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Ref to track the latest isListening state inside async closures (avoids stale closure bug)
  const isListeningRef = useRef(false)
  const isSpeakingRef = useRef(false)

  // Ref to always have the latest onCommand callback (fixes stale closure in onresult)
  const onCommandRef = useRef(onCommand)
  useEffect(() => { onCommandRef.current = onCommand }, [onCommand])

  // Keep isListeningRef in sync with state
  useEffect(() => {
    isListeningRef.current = isListening
  }, [isListening])

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      setIsSupported(true)
      const recognition = new SpeechRecognition()
      recognition.continuous = continuous
      recognition.interimResults = true
      recognition.lang = "en-US"

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (isSpeakingRef.current) return // Ignore input if TTS is currently active

        let finalTranscript = ""
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result.isFinal) {
            finalTranscript += result[0].transcript
          }
        }
        if (finalTranscript) {
          const processed = finalTranscript.trim().toLowerCase()
          setTranscript(processed)
          onCommandRef.current?.(processed)

          // Auto-clear transcript after 4 seconds
          if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current)
          transcriptTimerRef.current = setTimeout(() => setTranscript(""), 4000)
        }
      }

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        // On "no-speech" or "audio-capture" errors, try to restart rather than stopping
        if (event.error === "no-speech" || event.error === "audio-capture") {
          // Will be restarted by onend
          return
        }
        setIsListening(false)
        isListeningRef.current = false
      }

      recognition.onend = () => {
        // Use ref (not state) to avoid stale closure — this ensures continuous restarts work
        if (continuous && isListeningRef.current) {
          try {
            recognition.start()
          } catch {
            // Already started — ignore
          }
        } else {
          setIsListening(false)
          isListeningRef.current = false
        }
      }

      recognitionRef.current = recognition
    }

    return () => {
      recognitionRef.current?.stop()
      if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuous])

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isListeningRef.current) {
      try {
        recognitionRef.current.start()
        setIsListening(true)
        isListeningRef.current = true
      } catch {
        // Already started
      }
    }
  }, [])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      isListeningRef.current = false
      recognitionRef.current.stop()
      setIsListening(false)
    }
  }, [])

  const speakTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const speak = useCallback((text: string, priority: "polite" | "assertive" = "polite") => {
    window.speechSynthesis.cancel()
    if (speakTimeoutRef.current) clearTimeout(speakTimeoutRef.current)
    const utterance = new SpeechSynthesisUtterance(text)

    // Block the microphone from processing this utterance
    utterance.onstart = () => {
      isSpeakingRef.current = true
    }
    const resetSpeaking = () => {
      if (speakTimeoutRef.current) clearTimeout(speakTimeoutRef.current)
      speakTimeoutRef.current = null
      // Small buffer to let room echoes die down
      setTimeout(() => {
        isSpeakingRef.current = false
      }, 500)
    }
    utterance.onend = resetSpeaking
    utterance.onerror = () => {
      isSpeakingRef.current = false
    }

    // Failsafe: Chrome sometimes doesn't fire onend for long utterances.
    // Estimate ~80ms per character + 3s buffer. Reset speaking flag if stuck.
    const estimatedMs = Math.max(4000, text.length * 80 + 3000)
    speakTimeoutRef.current = setTimeout(() => {
      if (isSpeakingRef.current) {
        isSpeakingRef.current = false
        speakTimeoutRef.current = null
      }
    }, estimatedMs)

    utterance.rate = priority === "assertive" ? 1.1 : 0.95
    utterance.pitch = 1
    utterance.volume = 1
    window.speechSynthesis.speak(utterance)
  }, [])

  return {
    isListening,
    transcript,
    isSupported,
    startListening,
    stopListening,
    speak,
  }
}
