import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from 'react'
import { reproducirChime } from '@/src/lib/audio-chime'
import {
  ControladorDictado,
  entornoDelNavegador,
  motivoNoDisponible,
  suscribirDisponibilidad,
  versionDeDisponibilidad,
  type EstadoDictado,
  type TipoMotorDictado,
} from '@/src/lib/voice-dictation-core'

export interface UseVoiceDictationOptions {
  /** Texto actual del campo: lo que haya al pulsar el micrófono es el ancla (no se pisa). */
  value: string
  /** Valor completo del campo (ancla + dictado) en cada resultado. */
  onTranscriptChange: (text: string, isFinal: boolean) => void
  /** Modo «Dictar y enviar al pausar»: se llama con el texto final tras `autoSendDelayMs` de silencio. */
  onAutoSubmit?: (finalText: string) => void
  /** null = solo transcribir; número = ms de silencio para auto-enviar. */
  autoSendDelayMs?: number | null
  /** BCP-47; por defecto el idioma del sistema si es español, si no es-ES. */
  lang?: string
  /** Puntuación hablada y términos del DAW (por defecto, true). */
  formatPunctuation?: boolean
  /** Sonido al empezar y al terminar (por defecto, true). */
  chime?: boolean
}

export interface VoiceDictation {
  status: EstadoDictado
  listening: boolean
  starting: boolean
  /** false si ningún motor de reconocimiento sirve en este entorno. */
  supported: boolean
  unavailableReason: string | null
  /** Último error legible (se limpia al volver a empezar). */
  error: string | null
  engine: TipoMotorDictado | null
  start: () => void
  stop: () => void
  toggle: () => void
}

/**
 * G7: dictado por voz para un campo de texto (estilo teclado de móvil). Motor y lógica en
 * `src/lib/voice-dictation-core.ts`; este hook solo conecta el controlador con React.
 */
export function useVoiceDictation(options: UseVoiceDictationOptions): VoiceDictation {
  const [, refrescar] = useReducer((n: number) => n + 1, 0)
  const opcionesRef = useRef(options)
  opcionesRef.current = options

  const controladorRef = useRef<ControladorDictado | null>(null)
  if (!controladorRef.current) {
    controladorRef.current = new ControladorDictado({
      entorno: entornoDelNavegador,
      alCambiarTexto: (t, esFinal) => opcionesRef.current.onTranscriptChange(t, esFinal),
      alAutoEnviar: (t) => opcionesRef.current.onAutoSubmit?.(t),
      alCambiarEstado: refrescar,
      alSonar: (tipo) => {
        if (opcionesRef.current.chime !== false) reproducirChime(tipo)
      },
    })
  }
  const controlador = controladorRef.current

  useEffect(() => {
    controlador.actualizarOpciones({
      lang: options.lang,
      autoEnvioMs: options.onAutoSubmit ? (options.autoSendDelayMs ?? null) : null,
      formatear: options.formatPunctuation !== false,
    })
  }, [controlador, options.lang, options.autoSendDelayMs, options.onAutoSubmit, options.formatPunctuation])

  // Lo tecleado mientras se dicta pasa a ser el ancla.
  useEffect(() => {
    controlador.sincronizarValor(options.value)
  }, [controlador, options.value])

  useEffect(() => () => controlador.detener(), [controlador])

  useSyncExternalStore(suscribirDisponibilidad, versionDeDisponibilidad, versionDeDisponibilidad)
  const unavailableReason = motivoNoDisponible(entornoDelNavegador())

  const start = useCallback(() => void controlador.iniciar(opcionesRef.current.value), [controlador])
  const stop = useCallback(() => controlador.detener(), [controlador])
  const toggle = useCallback(() => controlador.alternar(opcionesRef.current.value), [controlador])

  return {
    status: controlador.estado,
    listening: controlador.estado === 'escuchando',
    starting: controlador.estado === 'iniciando',
    supported: unavailableReason == null,
    unavailableReason,
    error: controlador.error,
    engine: controlador.motor,
    start,
    stop,
    toggle,
  }
}
