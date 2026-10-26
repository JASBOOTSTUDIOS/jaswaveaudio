import { useState, useRef, useEffect, useCallback } from 'react'
import { Mic, MicOff } from 'lucide-react'

// Declaración de tipos para Web Speech API
interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message?: string
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
  }
}

export interface SpeechToTextButtonProps {
  onTranscript: (text: string, isFinal: boolean) => void
  disabled?: boolean
  className?: string
}

export function SpeechToTextButton({ onTranscript, disabled = false, className = '' }: SpeechToTextButtonProps) {
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(true)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  useEffect(() => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRec) {
      setIsSupported(false)
      return
    }
    setIsSupported(true)
  }, [])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        /* ignorar */
      }
      recognitionRef.current = null
    }
    setIsListening(false)
  }, [])

  const startListening = useCallback(() => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRec) return

    try {
      const recognition = new SpeechRec()
      recognition.continuous = true
      recognition.interimResults = true
      // Configurar español (o idioma del navegador si es español)
      recognition.lang = navigator.language?.startsWith('es') ? navigator.language : 'es-ES'

      recognition.onstart = () => {
        setIsListening(true)
      }

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = ''
        let finalTranscript = ''

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i]
          if (!item) continue
          const piece = item[0]?.transcript ?? ''
          if (item.isFinal) {
            finalTranscript += piece
          } else {
            interimTranscript += piece
          }
        }

        const text = finalTranscript || interimTranscript
        if (text) {
          onTranscript(text, Boolean(finalTranscript))
        }
      }

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.warn('[speech-to-text] error de reconocimiento:', event.error)
        if (event.error !== 'no-speech') {
          stopListening()
        }
      }

      recognition.onend = () => {
        setIsListening(false)
        recognitionRef.current = null
      }

      recognitionRef.current = recognition
      recognition.start()
      setIsListening(true)
    } catch (err) {
      console.warn('[speech-to-text] no se pudo iniciar reconocimiento:', err)
      setIsListening(false)
    }
  }, [onTranscript, stopListening])

  const toggleListening = () => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }

  useEffect(() => {
    return () => {
      stopListening()
    }
  }, [stopListening])

  if (!isSupported) {
    return (
      <button
        type="button"
        disabled
        title="El reconocimiento de voz no está soportado por este entorno"
        className={`flex size-7 items-center justify-center rounded-full text-muted-foreground opacity-30 ${className}`}
      >
        <MicOff className="size-3.5" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggleListening}
      disabled={disabled}
      title={isListening ? 'Detener dictado por voz' : 'Dictar por voz (como en el teclado de Google)'}
      aria-label={isListening ? 'Detener dictado por voz' : 'Iniciar dictado por voz'}
      className={`relative flex size-7 items-center justify-center rounded-full transition-all ${
        isListening
          ? 'bg-rose-500/20 text-rose-400 ring-2 ring-rose-500/60 animate-pulse'
          : 'text-muted-foreground hover:bg-panel-hover hover:text-foreground'
      } ${className}`}
    >
      <Mic className={`size-3.5 ${isListening ? 'scale-110 text-rose-400' : ''}`} />
      {isListening && (
        <span className="absolute -top-1 -right-1 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
        </span>
      )}
    </button>
  )
}
