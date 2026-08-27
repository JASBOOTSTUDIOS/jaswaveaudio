import { useMemo, useCallback, useEffect, useRef, useState } from 'react'
import { Minus, SlidersHorizontal, Wand2, Shuffle, Headphones } from 'lucide-react'
import { useDAW, useDAWState } from '../src/context/daw-context'
import type { Track as SharedTrack, AudioTrack } from '../../shared/src/types/tracks'
import type { DAWState } from '../../shared/src/types/state'
import type { PluginInfo } from '../../shared/src/types/entidades'
import {
  DB_SUPERIOR,
  DB_INFERIOR,
  linealADb,
  dbALineal,
  formatearDb,
  panADisplay,
} from '@/lib/audio-conversions'
import { FaderControl, KnobControl, LevelMeterBarHorizontal } from './ui/controls'
import { ChannelFxBank } from '@/components/channel-fx-bank'
import { TrackMidiInput } from '@/components/track-midi-input'
import { TrackAudioInput } from '@/components/track-audio-input'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'
import { midiInputOf } from '@/src/lib/midi-track-io'
import { audioInputOf } from '@/src/lib/audio-track-io'
import { audioEngine } from '@/lib/audio-engine'
import {
  isNativeMeterHostAvailable,
  refreshNativeMixMeters,
  setMixMeterTrackOrder,
} from '@/src/lib/plugin/native-mix-meters'
import { extractHostPluginPath } from '@/src/lib/plugin/plugin-info-adapter'
import { isBuiltinInstrument } from '@/src/lib/plugin/track-vst-runtime'
import { AutomationLanesPanel, maybeWriteAutomationPoint } from '@/components/automation-lanes-panel'

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

export function Mixer() {
  const tienda = useDAW()
  const tracks = useDAWState((s: DAWState) => s.project?.tracks ?? [])
  const master = useDAWState((s: DAWState) => s.project?.master)
  const routing = useDAWState((s: DAWState) => s.project?.routing)
  const collapsed = useDAWState((s: DAWState) => s.ui?.estadoMezcladorUI?.colapsado ?? false)
  const selectedTrackId = useDAWState((s: DAWState) => getSelectedTrackId(s))
  const stripRefs = useRef(new Map<string, HTMLDivElement | null>())
  const [meters, setMeters] = useState<Record<string, number>>({})
  const trackIdsKey = tracks.map((t) => t.id).join('|')

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
          for (const id of ids) {
            next[id] = audioEngine.getMeterLevel(id)
            next[`in:${id}`] = audioEngine.getInputMeterLevel(id)
          }
          setMeters(next)
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

  useEffect(() => {
    if (!selectedTrackId) return
    stripRefs.current.get(selectedTrackId)?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
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

  const handleChangeDb = (id: string, db: number) => {
    const volumen = db > DB_INFERIOR ? dbALineal(db) : 0
    void tienda.executor.execute('track.update', { trackId: id, datos: { volumen } })
    maybeWriteAutomationPoint(tienda, id, 'volumen', volumen, playing)
  }

  const handleChangePan = (id: string, pan: number) => {
    const paneo = pan / 100
    void tienda.executor.execute('track.update', { trackId: id, datos: { paneo } })
    maybeWriteAutomationPoint(tienda, id, 'paneo', paneo, playing)
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
    for (const track of trackList) {
      const volumen = dbALineal(Math.max(DB_INFERIOR, perTrackDb))
      void tienda.executor.execute('track.update', { trackId: track.id, datos: { volumen } })
    }
    // Center all panning
    for (const track of trackList) {
      void tienda.executor.execute('track.update', { trackId: track.id, datos: { paneo: 0 } })
    }
  }, [trackList, tienda])

  const handleRandomize = useCallback(() => {
    for (const track of trackList) {
      const randomDb = DB_INFERIOR + Math.random() * (DB_SUPERIOR - DB_INFERIOR)
      const volumen = randomDb > DB_INFERIOR ? dbALineal(randomDb) : 0
      const paneo = (Math.random() * 2 - 1) // -1 to 1
      void tienda.executor.execute('track.update', { trackId: track.id, datos: { volumen, paneo } })
    }
  }, [trackList, tienda])

  return (
    <section className="flex h-full min-h-0 flex-col bg-panel">
      {/* Barra de herramientas del mixer */}
      <div className="flex h-9 items-center gap-1 border-b border-border px-3">
        <button
          type="button"
          aria-label="Colapsar mixer"
          onClick={() => tienda.establecerEstado((s) => ({ ...s, ui: { ...s.ui, estadoMezcladorUI: { ...s.ui?.estadoMezcladorUI, canalesVisibles: s.ui?.estadoMezcladorUI?.canalesVisibles ?? [], nivelMaster: s.ui?.estadoMezcladorUI?.nivelMaster ?? 0, seleccionando: s.ui?.estadoMezcladorUI?.seleccionando ?? false, seleccionInicio: s.ui?.estadoMezcladorUI?.seleccionInicio ?? 0, seleccionFin: s.ui?.estadoMezcladorUI?.seleccionFin ?? 0, colapsado: !collapsed } } }))}
          className={`flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-panel-raised hover:text-foreground ${collapsed ? 'bg-panel-raised text-foreground' : ''}`}
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
      <div className="flex min-h-0 flex-1 overflow-auto">
        {trackList.map((track) => (
          <div
            key={track.id}
            ref={(el) => {
              stripRefs.current.set(track.id, el)
            }}
            className={`flex shrink-0 flex-col border-r border-border px-2 py-2 ${collapsed ? 'w-[52px]' : 'w-[124px]'} ${
              selectedTrackId === track.id ? 'bg-accent-amber/10' : ''
            }`}
          >
            {/* Nombre */}
            <p
              className="mb-1.5 truncate text-center text-[11px] font-medium text-foreground"
              title={track.name}
            >
              {track.name}
            </p>
            {(track.tipo === 'midi' || track.tipo === 'instrumento') && (
              <p className="mb-1 text-center text-[8px] font-semibold uppercase tracking-wider text-accent-amber">
                MIDI
              </p>
            )}
            {track.tipo === 'audio' && (
              <p className="mb-1 text-center text-[8px] font-semibold uppercase tracking-wider text-muted-foreground">
                AUDIO+MIDI
              </p>
            )}

            {/* M / S */}
            <div className="mb-1 flex items-center justify-center gap-1">
              <TrackButton
                label={`Silenciar ${track.name}`}
                active={track.muted}
                onClick={() => handleToggleMute(track.id)}
              >
                M
              </TrackButton>
              <TrackButton
                label={`Solo ${track.name}`}
                active={track.solo}
                activeClass="bg-track-vocals text-background"
                onClick={() => handleToggleSolo(track.id)}
              >
                S
              </TrackButton>
            </div>

            {/* IN / rec */}
            <div className="mb-1 flex items-center justify-center gap-1">
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
            {(track.tipo === 'midi' || track.tipo === 'instrumento' || track.tipo === 'audio') && !collapsed ? (
              <div className="mb-1">
                <TrackMidiInput trackId={track.id} assignedId={track.entrada} compact />
              </div>
            ) : null}
            {(track.tipo === 'midi' || track.tipo === 'instrumento') &&
            trackHasHostVst(track.plugins) &&
            !collapsed ? (
              <div
                className="mb-1 h-1 overflow-hidden rounded-full bg-panel-raised"
                title="Nivel VST (post-fader)"
              >
                <LevelMeterBarHorizontal level={meters[track.id] ?? 0} />
              </div>
            ) : null}
            {track.tipo === 'audio' && !collapsed ? (
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
            {!collapsed ? (
              <div className="mb-2">
                <ChannelFxBank
                  trackId={track.id}
                  trackName={track.name}
                  plugins={track.plugins}
                />
              </div>
            ) : null}

            {/* Knob de balance */}
            <KnobControl value={track.pan} color={track.color} onChange={(pan) => handleChangePan(track.id, pan)} size="size-9" />

            {/* Sends post-fader (MVP) */}
            {!collapsed && (routing?.buses?.length ?? 0) > 0 ? (
              <div className="mt-1 space-y-0.5">
                {(routing?.buses ?? []).slice(0, 2).map((bus) => {
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
                        onChange={(e) => {
                          const v = Number(e.target.value) / 100
                          void tienda.executor.execute('send.set', {
                            trackId: track.id,
                            busId: bus.id,
                            amount: v,
                          })
                        }}
                      />
                    </label>
                  )
                })}
              </div>
            ) : null}

            {/* Fader */}
            <div className="mt-2 flex-1">
              <FaderControl db={track.db} color={track.color} meter={meters[track.id] ?? 0} onChange={(db) => handleChangeDb(track.id, db)} showScale />
            </div>

            {/* Valor en dB */}
            <p className="mt-1 text-center font-mono text-[10px] tabular-nums text-muted-foreground">
              {formatearDb(track.db)}
            </p>

            {/* Medidor de color */}
            <div
              className="mt-1 h-1 w-full rounded-full transition-opacity"
              style={{
                backgroundColor: track.color,
                opacity: track.muted ? 0.25 : 1,
              }}
            />
          </div>
        ))}
        <div key={masterTrack.id} className="flex w-[124px] shrink-0 flex-col border-r border-border px-2 py-2">
          <p className="mb-1.5 truncate text-center text-[11px] font-medium text-foreground" title={masterTrack.name}>
            {masterTrack.name}
          </p>
          <div className="mb-1">
            <ChannelFxBank
              trackId="master"
              trackName="Master"
              plugins={master?.plugins ?? []}
            />
          </div>

          <div className="mb-1 flex items-center justify-center gap-1">
            <TrackButton label={`Silenciar Master`} active={master.muted} onClick={() => {
              void tienda.executor.execute('master.update', { datos: { muted: !master.muted } })
            }}>
              M
            </TrackButton>
            <TrackButton label={`Solo Master`} active={master.solo} onClick={() => {
              void tienda.executor.execute('master.update', { datos: { solo: !master.solo } })
            }}>
              S
            </TrackButton>
          </div>

          <KnobControl value={masterTrack.pan} color={masterTrack.color} onChange={(pan) => {
            void tienda.executor.execute('master.update', { datos: { paneo: pan / 100 } })
          }} />

          <div className="mt-2 flex-1">
            <FaderControl db={masterTrack.db} color={masterTrack.color} meter={meters.master ?? 0} onChange={(db) => {
              const volumen = db > DB_INFERIOR ? dbALineal(db) : 0
              void tienda.executor.execute('master.update', { datos: { volumen } })
            }} />
          </div>

          <p className="mt-1 text-center font-mono text-[10px] tabular-nums text-muted-foreground">
            {formatearDb(masterTrack.db)}
          </p>

          <div
            className="mt-1 h-1 w-full rounded-full transition-opacity"
            style={{
              backgroundColor: masterTrack.color,
              opacity: master.muted ? 0.25 : 1,
            }}
          />
        </div>
      </div>
      {!collapsed ? <AutomationLanesPanel /> : null}
    </section>
  )
}
