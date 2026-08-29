import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Square, Circle, Repeat, ChevronDown, Triangle, Piano, Crosshair, Timer } from 'lucide-react'
import { useDAW, useDAWState } from '../src/context/daw-context'
import type { DAWState } from '../../shared/src'
import { TransportPositionReadout } from './transport-position-readout'
import { midiController } from '@/src/lib/midi-controller'
import { useLiveBufferMeter } from '@/hooks/use-live-buffer-meter'
import { useProjectReady } from '@/src/context/project-ready-context'
import { waitUntilProjectReady } from '@/src/lib/project-ready'

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
  onCommit: (v: number) => void
  min: number
  max: number
  step?: number
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const valueRef = useRef(value)
  const stepRef = useRef(step)
  const onCommitRef = useRef(onCommit)
  valueRef.current = value
  stepRef.current = step
  onCommitRef.current = onCommit

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  // Listener nativo: React onWheel es passive y no permite preventDefault.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const fine = e.shiftKey ? 0.1 : 1
      const delta = e.deltaY < 0 ? stepRef.current * fine : -stepRef.current * fine
      const next = Math.round((valueRef.current + delta) * 100) / 100
      onCommitRef.current(Math.max(min, Math.min(max, next)))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [min, max])

  const commit = () => {
    const num = Number(draft)
    if (!isNaN(num)) {
      onCommit(Math.max(min, Math.min(max, num)))
    }
    setEditing(false)
  }

  return (
    <div
      ref={rootRef}
      className="flex flex-col items-center leading-none cursor-pointer select-none"
      onDoubleClick={() => { setDraft(String(value)); setEditing(true) }}
    >
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          className="w-14 bg-background text-center font-mono text-[15px] font-semibold text-foreground ring-1 ring-accent-amber rounded px-1 outline-none"
          min={min}
          max={max}
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
  onCommit: (n: number, d: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [numDraft, setNumDraft] = useState(String(numerador))
  const [denDraft, setDenDraft] = useState(String(denominador))
  const numRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const wheelTargetRef = useRef<HTMLDivElement>(null)
  const numeradorRef = useRef(numerador)
  const denominadorRef = useRef(denominador)
  const onCommitRef = useRef(onCommit)
  numeradorRef.current = numerador
  denominadorRef.current = denominador
  onCommitRef.current = onCommit

  useEffect(() => {
    if (editing) {
      numRef.current?.focus()
      numRef.current?.select()
    }
  }, [editing])

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
      e.preventDefault()
      const idx = COMPASES_COMUNES.findIndex(
        ([n, d]) => n === numeradorRef.current && d === denominadorRef.current,
      )
      const next = e.deltaY < 0
        ? (idx + 1) % COMPASES_COMUNES.length
        : (idx - 1 + COMPASES_COMUNES.length) % COMPASES_COMUNES.length
      const [n, d] = COMPASES_COMUNES[next]
      onCommitRef.current(n, d)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [editing])

  const commit = () => {
    const n = Number(numDraft)
    const d = Number(denDraft)
    if (!isNaN(n) && !isNaN(d) && n > 0 && d > 0) {
      onCommit(n, d)
    }
    setEditing(false)
  }

  return (
    <div className="relative flex flex-col items-center leading-none cursor-pointer select-none" ref={pickerRef}>
      {editing ? (
        <div className="flex items-center gap-0.5"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <input
            ref={numRef}
            type="number"
            value={numDraft}
            onChange={(e) => setNumDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
            className="w-7 bg-background text-center font-mono text-[15px] font-semibold text-foreground ring-1 ring-accent-amber rounded px-1 outline-none"
            min={1}
            max={12}
          />
          <span className="font-mono text-[15px] font-semibold text-muted-foreground">/</span>
          <input
            type="number"
            value={denDraft}
            onChange={(e) => setDenDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
            className="w-7 bg-background text-center font-mono text-[15px] font-semibold text-foreground ring-1 ring-accent-amber rounded px-1 outline-none"
            min={1}
            max={32}
          />
        </div>
      ) : (
        <div
          ref={wheelTargetRef}
          className="flex flex-col items-center"
          onClick={() => setShowPicker(!showPicker)}
          onDoubleClick={() => { setNumDraft(String(numerador)); setDenDraft(String(denominador)); setEditing(true) }}
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
              onClick={() => { setShowPicker(false); setNumDraft(String(numerador)); setDenDraft(String(denominador)); setEditing(true) }}
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

  const isPlaying = Boolean(transport.reproduciendo)
  const isRecording = transport.grabacion === 'grabando'
  const isLooping = Boolean(transport.loop?.activo)
  const isMetronome = Boolean(transport.metronomo?.activo)
  const isPunch = Boolean(transport.punch?.activo)
  const isCountIn = Boolean(transport.countIn?.activo)
  // Solo bloquear Play si falta host/audio. La carga de VSTs muestra progreso pero no congela la UI.
  const blocked =
    !isPlaying &&
    projectReady.blocking &&
    (projectReady.phase === 'host' ||
      projectReady.phase === 'device' ||
      projectReady.phase === 'booting' ||
      !projectReady.hostOk ||
      !projectReady.deviceArmed)

  const bpm = project.bpm?.valor ?? 120
  const numerador = project.timeSignature?.numerador ?? 4
  const denominador = project.timeSignature?.denominador ?? 4

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

  const setBpm = async (bpm: number) => {
    await tienda.executor.execute('project.setBpm', { bpm })
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
          disabled={blocked}
          title={blocked ? projectReady.label : undefined}
          aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
          aria-pressed={isPlaying}
          className={`flex size-9 items-center justify-center rounded-md transition-colors ${
            blocked
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
          aria-label="Detener"
          className="flex size-9 items-center justify-center rounded-md text-foreground hover:bg-panel-raised"
        >
          <Square className="size-4" fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={toggleRecording}
          aria-label="Grabar"
          aria-pressed={isRecording}
          className={`flex size-9 items-center justify-center rounded-md transition-colors ${
            isRecording
              ? 'bg-destructive/20 text-destructive animate-pulse'
              : 'text-destructive hover:bg-panel-raised'
          }`}
        >
          <Circle className="size-4" fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={toggleLooping}
          aria-label="Repetir"
          aria-pressed={isLooping}
          className={`flex size-9 items-center justify-center rounded-md transition-colors ${
            isLooping
              ? 'bg-accent-amber/20 text-accent-amber'
              : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
          }`}
        >
          <Repeat className="size-4" />
        </button>
        <button
          type="button"
          onClick={togglePunch}
          aria-label="Punch in/out"
          aria-pressed={isPunch}
          title={
            isPunch
              ? `Punch ${transport.punch?.inicio?.beats?.toFixed?.(1) ?? 0}–${transport.punch?.fin?.beats?.toFixed?.(1) ?? 0} beats`
              : 'Punch in/out (ventana de grabación)'
          }
          className={`flex size-9 items-center justify-center rounded-md transition-colors ${
            isPunch
              ? 'bg-destructive/20 text-destructive'
              : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
          }`}
        >
          <Crosshair className="size-4" />
        </button>
        <button
          type="button"
          onClick={toggleCountIn}
          aria-label="Count-in"
          aria-pressed={isCountIn}
          title={
            isCountIn
              ? `Count-in ${transport.countIn?.compases ?? 1} compás(es)`
              : 'Count-in (pre-roll antes de grabar)'
          }
          className={`flex size-9 items-center justify-center rounded-md transition-colors ${
            isCountIn
              ? 'bg-accent-cyan/20 text-accent-cyan'
              : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
          }`}
        >
          <Timer className="size-4" />
        </button>
      </div>

      <TransportPositionReadout bpm={bpm} beatsPerBar={numerador} />

      <BufferFillMeter playing={isPlaying} />

      <Triangle className="ml-1 size-4 rotate-90 text-muted-foreground" />

      <div className="ml-auto flex items-center gap-5">
        <MidiActivityBadge />
        <EditableStat value={bpm} label="BPM" onCommit={setBpm} min={20} max={300} />
        <TimeSigEditor numerador={numerador} denominador={denominador} onCommit={(n, d) => {
          void tienda.executor.execute('project.setTimeSignature', { numerador: n, denominador: d })
        }} />
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
