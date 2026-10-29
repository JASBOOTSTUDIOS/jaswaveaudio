import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Check, ChevronDown, Loader2, Mic, MicOff, Type, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVoiceDictation } from '@/hooks/use-voice-dictation'
import { AUTO_ENVIO_MS_POR_DEFECTO, registrarObjetivoDictado, type ModoDictado } from '@/src/lib/voice-dictation-core'

export interface VoiceDictationButtonProps {
  /** Texto actual del campo. */
  value: string
  /** Nuevo valor completo del campo (lo escrito antes + lo dictado). */
  onChange: (text: string, isFinal: boolean) => void
  /** Si se pasa, aparece el modo «Dictar y enviar al pausar». */
  onAutoSubmit?: (finalText: string) => void
  /** Modo inicial (por defecto, solo transcribir). */
  defaultMode?: ModoDictado
  /** Clave de localStorage para recordar el modo elegido. */
  modeStorageKey?: string
  /** Silencio antes de auto-enviar (ms). */
  autoSendDelayMs?: number
  /** Campo al que dicta: Alt+V lo reconoce con el foco dentro y el foco vuelve a él al empezar/parar. */
  targetRef?: RefObject<HTMLElement | null>
  /** Alt+V con el foco fuera de cualquier campo con dictado usa este (el asistente). */
  isDefaultTarget?: boolean
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md'
}

const ETIQUETA_MODO: Record<ModoDictado, string> = {
  transcribir: 'Solo transcribir',
  'auto-enviar': 'Dictar y enviar al pausar',
}

function leerModo(clave: string | undefined, porDefecto: ModoDictado): ModoDictado {
  if (!clave) return porDefecto
  try {
    const v = localStorage.getItem(clave)
    return v === 'transcribir' || v === 'auto-enviar' ? v : porDefecto
  } catch {
    return porDefecto
  }
}

/**
 * G7: botón de micrófono para dictar en un campo de texto. Clic = empezar/parar (o Alt+V); clic derecho o la
 * flecha = elegir el modo. Si no hay reconocimiento de voz queda deshabilitado con el motivo en el título.
 */
export function VoiceDictationButton({
  value,
  onChange,
  onAutoSubmit,
  defaultMode = 'transcribir',
  modeStorageKey,
  autoSendDelayMs = AUTO_ENVIO_MS_POR_DEFECTO,
  targetRef,
  isDefaultTarget = false,
  disabled = false,
  className,
  size = 'sm',
}: VoiceDictationButtonProps) {
  const puedeAutoEnviar = Boolean(onAutoSubmit)
  const [modo, setModo] = useState<ModoDictado>(() => leerModo(modeStorageKey, defaultMode))
  const modoEfectivo: ModoDictado = puedeAutoEnviar ? modo : 'transcribir'
  const [menuAbierto, setMenuAbierto] = useState(false)
  const contenedorRef = useRef<HTMLSpanElement>(null)

  const enfocarCampo = useCallback(() => {
    requestAnimationFrame(() => targetRef?.current?.focus())
  }, [targetRef])

  const dictado = useVoiceDictation({
    value,
    onTranscriptChange: onChange,
    onAutoSubmit: modoEfectivo === 'auto-enviar' ? onAutoSubmit : undefined,
    autoSendDelayMs: modoEfectivo === 'auto-enviar' ? autoSendDelayMs : null,
  })
  const inactivo = disabled || !dictado.supported
  const activo = dictado.listening || dictado.starting

  const alternar = useCallback(() => {
    if (!activo && inactivo) return
    dictado.toggle()
    enfocarCampo()
  }, [activo, inactivo, dictado, enfocarCampo])

  // Deshabilitado mientras escucha (p. ej. el asistente empieza a generar): parar.
  useEffect(() => {
    if (disabled && activo) dictado.stop()
  }, [disabled, activo, dictado])

  // Alt+V
  const alternarRef = useRef(alternar)
  alternarRef.current = alternar
  const estadoRef = useRef({ activo, inactivo })
  estadoRef.current = { activo, inactivo }
  useEffect(
    () =>
      registrarObjetivoDictado({
        contiene: (el) => !!el && (!!targetRef?.current?.contains(el) || !!contenedorRef.current?.contains(el)),
        escuchando: () => estadoRef.current.activo,
        alternar: () => alternarRef.current(),
        predeterminado: isDefaultTarget,
        disponible: () => estadoRef.current.activo || !estadoRef.current.inactivo,
      }),
    [targetRef, isDefaultTarget],
  )

  // Cerrar el menú de modo con clic fuera o Escape.
  useEffect(() => {
    if (!menuAbierto) return
    const fuera = (e: MouseEvent) => {
      if (!contenedorRef.current?.contains(e.target as Node)) setMenuAbierto(false)
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setMenuAbierto(false)
      }
    }
    window.addEventListener('mousedown', fuera, true)
    window.addEventListener('keydown', tecla, true)
    return () => {
      window.removeEventListener('mousedown', fuera, true)
      window.removeEventListener('keydown', tecla, true)
    }
  }, [menuAbierto])

  const elegirModo = (m: ModoDictado) => {
    setModo(m)
    setMenuAbierto(false)
    if (modeStorageKey) {
      try {
        localStorage.setItem(modeStorageKey, m)
      } catch {
        /* sin almacenamiento: el modo dura lo que la sesión */
      }
    }
    enfocarCampo()
  }

  const titulo = !dictado.supported
    ? dictado.unavailableReason ?? 'El dictado por voz no está disponible'
    : dictado.starting
      ? 'Preparando el micrófono…'
      : dictado.listening
        ? modoEfectivo === 'auto-enviar'
          ? `Escuchando… se envía tras ${Math.round(autoSendDelayMs / 1000)} s de silencio (clic o Alt+V para parar)`
          : 'Escuchando… (clic o Alt+V para parar)'
        : dictado.error
          ? `${dictado.error} · Clic para reintentar`
          : `Dictar por voz (Alt+V) · ${ETIQUETA_MODO[modoEfectivo]}${puedeAutoEnviar ? ' · clic derecho: modo' : ''}`

  const tam = size === 'md' ? 'size-8' : 'size-7'
  const icono = size === 'md' ? 'size-4' : 'size-3.5'

  return (
    <span ref={contenedorRef} className={cn('relative inline-flex shrink-0 items-center', className)} data-voice-dictation="">
      <button
        type="button"
        // El foco se queda en el campo (Alt+V y el cursor siguen ahí).
        onMouseDown={(e) => e.preventDefault()}
        onClick={alternar}
        onContextMenu={(e) => {
          if (!puedeAutoEnviar) return
          e.preventDefault()
          setMenuAbierto((v) => !v)
        }}
        disabled={inactivo && !activo}
        title={titulo}
        aria-label={activo ? 'Detener dictado por voz' : 'Iniciar dictado por voz'}
        aria-pressed={activo}
        className={cn(
          'relative flex items-center justify-center rounded-full transition-all',
          tam,
          activo
            ? 'bg-rose-500/20 text-rose-400 ring-2 ring-rose-500/60'
            : dictado.error
              ? 'text-amber-400 hover:bg-panel-hover'
              : 'text-muted-foreground hover:bg-panel-hover hover:text-foreground',
          inactivo && !activo && 'cursor-not-allowed opacity-40 hover:bg-transparent',
        )}
      >
        {dictado.starting ? (
          <Loader2 className={cn(icono, 'animate-spin')} />
        ) : !dictado.supported ? (
          <MicOff className={icono} />
        ) : (
          <Mic className={cn(icono, dictado.listening && 'scale-110')} />
        )}
        {dictado.listening && (
          <>
            {/* Onda de escucha */}
            <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-rose-500/20" />
            <span className="absolute -right-0.5 -top-0.5 flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-rose-500" />
            </span>
          </>
        )}
        {modoEfectivo === 'auto-enviar' && !activo && dictado.supported && (
          <Zap className="pointer-events-none absolute -bottom-0.5 -right-0.5 size-2.5 fill-accent-amber text-accent-amber" />
        )}
      </button>
      {puedeAutoEnviar && dictado.supported && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenuAbierto((v) => !v)}
          title="Modo de dictado"
          aria-label="Modo de dictado"
          aria-haspopup="menu"
          aria-expanded={menuAbierto}
          className="-ml-0.5 flex h-5 w-3 items-center justify-center rounded text-muted-foreground hover:bg-panel-hover hover:text-foreground"
        >
          <ChevronDown className="size-2.5" />
        </button>
      )}
      {menuAbierto && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-50 mb-1 w-56 overflow-hidden rounded-md border border-border bg-panel py-1 text-[12px] shadow-xl"
        >
          {(['transcribir', 'auto-enviar'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={modoEfectivo === m}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => elegirModo(m)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-foreground hover:bg-panel-raised"
            >
              {m === 'transcribir' ? (
                <Type className="size-3.5 text-emerald-400" />
              ) : (
                <Zap className="size-3.5 text-accent-amber" />
              )}
              <span className="flex-1">
                {m === 'transcribir' ? ETIQUETA_MODO[m] : `${ETIQUETA_MODO[m]} (${Math.round(autoSendDelayMs / 1000)} s)`}
              </span>
              {modoEfectivo === m && <Check className="size-3.5 text-muted-foreground" />}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
