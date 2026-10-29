import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Square, Circle, Repeat, ChevronDown, Triangle, Piano, Crosshair, Timer, Magnet, ArrowRightToLine, Headphones, HeadphoneOff, Eye, EyeOff, Volume2, VolumeX } from 'lucide-react'
import { useStereoMeter } from '@/hooks/use-stereo-meter'
import { fijarMonitor, useMonitorSalida } from '@/src/lib/monitor-salida'
import { setDetenerAlFinal, usePreferenciasTransporte } from '@/src/lib/preferencias-transporte'
import { useDAW, useDAWState } from '../src/context/daw-context'
import type { DAWState } from '../../shared/src'
import { safeProjectBpm } from '../../shared/src'
import { TransportPositionReadout } from './transport-position-readout'
import { midiController } from '@/src/lib/midi-controller'
import { useLiveBufferMeter } from '@/hooks/use-live-buffer-meter'
import { useProjectReady } from '@/src/context/project-ready-context'
import { waitUntilProjectReady } from '@/src/lib/project-ready'
import { NumericField } from '@/components/ui/numeric-field'
import { TimeSignatureField } from '@/components/ui/time-signature-field'
import { crearVentanaGesto, opcionesGesto } from '@/src/lib/gesture-id'
import { useRenderLock } from '@/src/lib/render-lock'
import { fijarPreferenciaIA, usePreferenciasIA } from '@/src/lib/preferencias-ia'

/** Blanco=vacío → amarillo=medio → rojo=lleno (fill / highFill). */
function bufferFillColor(level: number): string {
  const t = Math.max(0, Math.min(1, level))
  if (t <= 0.5) {
    const u = t / 0.5
    const r = Math.round(255)
    const g = Math.round(255)
    const b = Math.round(255 * (1 - u))
    return `rgb(${r},${g},${b})`
  }
  const u = (t - 0.5) / 0.5
  const r = 255
  const g = Math.round(255 * (1 - u))
  const b = 0
  return `rgb(${r},${g},${b})`
}

function BufferFillMeter({ playing }: { playing: boolean }) {
  const live = useLiveBufferMeter(playing)
  const level = live?.level ?? 0
  const pct = Math.round(level * 100)
  const color = bufferFillColor(level)
  const connected = live?.connected ?? false
  const status = live?.status ?? 'unknown'
  const flash =
    (live?.underrunDelta ?? 0) > 0 || (live?.overflowDelta ?? 0) > 0 || (live?.dropDelta ?? 0) > 0

  const title = live
    ? [
        `Buffer ${status.toUpperCase()}: ${live.fill}/${live.highFill} (${pct}%)`,
        `daw ${live.dawFill} · maxLive ${live.maxLiveFill} · minLive ${live.minLiveFill}`,
        `live ${live.liveTracks} · queue ${live.mixQueueDepth}${live.mixBackpressure ? ' BP' : ''}`,
        `underrun ${live.underrunBlocks} · overflow ${live.overflowPushes} · drop ${live.highFillDropFrames}`,
        live.hint,
        'Blanco=vacío · amarillo=medio · rojo=lleno',
      ].join('\n')
    : 'Leyendo buffer mix→ASIO…'

  const borderTint =
    status === 'saturated'
      ? 'border-red-500/80'
      : status === 'starving'
        ? 'border-amber-500/80'
        : status === 'disconnected'
          ? 'border-zinc-600'
          : 'border-border/70'

  return (
    <div
      className="flex flex-col items-center gap-0.5"
      title={title}
      aria-label={`Buffer ${pct}% ${status}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div className={`relative h-7 w-2.5 overflow-hidden rounded-sm border bg-black/40 ${borderTint}`}>
        <div
          className="absolute bottom-0 left-0 right-0 transition-[height,background-color] duration-75"
          style={{
            height: `${Math.max(connected || live ? 2 : 0, pct)}%`,
            backgroundColor: connected || live ? color : 'rgb(80,80,80)',
            boxShadow: level > 0.85 || flash ? `0 0 6px ${color}` : undefined,
          }}
        />
        {flash ? (
          <div className="pointer-events-none absolute inset-0 animate-pulse bg-red-500/30" />
        ) : null}
      </div>
      <span
        className={`text-[8px] uppercase tracking-wider ${
          status === 'saturated'
            ? 'text-red-400'
            : status === 'starving'
              ? 'text-amber-400'
              : 'text-muted-foreground'
        }`}
      >
        BUF
      </span>
    </div>
  )
}

/** Toast de entrada rechazada (el editor se cierra y el valor se revierte). */
function useAvisoEntradaInvalida(): (mensaje: string) => void {
  const tienda = useDAW()
  return (mensaje: string) => {
    tienda.busEventos.emit('validacion.advertencia', { code: 'INVALID_INPUT', message: mensaje })
  }
}

function EditableStat({

  value,
  label,
  onCommit,
  min,
  max,
  step = 1,
}: {
  value: number
  label: string
  /** `gestureId`: los giros de rueda seguidos (≤600 ms) comparten gesto → un solo undo. */
  onCommit: (v: number, gestureId?: string) => void
  min: number
  max: number
  step?: number
}) {
  const [editing, setEditing] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const gestoRueda = useRef(crearVentanaGesto(600)).current
  const avisarInvalido = useAvisoEntradaInvalida()
  const valueRef = useRef(value)
  const stepRef = useRef(step)
  const onCommitRef = useRef(onCommit)
  const editingRef = useRef(editing)
  valueRef.current = value
  stepRef.current = step
  onCommitRef.current = onCommit
  editingRef.current = editing

  // Listener nativo: React onWheel es passive y no permite preventDefault.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      // Solo la rueda con el control enfocado o con Alt altera el valor;
      // si no, la rueda debe hacer scroll normal de la interfaz.
      if (editingRef.current) return
      const ae = document.activeElement
      const enfocado = ae === el || (ae instanceof Node && el.contains(ae))
      if (!e.altKey && !enfocado) return
      e.preventDefault()
      const fine = e.shiftKey ? 0.1 : 1
      const delta = e.deltaY < 0 ? stepRef.current * fine : -stepRef.current * fine
      const next = Math.round((valueRef.current + delta) * 100) / 100
      const clamped = Math.max(min, Math.min(max, next))
      if (clamped !== valueRef.current) onCommitRef.current(clamped, gestoRueda())
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [min, max, gestoRueda])

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      data-testid={`stat-${label.toLowerCase()}`}
      className="flex flex-col items-center leading-none cursor-pointer select-none rounded outline-none focus-visible:ring-1 focus-visible:ring-accent-amber/60"
      onDoubleClick={() => setEditing(true)}
    >
      {editing ? (
        // Vacío, NaN o fuera de rango (p. ej. 0) revierte con aviso; Esc cancela.
        <NumericField
          value={value}
          min={min}
          max={max}
          recortar={false}
          step={step}
          autoFocus
          aria-label={label}
          data-testid={`stat-${label.toLowerCase()}-input`}
          onCommit={(v) => onCommit(v)}
          onEnter={() => setEditing(false)}
          onCancel={() => setEditing(false)}
          onInvalid={(m) => avisarInvalido(`${label}: ${m}. Se mantiene ${value}.`)}
          commitOnBlur
          className="w-14 bg-background text-center font-mono text-[15px] font-semibold text-foreground ring-1 ring-accent-amber rounded px-1 outline-none"
        />
      ) : (
        <span className="font-mono text-[15px] font-semibold text-foreground hover:text-accent-amber transition-colors">
          {value}
        </span>
      )}
      <span className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

const COMPASES_COMUNES = [
  [4, 4], [3, 4], [2, 4], [5, 4], [7, 4],
  [6, 8], [3, 8], [5, 8], [7, 8], [9, 8], [12, 8],
] as const

function TimeSigEditor({
  numerador,
  denominador,
  onCommit,
}: {
  numerador: number
  denominador: number
  /** `gestureId`: giros de rueda seguidos comparten gesto → un solo undo. */
  onCommit: (n: number, d: number, gestureId?: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const gestoRueda = useRef(crearVentanaGesto(600)).current
  const avisarInvalido = useAvisoEntradaInvalida()
  const wheelTargetRef = useRef<HTMLDivElement>(null)
  const numeradorRef = useRef(numerador)
  const denominadorRef = useRef(denominador)
  const onCommitRef = useRef(onCommit)
  numeradorRef.current = numerador
  denominadorRef.current = denominador
  onCommitRef.current = onCommit

  useEffect(() => {
    if (!showPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  // Listener nativo: React onWheel es passive y no permite preventDefault.
  useEffect(() => {
    const el = wheelTargetRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      // Solo la rueda con el control enfocado o con Alt altera el compás;
      // si no, la rueda debe hacer scroll normal de la interfaz.
      const ae = document.activeElement
      const enfocado = ae === el || (ae instanceof Node && el.contains(ae))
      if (!e.altKey && !enfocado) return
      e.preventDefault()
      const idx = COMPASES_COMUNES.findIndex(
        ([n, d]) => n === numeradorRef.current && d === denominadorRef.current,
      )
      const next = e.deltaY < 0
        ? (idx + 1) % COMPASES_COMUNES.length
        : (idx - 1 + COMPASES_COMUNES.length) % COMPASES_COMUNES.length
      const [n, d] = COMPASES_COMUNES[next]
      onCommitRef.current(n, d, gestoRueda())
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [editing, gestoRueda])

  const empezarEdicion = () => {
    setShowPicker(false)
    setEditing(true)
  }

  return (
    <div className="relative flex flex-col items-center leading-none cursor-pointer select-none" ref={pickerRef}>
      {editing ? (
        <TimeSignatureField
          numerador={numerador}
          denominador={denominador}
          autoFocus
          onCommit={(n, d) => onCommit(n, d)}
          onDone={() => setEditing(false)}
          onInvalid={avisarInvalido}
          className="flex items-center gap-0.5"
          separatorClassName="font-mono text-[15px] font-semibold text-muted-foreground"
          inputClassName="w-7 bg-background text-center font-mono text-[15px] font-semibold text-foreground ring-1 ring-accent-amber rounded px-1 outline-none"
        />
      ) : (
        <div
          ref={wheelTargetRef}
          tabIndex={0}
          data-testid="timesig"
          className="flex flex-col items-center rounded outline-none focus-visible:ring-1 focus-visible:ring-accent-amber/60"
          onClick={() => setShowPicker(!showPicker)}
          onDoubleClick={empezarEdicion}
        >
          <div className="flex items-baseline gap-0.5">
            <span className="font-mono text-[15px] font-semibold text-foreground hover:text-accent-amber transition-colors">
              {numerador}
            </span>
            <span className="font-mono text-[15px] font-semibold text-muted-foreground">/</span>
            <span className="font-mono text-[15px] font-semibold text-foreground hover:text-accent-amber transition-colors">
              {denominador}
            </span>
          </div>
          <span className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
            SIG
          </span>
        </div>
      )}

      {/* Picker dropdown */}
      {showPicker && !editing && (
        <div className="absolute top-full left-1/2 z-50 mt-1 -translate-x-1/2 rounded-lg border border-border bg-panel shadow-xl p-2">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
            Compás
          </div>
          <div className="grid grid-cols-4 gap-1">
            {COMPASES_COMUNES.map(([n, d]) => {
              const active = n === numerador && d === denominador
              return (
                <button
                  key={`${n}-${d}`}
                  type="button"
                  onClick={() => { onCommit(n, d); setShowPicker(false) }}
                  className={`rounded px-2 py-1 text-center font-mono text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-accent-amber text-background'
                      : 'bg-panel-raised text-foreground hover:bg-accent-amber/20 hover:text-accent-amber'
                  }`}
                >
                  {n}/{d}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex items-center gap-1 border-t border-border pt-1.5 px-1">
            <button
              type="button"
              onClick={empezarEdicion}
              className="flex-1 rounded bg-panel-raised px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Personalizar...
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MidiActivityBadge() {
  const [name, setName] = useState(() => midiController.getStatus().inputName)
  const [hot, setHot] = useState(false)

  useEffect(() => {
    const sync = () => setName(midiController.getStatus().inputName)
    const unsubDev = midiController.subscribeDevices(sync)
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubAct = midiController.subscribeActivity(() => {
      setHot(true)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setHot(false), 120)
    })
    void midiController.start().then(sync)
    return () => {
      unsubDev()
      unsubAct()
      if (timer) clearTimeout(timer)
    }
  }, [])

  return (
    <div className="flex max-w-[160px] items-center gap-1.5 text-muted-foreground" title={name}>
      <span className={`size-1.5 shrink-0 rounded-full ${hot ? 'bg-accent-amber' : 'bg-border'}`} aria-hidden />
      <Piano className="size-3.5 shrink-0" />
      <span className="truncate text-[10px]">{name}</span>
    </div>
  )
}

export function TransportBar() {
  const tienda = useDAW()
  const transport = useDAWState((s: DAWState) => s.transport)
  const project = useDAWState((s: DAWState) => s.project)
  const projectReady = useProjectReady()
  const renderLock = useRenderLock()

  const isPlaying = Boolean(transport.reproduciendo)
  const isRecording = transport.grabacion === 'grabando'
  const isLooping = Boolean(transport.loop?.activo)
  const isMetronome = Boolean(transport.metronomo?.activo)
  const isPunch = Boolean(transport.punch?.activo)
  const isCountIn = Boolean(transport.countIn?.activo)
  const { detenerAlFinal } = usePreferenciasTransporte()
  const isComping = transport.modoGrabacion === 'comping'
  const playheadSnap = useDAWState((s: DAWState) => s.ui?.playheadSnap !== false)
  // Solo bloquear Play si falta host/audio. La carga de VSTs muestra progreso pero no congela la UI.
  const blocked =
    !isPlaying &&
    projectReady.blocking &&
    (projectReady.phase === 'host' ||
      projectReady.phase === 'device' ||
      projectReady.phase === 'booting' ||
      !projectReady.hostOk ||
      !projectReady.deviceArmed)

  const bpm = safeProjectBpm({ project } as DAWState)
  const numerador = project.timeSignature?.numerador ?? 4
  const denominador = project.timeSignature?.denominador ?? 4

  // Recovery: si el estado quedó con NaN (bug histórico), restaurar BPM finito.
  useEffect(() => {
    const raw = project.bpm?.valor
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 20 && raw <= 300) return
    void tienda.executor.execute('project.setBpm', { bpm: 120 }).catch(() => {})
  }, [project.bpm?.valor, tienda])

  const projectName = project.nombre || 'Proyecto sin nombre'

  const togglePlay = async () => {
    if (!isPlaying) {
      await waitUntilProjectReady({ timeoutMs: 18_000, allowDegraded: true })
    }
    await tienda.executor.execute('transport.toggle', {})
  }

  const stop = async () => {
    await tienda.executor.execute('transport.stop', {})
  }

  const toggleRecording = async () => {
    await tienda.executor.execute('transport.toggleRecord', {})
  }

  const toggleCompMode = async () => {
    await tienda.executor.execute('transport.setRecordMode', {
      modo: isComping ? 'normal' : 'comping',
    })
  }

  const toggleLooping = async () => {
    await tienda.executor.execute('transport.toggleLoop', {})
  }

  const toggleMetronome = async () => {
    await tienda.executor.execute('transport.toggleMetronome', {})
  }

  const togglePunch = async () => {
    await tienda.executor.execute('transport.togglePunch', {})
  }

  const toggleCountIn = async () => {
    await tienda.executor.execute('transport.toggleCountIn', {})
  }

  const togglePlayheadSnap = () => {
    tienda.establecerEstado((s) => ({
      ...s,
      ui: { ...s.ui, playheadSnap: !(s.ui?.playheadSnap !== false) },
    }))
  }

  const setBpm = async (bpm: number, gestureId?: string) => {
    await tienda.executor.execute('project.setBpm', { bpm }, 'user', undefined, opcionesGesto('project.bpm', gestureId))
  }

  return (
    <header className="flex h-14 items-center gap-4 border-b border-border bg-panel px-4">
      <button
        type="button"
        className="flex items-center gap-1.5 text-[14px] font-semibold text-foreground hover:text-muted-foreground"
      >
        {projectName}
        <ChevronDown className="size-4 text-muted-foreground" />
      </button>

      <div className="ml-2 flex items-center gap-1">
        <button
          type="button"
          onClick={togglePlay}
          disabled={blocked || renderLock}
          title={renderLock ? 'Render en curso' : blocked ? projectReady.label : undefined}
          aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
          aria-pressed={isPlaying}
          className={`flex size-9 items-center justify-center rounded-md transition-colors ${
            blocked || renderLock
              ? 'cursor-wait opacity-50 text-muted-foreground'
              : isPlaying
                ? 'bg-track-fx/20 text-track-fx'
                : 'text-foreground hover:bg-panel-raised'
          }`}
        >
          {isPlaying ? (
            <Pause className="size-5" fill="currentColor" />
          ) : (
            <Play className="size-5" fill="currentColor" />
          )}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={renderLock}
          title={renderLock ? 'Render en curso' : undefined}
          aria-label="Detener"
          className={`flex size-9 items-center justify-center rounded-md text-foreground hover:bg-panel-raised ${
            renderLock ? 'cursor-wait opacity-50 text-muted-foreground' : ''
          }`}
        >
          <Square className="size-4" fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={toggleRecording}
          disabled={renderLock}
          title={renderLock ? 'Render en curso' : undefined}
          aria-label="Grabar"
          aria-pressed={isRecording}
          className={`flex size-9 items-center justify-center rounded-md transition-colors ${
            renderLock
              ? 'cursor-wait opacity-50 text-muted-foreground'
              : isRecording
                ? 'bg-destructive/20 text-destructive animate-pulse'
                : 'text-destructive hover:bg-panel-raised'
          }`}
        >
          <Circle className="size-4" fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={toggleCompMode}
          disabled={renderLock}
          aria-label="Modo comping"
          aria-pressed={isComping}
          title="Comping: cada pasada añade una toma"
          className={`flex h-9 items-center justify-center rounded-md px-2 text-[10px] font-semibold transition-colors ${
            renderLock
              ? 'cursor-wait opacity-50 text-muted-foreground'
              : isComping
                ? 'bg-accent-amber/25 text-accent-amber'
                : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
          }`}
        >
          COMP
        </button>
        <button
          type="button"
          onClick={toggleLooping}
          disabled={renderLock}
          aria-label="Repetir"
          aria-pressed={isLooping}
          className={`flex size-9 items-center justify-center rounded-md transition-colors ${
            renderLock
              ? 'cursor-wait opacity-50 text-muted-foreground'
              : isLooping
                ? 'bg-accent-amber/20 text-accent-amber'
                : 'text-foreground hover:bg-panel-raised'
          }`}
        >
          <Repeat className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setDetenerAlFinal(!detenerAlFinal)}
          aria-label="Detener al final de la canción"
          aria-pressed={detenerAlFinal}
          title={
            detenerAlFinal
              ? 'Al terminar la canción se detiene y vuelve al inicio (clic para reproducir sin fin)'
              : 'Reproducción sin fin: no se detiene al terminar la canción (clic para detener al final)'
          }
          className={`flex size-9 items-center justify-center rounded-md transition-colors ${
            detenerAlFinal ? 'bg-accent-amber/20 text-accent-amber' : 'text-foreground hover:bg-panel-raised'
          }`}
        >
          <ArrowRightToLine className="size-4" />
        </button>
        <button
          type="button"
          onClick={togglePunch}
          disabled={renderLock}
          aria-label="Punch in/out"
          aria-pressed={isPunch}
          title={
            renderLock
              ? 'Render en curso'
              : isPunch
                ? `Punch ${transport.punch?.inicio?.beats?.toFixed?.(1) ?? 0}–${transport.punch?.fin?.beats?.toFixed?.(1) ?? 0} beats`
                : 'Punch in/out (ventana de grabación)'
          }
          className={`flex size-9 items-center justify-center rounded-md transition-colors ${
            renderLock
              ? 'cursor-wait opacity-50 text-muted-foreground'
              : isPunch
                ? 'bg-destructive/20 text-destructive'
                : 'text-muted-foreground hover:bg-panel-raised'
          }`}
        >
          <Crosshair className="size-4" />
        </button>
        <button
          type="button"
          onClick={toggleCountIn}
          disabled={renderLock}
          aria-label="Count-in"
          aria-pressed={isCountIn}
          title={
            renderLock
              ? 'Render en curso'
              : isCountIn
                ? `Count-in ${transport.countIn?.compases ?? 1} compás(es)`
                : 'Count-in (pre-roll antes de grabar)'
          }
          className={`flex size-9 items-center justify-center rounded-md transition-colors ${
            renderLock
              ? 'cursor-wait opacity-50 text-muted-foreground'
              : isCountIn
                ? 'bg-accent-cyan/20 text-accent-cyan'
                : 'text-muted-foreground hover:bg-panel-raised'
          }`}
        >
          <Timer className="size-4" />
        </button>
        <button
          type="button"
          onClick={togglePlayheadSnap}
          aria-label="Precisión del playhead"
          aria-pressed={playheadSnap}
          title={
            playheadSnap
              ? 'Imán ON: playhead y clips anclados a la profundidad del selector de encaje'
              : 'Imán OFF: seek y clips libres (sin anclar a la rejilla)'
          }
          className={`flex size-9 items-center justify-center rounded-md transition-colors ${
            playheadSnap
              ? 'bg-accent-amber/20 text-accent-amber'
              : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
          }`}
        >
          <Magnet className="size-4" />
        </button>
      </div>

      <TransportPositionReadout bpm={bpm} beatsPerBar={numerador} />

      <BufferFillMeter playing={isPlaying} />

      <Triangle className="ml-1 size-4 rotate-90 text-muted-foreground" />

      <div className="ml-auto flex items-center gap-5">
        <MidiActivityBadge />
        <EditableStat value={bpm} label="BPM" onCommit={setBpm} min={20} max={300} />
        <TimeSigEditor numerador={numerador} denominador={denominador} onCommit={(n, d, gestureId) => {
          void tienda.executor.execute(
            'project.setTimeSignature',
            { numerador: n, denominador: d },
            'user',
            undefined,
            opcionesGesto('project.timeSignature', gestureId),
          )
        }} />

        <MonitorSalida />

        <BotonesIA />

        <button
          type="button"
          onClick={toggleMetronome}
          aria-label={isMetronome ? 'Desactivar metrónomo' : 'Activar metrónomo'}
          aria-pressed={isMetronome}
          className={`flex size-8 items-center justify-center rounded-md transition-colors ${
            isMetronome
              ? 'bg-accent-cyan/20 text-accent-cyan'
              : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
          }`}
          title={isMetronome ? 'Metrónomo activo' : 'Metrónomo inactivo'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="2" y1="12" x2="22" y2="12" />
            <line x1="12" y1="2" x2="12" y2="12" />
            <circle cx="12" cy="18" r="3" fill={isMetronome ? 'currentColor' : 'none'} />
          </svg>
        </button>
      </div>
    </header>
  )
}

/**
 * Señal estéreo del master y volumen hacia los altavoces. El volumen NO cambia el master ni lo que se
 * exporta: con él a cero (o con la IA trabajando en silencio) el medidor sigue mostrando la señal.
 */
function MonitorSalida() {
  const m = useMonitorSalida()
  const picos = useStereoMeter('master')
  // Retención de pico: la marca cae despacio (≈0,6/s) para que un golpe breve se vea aunque dure 20 ms.
  // La caída va con su propio reloj: si dependiera solo de que cambie la lectura, con señal constante o en
  // silencio la marca se quedaba congelada a media barra.
  const [pico, setPico] = useState({ l: 0, r: 0 })
  const ultimo = useRef(picos)
  ultimo.current = picos
  useEffect(() => {
    const paso = () =>
      setPico((prev) => {
        const p = ultimo.current
        const l = p.l >= prev.l ? p.l : Math.max(p.l, prev.l - 0.03)
        const r = p.r >= prev.r ? p.r : Math.max(p.r, prev.r - 0.03)
        return l === prev.l && r === prev.r ? prev : { l, r }
      })
    const t = setInterval(paso, 50)
    return () => clearInterval(t)
  }, [])
  const silencio = m.silenciado || m.silencioIA
  // Por debajo de −70 dB (ruido del analizador en reposo) la barra marca 0: con el transporte parado se ve silencio.
  const escala = (p: number) => (p < 3e-4 ? 0 : Math.round(Math.min(1, Math.sqrt(Math.max(0, p))) * 100))
  const ancho = (p: number) => `${escala(p)}%`
  const color = (p: number) => (p > 0.98 ? 'bg-rose-500' : silencio ? 'bg-muted-foreground/70' : p > 0.7 ? 'bg-accent-amber' : 'bg-accent-cyan')
  const titulo = m.silencioIA
    ? 'La IA está trabajando sin sacar audio: hay señal en el master pero no sale por los altavoces. Enciende «Escuchar a la IA» para oírla.'
    : m.silenciado
      ? 'Salida silenciada: el master sigue sonando por dentro (y se exporta igual), pero nada sale por los altavoces.'
      : 'Señal del master y volumen hacia los altavoces. No cambia el master ni lo que se exporta.'
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Monitorización" data-testid="monitor-salida" title={titulo}>
      <div className="flex w-20 flex-col gap-0.5" aria-label="Señal estéreo del master" data-testid="monitor-medidor">
        {([
          ['L', picos.l, pico.l],
          ['R', picos.r, pico.r],
        ] as const).map(([canal, p, retenido]) => (
          <div key={canal} className="relative h-2 overflow-hidden rounded-sm bg-panel-base/80" aria-label={`Canal ${canal}`}>
            <div className={`h-full transition-[width] duration-75 ${color(p)}`} style={{ width: ancho(p) }} data-nivel={escala(p)} />
            {retenido > 0.01 ? (
              <div
                className={`absolute inset-y-0 w-px ${retenido > 0.98 ? 'bg-rose-300' : 'bg-foreground/80'}`}
                style={{ left: `calc(${ancho(retenido)} - 1px)` }}
                aria-hidden
              />
            ) : null}
          </div>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={m.silenciado}
        aria-label={m.silenciado ? 'Activar la salida a los altavoces' : 'Silenciar la salida a los altavoces'}
        onClick={() => fijarMonitor({ silenciado: !m.silenciado })}
        className={`relative flex size-8 items-center justify-center rounded-md transition-colors ${
          silencio ? 'bg-rose-500/20 text-rose-300' : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
        }`}
      >
        {silencio ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        {m.silencioIA ? (
          <span className="absolute -right-0.5 -top-0.5 rounded bg-accent-amber px-0.5 text-[8px] font-bold leading-3 text-black" data-testid="monitor-silencio-ia">
            IA
          </span>
        ) : null}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(m.volumen * 100)}
        aria-label="Volumen de los altavoces"
        onChange={(e) => fijarMonitor({ volumen: Number(e.target.value) / 100 })}
        className="h-1 w-16 cursor-pointer accent-accent-cyan"
        data-testid="monitor-volumen"
      />
    </div>
  )
}

/**
 * Qué percibe el usuario del trabajo de la IA: escucharlo (suena cada parte que graba y la mezcla mientras
 * se hace) y verlo (se ilumina lo que toca). Independientes: se puede ver sin escuchar.
 */
function BotonesIA() {
  const { escuchar, ver } = usePreferenciasIA()
  const base = 'flex h-8 items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors'
  const on = 'bg-accent-amber/20 text-accent-amber'
  const off = 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Seguir el trabajo de la IA" data-testid="transporte-ia">
      <span className="mr-0.5 text-[10px] font-semibold text-muted-foreground">IA</span>
      <button
        type="button"
        aria-pressed={escuchar}
        aria-label="Escuchar lo que hace la IA"
        title={escuchar ? 'Escuchando a la IA: suena cada parte que graba y la mezcla mientras la hace. Clic para no escuchar.' : 'Sin escuchar a la IA (trabaja en silencio). Clic para oír lo que va haciendo.'}
        onClick={() => fijarPreferenciaIA({ escuchar: !escuchar })}
        className={`${base} ${escuchar ? on : off}`}
      >
        {escuchar ? <Headphones className="size-4" /> : <HeadphoneOff className="size-4" />}
      </button>
      <button
        type="button"
        aria-pressed={ver}
        aria-label="Ver lo que toca la IA"
        title={ver ? 'Viendo a la IA: se ilumina cada fader, perilla o FX que toca. Clic para no resaltarlo.' : 'Sin resaltar lo que toca la IA. Clic para verlo iluminado.'}
        onClick={() => fijarPreferenciaIA({ ver: !ver })}
        className={`${base} ${ver ? on : off}`}
      >
        {ver ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
      </button>
    </div>
  )
}
