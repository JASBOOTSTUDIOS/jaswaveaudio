import { useMemo, useCallback, useEffect, useRef, useState } from 'react'
import { Minus, SlidersHorizontal, Wand2, Shuffle, Headphones, GripVertical, ChartColumn } from 'lucide-react'
import { useDAW, useDAWState } from '../src/context/daw-context'
import type { Track as SharedTrack, AudioTrack } from '../../shared/src/types/tracks'
import type { DAWState } from '../../shared/src/types/state'
import type { PluginInfo } from '../../shared/src/types/entidades'
import {
  DB_SUPERIOR,
  DB_INFERIOR,
  linealADb,
  dbALineal,
  formatearPan,
  panADisplay,
} from '@/lib/audio-conversions'
import { KnobControl, LevelMeterBarHorizontal } from './ui/controls'
import { CAMPOS_IA, ResaltoIA } from './ui/resalto-ia'
import { ChannelFaderBlock } from './ui/channel-fader-block'
import { MiniSpectrum } from './mini-spectrum'
import { useElementSize, useTierConHisteresis } from '@/hooks/use-element-size'
import { ChannelFxBank } from '@/components/channel-fx-bank'
import { TrackMidiInput } from '@/components/track-midi-input'
import { TrackAudioInput } from '@/components/track-audio-input'
import { getSelectedTrackId, selectTrackPayload } from '@/src/lib/selection-helpers'
import { revelarEnScroller } from '@/src/lib/scroll-reveal'
import { midiInputOf } from '@/src/lib/midi-track-io'
import {
  ANCHO_ESTRECHO,
  ANCHO_TIRA,
  anchoConRueda,
  guardarAnchoTira,
  leerAnchoTira,
  seccionesMixer,
  umbralesMixer,
  type PaneoMixer,
} from '@/src/lib/mixer-layout'
import { audioInputOf } from '@/src/lib/audio-track-io'
import { audioEngine } from '@/lib/audio-engine'
import {
  isNativeMeterHostAvailable,
  refreshNativeMixMeters,
  setMixMeterTrackOrder,
} from '@/src/lib/plugin/native-mix-meters'
import { extractHostPluginPath } from '@/src/lib/plugin/plugin-info-adapter'
import { isBuiltinInstrument } from '@/src/lib/plugin/track-vst-runtime'
import { maybeWriteAutomationPoint } from '@/components/automation-lanes-panel'
import { crearVentanaGesto, opcionesGesto } from '@/src/lib/gesture-id'
import { batchOrNotify } from '@/src/lib/execute-or-toast'


type StereoPeaks = { l: number; r: number }
const SILENCIO: StereoPeaks = { l: 0, r: 0 }

type MixerRow = {
  id: string
  name: string
  color: string
  muted: boolean
  solo: boolean
  input: boolean
  armed: boolean
  db: number
  pan: number
  fxCount: number
  tipo: string
  plugins: PluginInfo[]
  entrada?: string
  dispositivoEntrada?: string
}

function trackHasHostVst(plugins: PluginInfo[]): boolean {
  return plugins.some((p) => {
    if (isBuiltinInstrument(p)) return false
    return !!extractHostPluginPath(p.descripcion ?? '', p.id)
  })
}

function toMixerRow(track: SharedTrack): MixerRow {
  const linearVol = typeof track.volumen === 'number' ? track.volumen : 0.8
  return {
    id: track.id,
    name: track.nombre,
    color: track.color,
    muted: track.silenciada,
    solo: track.soloActiva,
    input: Boolean((track as AudioTrack).configuracion?.monitorizarEntrada),
    armed: track.armada,
    db: linealADb(linearVol),
    pan: panADisplay(track.paneo),
    fxCount: track.plugins?.length ?? 0,
    tipo: track.tipo,
    plugins: track.plugins ?? [],
    entrada: midiInputOf(track) || undefined,
    dispositivoEntrada: audioInputOf(track) || undefined,
  }
}

function TrackButton({
  children,
  active,
  activeClass = 'bg-accent-amber text-background',
  onClick,
  label,
}: {
  children: React.ReactNode
  active?: boolean
  activeClass?: string
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex size-4 items-center justify-center rounded text-[9px] font-bold transition-colors ${
        active
          ? activeClass
          : 'bg-panel-raised text-muted-foreground ring-1 ring-border hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Paneo de la tira: perilla si hay alto, barra fina si no (así el hueco que deja la perilla no queda vacío).
 * Doble clic o clic central: centro.
 */
function PanControl({
  modo,
  value,
  color,
  onChange,
}: {
  modo: PaneoMixer
  value: number
  color: string
  onChange: (pan: number, gestureId?: string) => void
}) {
  const gesto = useMemo(() => crearVentanaGesto(600), [])
  if (modo === 'oculto') return null
  if (modo === 'perilla') {
    return (
      <div className="mt-1 flex shrink-0 justify-center">
        <KnobControl value={value} color={color} onChange={onChange} size="size-8" />
      </div>
    )
  }
  const centrar = () => {
    if (value !== 0) onChange(0)
  }
  return (
    <label className="mt-1 flex h-4 shrink-0 items-center gap-1" title={`Paneo ${formatearPan(value / 100)} · doble clic: centro`}>
      <span className="w-3 shrink-0 font-mono text-[8px] text-muted-foreground">L</span>
      <input
        type="range"
        min={-100}
        max={100}
        value={value}
        aria-label="Paneo"
        className="h-1 min-w-0 flex-1"
        style={{ accentColor: color.startsWith('var(') ? undefined : color }}
        onChange={(e) => onChange(Number(e.target.value), gesto())}
        onDoubleClick={centrar}
        onMouseDown={(e) => {
          if (e.button === 1) {
            e.preventDefault()
            centrar()
          }
        }}
        onAuxClick={(e) => {
          if (e.button === 1) e.preventDefault()
        }}
      />
      <span className="w-3 shrink-0 text-right font-mono text-[8px] text-muted-foreground">R</span>
    </label>
  )
}

/** Botón de la cabecera de la tira que abre/cierra su mini espectro. */
function SpectrumToggle({ abierto, nombre, onToggle }: { abierto: boolean; nombre: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Espectro de ${nombre}`}
      aria-pressed={abierto}
      title={abierto ? 'Ocultar espectro' : 'Mostrar espectro'}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={`flex size-4 shrink-0 items-center justify-center rounded ${
        abierto ? 'bg-accent-cyan text-background' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <ChartColumn className="size-3" />
    </button>
  )
}

export function Mixer() {
  const tienda = useDAW()
  const tracks = useDAWState((s: DAWState) => s.project?.tracks ?? [])
  const master = useDAWState((s: DAWState) => s.project?.master)
  const routing = useDAWState((s: DAWState) => s.project?.routing)
  const collapsedUser = useDAWState((s: DAWState) => s.ui?.estadoMezcladorUI?.colapsado ?? false)
  // Ancho de las tiras: solo lo decide el usuario (Ctrl + rueda o el botón de colapsar), nunca el alto.
  const [anchoTira, setAnchoTira] = useState(leerAnchoTira)
  const ancho = collapsedUser ? ANCHO_TIRA.min : anchoTira
  const estrecho = ancho < ANCHO_ESTRECHO
  // El alto decide qué se ve (primero se quitan FX/envíos, luego el paneo; M/S + volumen siempre). Se mide el
  // contenedor EXTERIOR (no cambia con la barra de scroll horizontal) y con histéresis para no parpadear.
  const stripsRef = useRef<HTMLDivElement>(null)
  /** Scroller horizontal de las tiras. */
  const scrollTirasRef = useRef<HTMLDivElement>(null)
  const { height: stripsH } = useElementSize(stripsRef)
  const umbrales = useMemo(() => umbralesMixer(estrecho), [estrecho])
  const { paneo: modoPaneo, extras: verExtras } = seccionesMixer(useTierConHisteresis(stripsH, umbrales))

  useEffect(() => {
    const el = stripsRef.current
    if (!el) return
    // Listener nativo no pasivo: con Ctrl la rueda cambia el ancho y no llega a faders, scroll ni zoom global.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      setAnchoTira((a) => {
        const n = anchoConRueda(a, e.deltaY)
        if (n !== a) guardarAnchoTira(n)
        return n
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => el.removeEventListener('wheel', onWheel, { capture: true })
  }, [])
  const selectedTrackId = useDAWState((s: DAWState) => getSelectedTrackId(s))
  const stripRefs = useRef(new Map<string, HTMLDivElement | null>())
  const [meters, setMeters] = useState<Record<string, number>>({})
  const [stereo, setStereo] = useState<Record<string, StereoPeaks>>({})
  /** Tiras con el mini espectro abierto: cada una es independiente (el host tiene un tap por pista). */
  const [espectros, setEspectros] = useState<ReadonlySet<string>>(() => new Set())
  const alternarEspectro = useCallback((id: string) => {
    setEspectros((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const [dragTrackId, setDragTrackId] = useState<string | null>(null)
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null)
  const trackIdsKey = tracks.map((t) => t.id).join('|')

  const moveTrackToIndex = useCallback(
    (trackId: string, toIndex: number) => {
      void tienda.executor.execute('track.move', { trackId, toIndex })
    },
    [tienda],
  )

  useEffect(() => {
    let raf = 0
    let last = 0
    let cancelled = false
    const ids = trackIdsKey.split('|').filter(Boolean)
    // Solo alinear el mapa de medidores; no rewirear stems aquí (lo hace track-vst-runtime).
    setMixMeterTrackOrder(ids)
    const tick = (now: number) => {
      if (cancelled) return
      if (now - last >= 50) {
        last = now
        const apply = () => {
          if (cancelled) return
          const next: Record<string, number> = { master: audioEngine.getMasterMeterLevel() }
          const nextStereo: Record<string, StereoPeaks> = { master: audioEngine.getMasterStereoPeaks() }
          for (const id of ids) {
            next[id] = audioEngine.getMeterLevel(id)
            next[`in:${id}`] = audioEngine.getInputMeterLevel(id)
            nextStereo[id] = audioEngine.getStereoMeterPeaks(id)
          }
          setMeters(next)
          setStereo(nextStereo)
        }
        if (isNativeMeterHostAvailable()) {
          void refreshNativeMixMeters().then(apply)
        } else {
          apply()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [trackIdsKey])

  // Pista seleccionada (aquí o en el Arrange): su tira se desplaza a la vista, solo en horizontal y solo
  // dentro del mixer (scrollIntoView movía también el layout del workspace).
  useEffect(() => {
    if (!selectedTrackId) return
    revelarEnScroller(scrollTirasRef.current, stripRefs.current.get(selectedTrackId), 'x')
  }, [selectedTrackId])

  const handleToggleMute = (id: string) => {
    void tienda.executor.execute('track.toggleMute', { trackId: id })
  }

  const handleToggleSolo = (id: string) => {
    void tienda.executor.execute('track.toggleSolo', { trackId: id })
  }

  const handleToggleArm = (id: string) => {
    void tienda.executor.execute('track.toggleArm', { trackId: id })
  }

  const handleToggleMonitor = (id: string) => {
    void tienda.executor.execute('track.toggleMonitor', { trackId: id })
  }

  const playing = useDAWState((s: DAWState) => Boolean(s.transport?.reproduciendo))

  /** Arrastre del slider de envío: los cambios seguidos (≤600 ms) son un solo undo. */
  const gestoEnvio = useMemo(() => crearVentanaGesto(600), [])

  // Un arrastre de fader/knob = una entrada de undo (también los puntos de
  // automatización escritos durante el gesto: misma clave de coalescencia).
  const handleChangeDb = (id: string, db: number, gestureId?: string) => {
    const volumen = db > DB_INFERIOR ? dbALineal(db) : 0
    const opciones = opcionesGesto(`mixer.volumen:${id}`, gestureId)
    void tienda.executor.execute('track.update', { trackId: id, datos: { volumen } }, 'user', undefined, opciones)
    maybeWriteAutomationPoint(tienda, id, 'volumen', volumen, playing, opciones)
  }

  const handleChangePan = (id: string, pan: number, gestureId?: string) => {
    const paneo = pan / 100
    const opciones = opcionesGesto(`mixer.paneo:${id}`, gestureId)
    void tienda.executor.execute('track.update', { trackId: id, datos: { paneo } }, 'user', undefined, opciones)
    maybeWriteAutomationPoint(tienda, id, 'paneo', paneo, playing, opciones)
  }

  const trackList = useMemo(() => tracks.map(toMixerRow) as MixerRow[], [tracks])

  const masterTrack = useMemo(
    () => {
      const masterVol = master?.volumen ?? 1
      return {
        id: 'master',
        name: 'Master',
        color: 'var(--foreground)',
        seed: 0,
        db: linealADb(masterVol),
        pan: (master?.paneo ?? 0) * 100,
      }
    },
    [master],
  )

  const handleAutoMix = useCallback(() => {
    // Auto-balance: spread volumes evenly across tracks
    const count = trackList.length
    if (count === 0) return
    const perTrackDb = -Math.max(3, Math.log2(count) * 3) // -3dB per doubling of tracks
    const volumen = dbALineal(Math.max(DB_INFERIOR, perTrackDb))
    // Volumen repartido y paneo centrado: un solo lote = un undo.
    void batchOrNotify(
      tienda,
      trackList.map((track) => ({ type: 'track.update', payload: { trackId: track.id, datos: { volumen, paneo: 0 } } })),
      'mixer.autoMix',
    )
  }, [trackList, tienda])

  const handleRandomize = useCallback(() => {
    const comandos = trackList.map((track) => {
      const randomDb = DB_INFERIOR + Math.random() * (DB_SUPERIOR - DB_INFERIOR)
      const volumen = randomDb > DB_INFERIOR ? dbALineal(randomDb) : 0
      const paneo = (Math.random() * 2 - 1) // -1 to 1
      return { type: 'track.update', payload: { trackId: track.id, datos: { volumen, paneo } } }
    })
    void batchOrNotify(tienda, comandos, 'mixer.randomize')
  }, [trackList, tienda])

  return (
    <section className="flex h-full min-h-0 flex-col bg-panel">
      {/* Barra de herramientas del mixer */}
      <div className="flex h-9 items-center gap-1 border-b border-border px-3">
        <button
          type="button"
          aria-label="Colapsar mixer"
          onClick={() => tienda.establecerEstado((s) => ({ ...s, ui: { ...s.ui, estadoMezcladorUI: { ...s.ui?.estadoMezcladorUI, canalesVisibles: s.ui?.estadoMezcladorUI?.canalesVisibles ?? [], nivelMaster: s.ui?.estadoMezcladorUI?.nivelMaster ?? 0, seleccionando: s.ui?.estadoMezcladorUI?.seleccionando ?? false, seleccionInicio: s.ui?.estadoMezcladorUI?.seleccionInicio ?? 0, seleccionFin: s.ui?.estadoMezcladorUI?.seleccionFin ?? 0, colapsado: !collapsedUser } } }))}
          className={`flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-panel-raised hover:text-foreground ${collapsedUser ? 'bg-panel-raised text-foreground' : ''}`}
        >
          <Minus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Vista de faders"
          className="flex size-6 items-center justify-center rounded bg-panel-raised text-foreground ring-1 ring-border"
        >
          <SlidersHorizontal className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Automezcla"
          onClick={handleAutoMix}
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          title="Auto-balancear volumen y paneo"
        >
          <Wand2 className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Aleatorizar"
          onClick={handleRandomize}
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          title="Aleatorizar volumen y paneo"
        >
          <Shuffle className="size-4" />
        </button>
      </div>

      {/* Tiras de canal */}
      <div ref={stripsRef} className="relative min-h-0 flex-1 bg-panel">
      <div ref={scrollTirasRef} className="jw-scrollbar absolute inset-0 flex overflow-x-auto overflow-y-hidden">
        {trackList.map((track, trackIndex) => (
          <div
            key={track.id}
            ref={(el) => {
              stripRefs.current.set(track.id, el)
            }}
            onDragOver={(e) => {
              if (!dragTrackId || dragTrackId === track.id) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDragOverTrackId(track.id)
            }}
            onDragLeave={() => {
              if (dragOverTrackId === track.id) setDragOverTrackId(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData('text/jaswave-track-id') || dragTrackId
              setDragOverTrackId(null)
              setDragTrackId(null)
              if (!id || id === track.id) return
              moveTrackToIndex(id, trackIndex)
            }}
            data-testid={`mixer-strip-${track.id}`}
            style={{ width: ancho }}
            title="Ctrl + rueda: ancho de las tiras"
            className={`flex h-full min-h-0 shrink-0 cursor-pointer flex-col border-r border-border px-2 py-2 ${
              selectedTrackId === track.id
                ? 'bg-accent-amber/20 ring-1 ring-inset ring-accent-amber/50'
                : 'hover:bg-panel-raised/40'
            } ${dragOverTrackId === track.id && dragTrackId !== track.id ? 'ring-1 ring-inset ring-accent-amber' : ''} ${
              dragTrackId === track.id ? 'opacity-60' : ''
            }`}
            onClick={() => {
              void tienda.executor.execute('selection.set', selectTrackPayload(track.id))
            }}
          >
            {/* Nombre */}
            <div className="mb-1.5 flex items-center justify-center gap-0.5">
              <button
                type="button"
                draggable
                aria-label={`Reordenar ${track.name}`}
                title="Arrastrar para reordenar"
                className="shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing hover:text-foreground"
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/jaswave-track-id', track.id)
                  e.dataTransfer.effectAllowed = 'move'
                  setDragTrackId(track.id)
                }}
                onDragEnd={() => {
                  setDragTrackId(null)
                  setDragOverTrackId(null)
                }}
              >
                <GripVertical className="size-3" />
              </button>
              <p
                className="min-w-0 truncate text-center text-[11px] font-medium text-foreground"
                title={track.name}
              >
                {track.name}
              </p>
              {!estrecho && verExtras ? (
                <SpectrumToggle
                  abierto={espectros.has(track.id)}
                  nombre={track.name}
                  onToggle={() => alternarEspectro(track.id)}
                />
              ) : null}
            </div>
            {/* Botones de la pista (M, S, monitor, grabación): siempre fuera del scroll. */}
            <div className="mb-1 flex shrink-0 flex-wrap items-center justify-center gap-1" data-testid={`mixer-botones-${track.id}`}>
              <ResaltoIA trackId={track.id} campos={CAMPOS_IA.mute}>
                <TrackButton
                  label={`Silenciar ${track.name}`}
                  active={track.muted}
                  onClick={() => handleToggleMute(track.id)}
                >
                  M
                </TrackButton>
              </ResaltoIA>
              <ResaltoIA trackId={track.id} campos={CAMPOS_IA.solo}>
                <TrackButton
                  label={`Solo ${track.name}`}
                  active={track.solo}
                  activeClass="bg-track-vocals text-background"
                  onClick={() => handleToggleSolo(track.id)}
                >
                  S
                </TrackButton>
              </ResaltoIA>
              <TrackButton
                label={`Monitor de entrada ${track.name}`}
                active={track.input}
                activeClass="bg-accent-cyan text-background"
                onClick={() => handleToggleMonitor(track.id)}
              >
                <Headphones className="size-2.5" />
              </TrackButton>
              <TrackButton
                label={`Armar grabación ${track.name}`}
                active={track.armed}
                onClick={() => handleToggleArm(track.id)}
              >
                <span
                  className={`size-1.5 rounded-full ${track.armed ? 'bg-background' : 'bg-muted-foreground'}`}
                />
              </TrackButton>
            </div>

            {/*
              Entradas (MIDI/audio), tipo, espectro y medidores quedan fijos; SOLO los FX tienen scroll propio y
              ocupan el alto sobrante. Sin sitio para ellos, el sobrante queda como separación hasta el paneo.
            */}
            {!verExtras ? (
              <div className="min-h-0 flex-1" />
            ) : (
            <>
            <div className="shrink-0">
            {espectros.has(track.id) && !estrecho ? (
              <div className="mb-1">
                <MiniSpectrum trackId={track.id} color={track.color} />
              </div>
            ) : null}
            {(track.tipo === 'midi' || track.tipo === 'instrumento' || track.tipo === 'audio') ? (
              <div className="mb-1">
                <TrackMidiInput trackId={track.id} assignedId={track.entrada} compact />
              </div>
            ) : null}
            {(track.tipo === 'midi' || track.tipo === 'instrumento') &&
            trackHasHostVst(track.plugins) ? (
              <div
                className="mb-1 h-1 overflow-hidden rounded-full bg-panel-raised"
                title="Nivel VST (post-fader)"
              >
                <LevelMeterBarHorizontal level={meters[track.id] ?? 0} />
              </div>
            ) : null}
            {track.tipo === 'audio' ? (
              <div className="mb-1">
                <TrackAudioInput trackId={track.id} assignedId={track.dispositivoEntrada} compact />
                {(track.input || track.armed) ? (
                  <div
                    className="mt-0.5 h-1 overflow-hidden rounded-full bg-panel-raised"
                    title="Nivel de entrada"
                  >
                    <LevelMeterBarHorizontal level={meters[`in:${track.id}`] ?? 0} />
                  </div>
                ) : null}
              </div>
            ) : null}
            </div>
            <div className="jw-scrollbar -mx-1 mb-1 min-h-0 flex-1 overflow-y-auto px-1 py-0.5" data-testid={`mixer-inserts-${track.id}`}>
              <ResaltoIA trackId={track.id} campos={CAMPOS_IA.fx}>
                <ChannelFxBank
                  trackId={track.id}
                  trackName={track.name}
                  plugins={track.plugins}
                />
              </ResaltoIA>
            </div>

            {/* Sends post-fader (MVP): fijos, debajo de los FX */}
            {(routing?.buses?.length ?? 0) > 0 ? (
              <ResaltoIA trackId={track.id} campos={CAMPOS_IA.envios} className="mb-1 shrink-0 space-y-0.5">
                {(routing?.buses ?? []).map((bus) => {
                  const send = routing?.sends?.find(
                    (e) => e.origenTrackId === track.id && e.destinoBusId === bus.id && e.activo,
                  )
                  const amount = Math.round((send?.cantidad ?? 0) * 100)
                  return (
                    <label
                      key={bus.id}
                      className="flex items-center gap-1 text-[8px] text-muted-foreground"
                      title={`Send → ${bus.nombre}`}
                    >
                      <span className="w-6 truncate">{bus.nombre.slice(0, 3)}</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={amount}
                        className="h-1 w-full accent-accent-amber"
                        onDoubleClick={() => {
                          if (amount === 0) return
                          void tienda.executor.execute(
                            'send.set',
                            { trackId: track.id, busId: bus.id, amount: 0 },
                            'user',
                          )
                        }}
                        onMouseDown={(e) => {
                          if (e.button === 1) {
                            e.preventDefault()
                            if (amount === 0) return
                            void tienda.executor.execute(
                              'send.set',
                              { trackId: track.id, busId: bus.id, amount: 0 },
                              'user',
                            )
                          }
                        }}
                        onAuxClick={(e) => {
                          // el reset ya lo hizo mousedown: solo evita el autoscroll
                          if (e.button === 1) e.preventDefault()
                        }}
                        onChange={(e) => {
                          const v = Number(e.target.value) / 100
                          void tienda.executor.execute(
                            'send.set',
                            { trackId: track.id, busId: bus.id, amount: v },
                            'user',
                            undefined,
                            opcionesGesto(`mixer.send:${track.id}:${bus.id}`, gestoEnvio()),
                          )
                        }}
                      />
                    </label>
                  )
                })}
              </ResaltoIA>
            ) : null}
            </>
            )}

            {/* Paneo (perilla centrada o barra fina según el alto) */}
            <ResaltoIA trackId={track.id} campos={CAMPOS_IA.paneo} className="shrink-0">
              <PanControl modo={modoPaneo} value={track.pan} color={track.color} onChange={(pan, gestureId) => handleChangePan(track.id, pan, gestureId)} />
            </ResaltoIA>

            {/* Bloque de volumen de alto fijo: fader 160 px, VU L/R, dB y pico */}
            <ResaltoIA trackId={track.id} campos={CAMPOS_IA.volumen} className="mt-1">
              <ChannelFaderBlock
                db={track.db}
                color={track.color}
                stereo={stereo[track.id] ?? SILENCIO}
                onChange={(db, gestureId) => handleChangeDb(track.id, db, gestureId)}
                testId={`mixer-fader-${track.id}`}
                estrecho={estrecho}
              />
            </ResaltoIA>

            {/* Medidor de color */}
            <div
              className="mt-1 h-1 w-full shrink-0 rounded-full transition-opacity"
              style={{
                backgroundColor: track.color,
                opacity: track.muted ? 0.25 : 1,
              }}
            />
          </div>
        ))}
        <div
          key={masterTrack.id}
          data-testid="mixer-strip-master"
          style={{ width: ancho }}
          className="flex h-full min-h-0 shrink-0 flex-col border-r border-border px-2 py-2"
        >
          <div className="mb-1.5 flex items-center justify-center gap-0.5">
            <p className="min-w-0 truncate text-center text-[11px] font-medium text-foreground" title={masterTrack.name}>
              {masterTrack.name}
            </p>
            {!estrecho && verExtras ? (
              <SpectrumToggle
                abierto={espectros.has('master')}
                nombre="Master"
                onToggle={() => alternarEspectro('master')}
              />
            ) : null}
          </div>

          <div className="mb-1 flex shrink-0 items-center justify-center gap-1">
            <ResaltoIA trackId="master" campos={CAMPOS_IA.mute}>
              <TrackButton label={`Silenciar Master`} active={Boolean(master?.muted)} onClick={() => {
                void tienda.executor.execute('master.update', { datos: { muted: !master?.muted } })
              }}>
                M
              </TrackButton>
            </ResaltoIA>
          </div>

          {!verExtras ? (
            <div className="min-h-0 flex-1" />
          ) : (
            <>
              {espectros.has('master') && !estrecho ? (
                <div className="mb-1 shrink-0">
                  <MiniSpectrum trackId="master" color={masterTrack.color} />
                </div>
              ) : null}
              <div className="jw-scrollbar -mx-1 mb-1 min-h-0 flex-1 overflow-y-auto px-1" data-testid="mixer-inserts-master">
                <ResaltoIA trackId="master" campos={CAMPOS_IA.fx}>
                  <ChannelFxBank
                    trackId="master"
                    trackName="Master"
                    plugins={master?.plugins ?? []}
                  />
                </ResaltoIA>
              </div>
            </>
          )}

          <ResaltoIA trackId="master" campos={CAMPOS_IA.paneo} className="shrink-0">
            <PanControl modo={modoPaneo} value={masterTrack.pan} color={masterTrack.color} onChange={(pan, gestureId) => {
              void tienda.executor.execute('master.update', { datos: { paneo: pan / 100 } }, 'user', undefined, opcionesGesto('mixer.paneo:master', gestureId))
            }} />
          </ResaltoIA>

          <ResaltoIA trackId="master" campos={CAMPOS_IA.volumen} className="mt-1">
            <ChannelFaderBlock
              db={masterTrack.db}
              color={masterTrack.color}
              stereo={stereo.master ?? SILENCIO}
              testId="mixer-fader-master"
              estrecho={estrecho}
              onChange={(db, gestureId) => {
                const volumen = db > DB_INFERIOR ? dbALineal(db) : 0
                void tienda.executor.execute('master.update', { datos: { volumen } }, 'user', undefined, opcionesGesto('mixer.volumen:master', gestureId))
              }}
            />
          </ResaltoIA>

          <div
            className="mt-1 h-1 w-full rounded-full transition-opacity"
            style={{
              backgroundColor: masterTrack.color,
              opacity: master?.muted ? 0.25 : 1,
            }}
          />
        </div>

        {/* Espacio en blanco: doble clic → nueva pista */}
        <div
          className="min-w-[96px] flex-1 cursor-pointer self-stretch"
          title="Doble clic: nueva pista"
          onDoubleClick={() => {
            const count = tracks.length + 1
            void tienda.executor.execute('track.create', {
              nombre: `MIDI ${count}`,
              tipo: 'midi',
            })
          }}
        />
      </div>
      </div>
    </section>
  )
}
