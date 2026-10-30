import type { RefObject } from 'react'
import { VoiceDictationButton } from '@jaswave/host-sdk'

export interface SpeechToTextButtonProps {
  /** Texto actual del cuadro del chat. */
  value: string
  /** Nuevo valor completo del cuadro (lo escrito antes + lo dictado, sin duplicar). */
  onChange: (text: string) => void
  /** Modo «Dictar y enviar al pausar»: envía el mensaje tras ~2 s de silencio. */
  onAutoSubmit?: (text: string) => void
  /** Cuadro del chat: el foco vuelve ahí al empezar/parar y Alt+V lo reconoce. */
  inputRef?: RefObject<HTMLTextAreaElement | null>
  disabled?: boolean
  className?: string
}

/**
 * G7: dictado por voz del asistente. La lógica (reconocedor local de Windows o Web Speech API, puntuación
 * hablada, modo auto-enviar, Alt+V y aviso sonoro) es del host; aquí solo se conecta con el chat.
 */
export function SpeechToTextButton({ value, onChange, onAutoSubmit, inputRef, disabled = false, className }: SpeechToTextButtonProps) {
  return (
    <VoiceDictationButton
      value={value}
      onChange={(texto) => onChange(texto)}
      onAutoSubmit={onAutoSubmit}
      targetRef={inputRef}
      // Alt+V sin foco en ningún campo con micrófono dicta en el asistente.
      isDefaultTarget
      modeStorageKey="jaswave.dictado.modo.asistente"
      disabled={disabled}
      className={className}
    />
  )
}
