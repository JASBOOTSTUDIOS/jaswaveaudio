import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { TransportClock } from '@/lib/transport-clock'
import { audioEngine, type AudioClipPlaybackInfo, type MidiClipPlaybackInfo, type TrackAudioConfig } from '@/lib/audio-engine'
import { presetParaPista } from '@/lib/web-synth/web-synth'
import type { AudioClip } from '../../shared/src/types/clips'
import { beatsASegundos, segundosABeats } from '@/lib/audio-conversions'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { safeProjectBpm } from '../../shared/src'
import { EventosTransporte } from '../../shared/src/constants/nombres-eventos'
import { detectarFinProyecto } from '../../shared/src/render/fin-proyecto'
import { puntoInicioDe } from '../../shared/src/commands/domain-commands'
import { decidirFinReproduccion, umbralSilencioLineal } from '@/src/lib/fin-reproduccion'
import { getPreferenciasTransporte } from '@/src/lib/preferencias-transporte'
import { valorCcAMidi } from '@/src/lib/midi-cc-recorder'
import { useImportProgress } from '@/src/context/import-progress-context'
import { extractStereoPeaks, packStereoPeaks } from '@/lib/stereo-peaks'
import { nativeAudioBridge } from '@/src/lib/native-audio-bridge'
import {
  audioInputOf,
  audioMonitorTargetIds,
  audioRecordTargetIds,
  groupArmedAudioByDevice,
  isAudioRecordTrack,
  toAudioRouteTrack,
} from '@/src/lib/audio-track-io'
import { isMidiLikeTrack } from '@/src/lib/midi-track-io'
import { encodeWavFromAudioBuffer } from '@/src/lib/encode-wav'
import {
  loadRecordingBytes,
  makeRecordingFileName,
  saveRecordingWav,
  saveRecordingWavFallback,
} from '@/src/lib/audio-recording-persist'
import { cargarBytesMedia, copiarAudioAlProyecto, esRutaMediaRelativa, validarImportacionAudio, guardarWaveformPeak, cargarWaveformPeak } from '@/src/lib/project-media'
import {
  cerrarFinalizacionGrabacion,
  iniciarFinalizacionGrabacion,
} from '@/src/lib/recording-session'
import { scheduleCompPlayback } from '@/src/lib/comp-playback'
import {
  ensureProjectVstInstruments,
  getLoadedInstrumentForTrack,
  getLoadedInstrumentsForTrack,
  getVstRuntimeGeneration,
  registerProjectGraphResync,
  startVstRuntimeWindowSync,
  subscribeVstRuntime,
} from '@/src/lib/plugin/track-vst-runtime'
import { setPreferredVstPreviewTrack } from '@/src/lib/plugin/vst-voice-router'
import { syncNativeChannelMix } from '@/src/lib/plugin/track-channel-mix'
import { pistasAudibles } from '@/src/lib/plugin/track-hierarchy'
import { applyAutomationAtTime, applyParamAutomationAtTime } from '@/src/lib/automation-runtime'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'
import { isUndockWindow } from '@/lib/undock-window'
import {
  startEditorPreviewFocusBridge,
  subscribeEditorPreviewTrack,
} from '@/src/lib/plugin/editor-preview-focus'
import { publishPlayheadTick, startPlayheadSyncReceiver, startPlayheadSyncResponder, requestPlayheadSync, extrapolatePlayheadMs, mergeSatellitePlayheadTick, type PlayheadAnchor } from '@/src/lib/playhead-window-sync'
import { snapSeekBeat } from '@/src/lib/timeline-snap'
import {
  getProjectReadyGeneration,
  markProjectBuffersNotNeeded,
  reportProjectBuffersSettled,
  waitUntilProjectReady,
} from '@/src/lib/project-ready'

const MIN_TOTAL_BARS = 160
const PPQ = 480

function trackAudioConfigFromShared(
  t: {
    id: string
    volumen?: number
    paneo?: number
    silenciada?: boolean
    soloActiva?: boolean
    nombre?: string
    tags?: string[]
    plugins?: { id?: string; bypass?: boolean; licencia?: string; nombre?: string; descripcion?: string }[]
  },
  stemIndex = 0,
  audibles?: ReadonlySet<string>,
): TrackAudioConfig {
  // Solo slot host-confirmado: si inventamos el id esperado, el host loguea «slot no cargado» y hay silencio.
  const loaded = getLoadedInstrumentForTrack(t.id)
  const vstSlot = loaded?.slotId
  const capas = getLoadedInstrumentsForTrack(t.id)
    .map((p) => p.slotId)
    .filter((s) => s !== vstSlot)

  return {
    id: t.id,
    volumen: typeof t.volumen === 'number' ? t.volumen : 0.8,
    paneo: typeof t.paneo === 'number' ? t.paneo : 0,
    // Con jerarquía resuelta, mute/solo heredados de carpetas ya vienen aplanados en `silenciada`.
    silenciada: audibles ? !audibles.has(t.id) : Boolean(t.silenciada),
    soloActiva: audibles ? false : Boolean(t.soloActiva),
    stemIndex,
    vstInstrumentSlotId: vstSlot,
    vstLayerSlotIds: capas.length > 0 ? capas : undefined,
    // W2: preset del WebSynth para escuchar la pista en la web.
    instrumentoWeb: presetParaPista([t.nombre, ...(t.tags ?? []), ...(t.plugins ?? []).map((p) => p.nombre)]),
  }
}

/** Config de audio de todas las pistas con mute/solo heredados de las carpetas-bus. */
function tracksAudioConfigFromShared(
  tracks: Array<Parameters<typeof trackAudioConfigFromShared>[0] & { tipo?: string; padreId?: string }>,
): TrackAudioConfig[] {
  const audibles = pistasAudibles(tracks)
  return tracks.map((t, i) => trackAudioConfigFromShared(t, i, audibles))
}

function esAudioClip(clip: unknown): clip is AudioClip {
  return (
    typeof clip === 'object' &&
    clip !== null &&
    'tipo' in clip &&
    (clip as { tipo?: string }).tipo === 'audio'
  )
}

function esMidiClip(clip: unknown): clip is { tipo: 'midi'; id: string; nombre?: string; inicio?: number; duracion?: number; notas?: unknown[] } {
  return (
    typeof clip === 'object' &&
    clip !== null &&
    'tipo' in clip &&
    (clip as { tipo?: string }).tipo === 'midi'
  )
}

export interface LoadedClip {
  id: string
  trackId: string
  name: string
  inicioBeats: number
  duracionBeats: number
  inicioSeconds: number
  duracionSeconds: number
  sourceId: string
  waveform?: number[]
  kind?: 'audio' | 'midi'
  noteCount?: number
  missing?: boolean
  loadError?: string
  notes?: Array<{
    pitch: number
    inicio: number
    duracion: number
    velocidad?: number
    mute?: boolean
  }>
}

type PlaybackState = {
  playing: boolean
  recording: boolean
  looping: boolean
  positionMs: number
  progress: number
  clips: LoadedClip[]
  play: () => void
  pause: () => void
  togglePlay: () => void
  stop: () => void
  toggleRecording: () => void
  toggleLooping: () => void
  seekToProgress: (p: number) => void
  seekToBeats: (beats: number) => void
  addClipFromFile: (trackId: string, file: File, startBeats?: number) => Promise<void>
  /** Lectura sin re-render (playhead HF). */
  getPositionMs: () => number
}

/** Acciones + clips (cambia poco). */
/**
 * Proyección de notas para la miniatura del clip, cacheada por la identidad del array
 * `clip.notas` del store (inmutable: sólo cambia si ese clip cambia). Antes se recreaban
 * ~90 clips x ~1000 notas en cada mutación de cualquier pista, y cada MidiClipPreview
 * redibujaba su canvas entero.
 */
const previewNotasCache = new WeakMap<object, Array<{ pitch: number; inicio: number; duracion: number; velocidad?: number; mute?: boolean }>>()
function previewNotasCacheadas(
  notas: ReadonlyArray<{ pitch: number; inicio: number; duracion: number; velocidad?: number; mute?: boolean }>,
) {
  const hit = previewNotasCache.get(notas)
  if (hit) return hit
  const out = notas.map((n) => ({
    pitch: n.pitch,
    inicio: n.inicio,
    duracion: n.duracion,
    velocidad: n.velocidad,
    mute: n.mute,
  }))
  previewNotasCache.set(notas, out)
  return out
}

const PlaybackActionsContext = createContext<Omit<PlaybackState, 'positionMs' | 'progress'> | null>(null)
/** Reloj UI (~20fps). */
const PlaybackClockContext = createContext<{ positionMs: number; progress: number } | null>(null)

function msToProgress(ms: number, loopMs: number): number {
  return Math.max(0, Math.min(1, ms / loopMs))
}

function progressToMs(progress: number, loopMs: number): number {
  return Math.max(0, Math.min(loopMs, progress * loopMs))
}

function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds * bpm) / 60
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const satellite = isUndockWindow()
  const tienda = useDAW()
  const importProgress = useImportProgress()
  const transportStatePlaying = useDAWState((s) => Boolean(s.transport?.reproduciendo))
  const transportGrabacion = useDAWState((s) => s.transport?.grabacion)
  const transportModoGrabacion = useDAWState((s) => s.transport?.modoGrabacion ?? 'normal')
  const transportLoopActivo = useDAWState((s) => Boolean(s.transport?.loop?.activo))
  const transportMetronomo = useDAWState((s) => Boolean(s.transport?.metronomo?.activo))
  const transportPosSegundos = useDAWState((s) => s.transport?.posicion?.segundos ?? 0)
  const sharedTracks = useDAWState((s) => s.project?.tracks || [])
  const projectRouting = useDAWState((s) => s.project?.routing ?? null)
  const projectRuta = useDAWState((s) => s.project?.ruta)
  const selectedTrackId = useDAWState((s) => getSelectedTrackId(s))
  const vstRuntimeGen = useSyncExternalStore(subscribeVstRuntime, getVstRuntimeGeneration, () => 0)

  useEffect(() => {
    const track = sharedTracks.find((t) => t.id === selectedTrackId)
    setPreferredVstPreviewTrack(selectedTrackId, track?.plugins)
  }, [selectedTrackId, sharedTracks])

  useEffect(() => {
    return startVstRuntimeWindowSync(satellite ? 'satellite' : 'primary')
  }, [satellite])

  // Stop (botón, atajo, IA o CLI: todos pasan por transport.stop) corta en seco todo el sonido de los plugins,
  // reverbs y delays incluidos. La pausa no: ahí las colas de FX caen solas.
  useEffect(() => {
    if (satellite) return
    const alDetener = () => {
      void audioEngine.hardStop()
    }
    tienda.busEventos.on(EventosTransporte.detenido, alDetener)
    return () => tienda.busEventos.off(EventosTransporte.detenido, alDetener as (p: unknown) => void)
  }, [tienda, satellite])

  // Si un clip no llega al motor nativo, se avisa (una vez por clip) en lugar de dejarlo mudo sin explicación.
  useEffect(() => {
    const avisados = new Set<string>()
    audioEngine.onClipLoadFailed = (clipId) => {
      if (avisados.has(clipId)) return
      avisados.add(clipId)
      tienda.busEventos.emit('comando.fallido', {
        type: 'audio.playback',
        error: 'No se pudo cargar un clip de audio en el motor nativo; ese clip no sonará. Revisa el log del motor.',
      })
    }
    return () => {
      audioEngine.onClipLoadFailed = undefined
    }
  }, [tienda])

  useEffect(() => {
    if (satellite) return
    const stopFocus = startEditorPreviewFocusBridge()
    const unsub = subscribeEditorPreviewTrack(() => {
      syncNativeChannelMix(
        tienda.obtenerEstado().project?.tracks ?? sharedTracks,
        tienda.obtenerEstado().project?.master,
        tienda.obtenerEstado().project?.routing ?? null,
      )
    })
    return () => {
      stopFocus()
      unsub()
    }
  }, [satellite, tienda, sharedTracks])

  useEffect(() => {
    if (satellite) return
    return subscribeVstRuntime(() => {
      for (const t of sharedTracks) {
        const cfg = trackAudioConfigFromShared(t, sharedTracks.indexOf(t))
        audioEngine.patchTrackVstInstrument(t.id, cfg.vstInstrumentSlotId, cfg.vstLayerSlotIds ?? [])
      }
    })
  }, [sharedTracks])
  const projectBpm = useDAWState((s) => safeProjectBpm(s))
  const masterState = useDAWState((s) => s.project?.master)
  const timeSignatureNum = useDAWState((s) => s.project?.timeSignature?.numerador ?? 4)
  const timeSignatureDen = useDAWState((s) => s.project?.timeSignature?.denominador ?? 4)

  const BPM = projectBpm
  const MS_PER_BEAT = 60000 / BPM
  const BEATS_PER_BAR = Math.max(1, timeSignatureNum)

  const TOTAL_BEATS = useMemo(() => {
    let maxBeat = MIN_TOTAL_BARS * BEATS_PER_BAR
    for (const trk of sharedTracks) {
      if (Array.isArray(trk.clips)) {
        for (const clip of trk.clips) {
          const endBeat = (clip.inicio ?? 0) + (clip.duracion ?? 16)
          if (endBeat > maxBeat) maxBeat = endBeat
        }
      }
    }
    return Math.ceil(maxBeat / BEATS_PER_BAR + 16) * BEATS_PER_BAR
  }, [sharedTracks, BEATS_PER_BAR])
  const TOTAL_BARS = TOTAL_BEATS / BEATS_PER_BAR
  const LOOP_MS = TOTAL_BARS * BEATS_PER_BAR * MS_PER_BEAT

  const loopMsRef = useRef(LOOP_MS)
  loopMsRef.current = LOOP_MS
  const msPerBeatRef = useRef(MS_PER_BEAT)
  msPerBeatRef.current = MS_PER_BEAT

  // Sync master volume/pan/mute from shared state to audio engine
  useEffect(() => {
    if (satellite || !masterState) return
    audioEngine.setMasterVolume(typeof masterState.volumen === 'number' ? masterState.volumen : 1.0)
    audioEngine.setMasterPan(typeof masterState.paneo === 'number' ? masterState.paneo : 0)
    audioEngine.setMasterMuted(Boolean(masterState.muted))
  }, [satellite, masterState?.volumen, masterState?.paneo, masterState?.muted])

  const [positionMs, setPositionMs] = useState(0)
  const positionMsRef = useRef(0)
  /** `stop` del provider (lo usa el vigilante de fin de canción, definido más abajo). */
  const stopRef = useRef<() => void>(() => undefined)
  /** Ancla para extrapolación en ventanas undock (Date.now comparable). */
  const satelliteAnchorRef = useRef<PlayheadAnchor | null>(null)

  const playing = transportStatePlaying
  const playingRef = useRef(playing)
  playingRef.current = playing
  const recording = transportGrabacion === 'grabando'
  const looping = transportLoopActivo
  const metronomeOn = transportMetronomo

  // Sync positionMs from shared state when transport position changes externally (e.g. Home key, seek command)
  useEffect(() => {
    if (!playing) {
      const sharedMs = transportPosSegundos * 1000
      setPositionMs((prev) => {
        if (Math.abs(prev - sharedMs) > 1) return sharedMs
        return prev
      })
      positionMsRef.current = sharedMs
      // Crítico: alinear motor (si no, al play se republica la posición anterior al undock).
      if (!satellite) {
        try {
          audioEngine.seekTimeline(sharedMs / 1000)
        } catch {
          /* ignore */
        }
        try {
          const beats = (sharedMs / 1000) * (BPM / 60)
          clock.seek({
            beats,
            segundos: sharedMs / 1000,
            samples: Math.round((sharedMs / 1000) * audioEngine.getSampleRate()),
            ticks: beats * PPQ,
            compases: 0,
            frames: 0,
            tiempoMusical: '',
            porcentaje: 0,
          })
        } catch {
          /* ignore */
        }
        publishPlayheadTick(sharedMs, false)
      } else {
        satelliteAnchorRef.current = { ms: sharedMs, wall: Date.now(), playing: false }
      }
    }
  }, [transportPosSegundos, playing, satellite])

  const [failedSourcesState, setFailedSourcesState] = useState<Record<string, string>>({})
  // Map clips from shared store tracks (+ backfill peaks desde buffer en memoria)
  const peaksCacheRef = useRef<Map<string, number[]>>(new Map())
  // Sube al llegar un .peak del disco para que las formas de onda se repinten sin esperar a otro cambio de estado
  const [peaksVersion, setPeaksVersion] = useState(0)
  const clips: LoadedClip[] = useMemo(() => {
    const list: LoadedClip[] = []
    for (const trk of sharedTracks) {
      if (Array.isArray(trk.clips)) {
        for (const clip of trk.clips) {
          if (esMidiClip(clip)) {
            const inicio = clip.inicio ?? 0
            const duracion = clip.duracion ?? 16
            list.push({
              id: clip.id,
              trackId: trk.id,
              name: clip.nombre || 'Clip MIDI',
              inicioBeats: inicio,
              duracionBeats: duracion,
              inicioSeconds: beatsASegundos(inicio, BPM),
              duracionSeconds: beatsASegundos(duracion, BPM),
              sourceId: '',
              kind: 'midi',
              noteCount: Array.isArray(clip.notas) ? clip.notas.length : 0,
              notes: Array.isArray(clip.notas) ? previewNotasCacheadas(clip.notas) : [],
            })
            continue
          }
          if (!esAudioClip(clip)) continue

          const sourceId =
            clip.source?.ruta && clip.source.ruta !== ''
              ? clip.source.ruta
              : trk.id === 'drums'
                ? 'demo-drums'
                : trk.id === 'bass'
                  ? 'demo-bass'
                  : trk.id === 'piano'
                    ? 'demo-chords'
                    : trk.id === 'guitar'
                      ? 'demo-lead'
                      : clip.id

          let waveform = Array.isArray(clip.waveform) ? clip.waveform : undefined
          if (!waveform || waveform.length < 4) {
              const cacheKey = `${sourceId}:v2`
              const cached = peaksCacheRef.current.get(cacheKey)
              if (cached) {
                waveform = cached
              } else {
                void cargarWaveformPeak(sourceId, projectRuta).then((peakData) => {
                  // No pisa una forma de onda recién calculada desde el buffer (carrera con el disco)
                  if (peakData && peakData.length >= 4 && !peaksCacheRef.current.has(cacheKey)) {
                    peaksCacheRef.current.set(cacheKey, peakData)
                    setPeaksVersion((v) => v + 1)
                  }
                })
                const buf = audioEngine.getAudioBuffer(sourceId)
                if (buf) {
                  const buckets = Math.min(4096, Math.max(512, Math.floor(buf.duration * 80)))
                  waveform = packStereoPeaks(extractStereoPeaks(buf, buckets))
                  peaksCacheRef.current.set(cacheKey, waveform)
                  void guardarWaveformPeak(sourceId, waveform, projectRuta)
                }
              }
          }

          const isMissing = failedSourcesState[sourceId] || failedSourcesState[clip.id]
          list.push({
            id: clip.id,
            trackId: trk.id,
            name: clip.nombre || 'Clip de Audio',
            inicioBeats: clip.inicio ?? 0,
            duracionBeats: clip.duracion ?? 16,
            inicioSeconds: beatsASegundos(clip.inicio ?? 0, BPM),
            duracionSeconds: beatsASegundos(clip.duracion ?? 16, BPM),
            sourceId,
            waveform,
            kind: 'audio',
            missing: Boolean(isMissing),
            loadError: isMissing || undefined,
          })
        }
      }
    }
    return list
    // peaksVersion no se lee dentro: solo fuerza el recálculo cuando llega un .peak del disco
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedTracks, BPM, failedSourcesState, projectRuta, peaksVersion])

  // Mute / solo / volumen / paneo / cadena FX en caliente durante play
  const trackMixSig = useMemo(
    () =>
      sharedTracks
        .map((t) => {
          const plugs = (t.plugins ?? [])
            .map((p) => `${p.id}:${p.bypass ? 1 : 0}`)
            .join(',')
          const autos = (t.automatizaciones ?? [])
            .map((a) => `${a.parametro}:${a.puntos?.length ?? 0}`)
            .join(',')
          return `${t.id}:${t.padreId ?? ''}:${Boolean(t.silenciada)}:${Boolean(t.soloActiva)}:${typeof t.volumen === 'number' ? t.volumen : 0.8}:${typeof t.paneo === 'number' ? t.paneo : 0}:${plugs}:${autos}`
        })
        .join('|'),
    [sharedTracks],
  )

  const masterMixSig = useMemo(() => {
    if (!masterState) return ''
    const plugs = (masterState.plugins ?? [])
      .map((p) => `${p.id}:${p.bypass ? 1 : 0}`)
      .join(',')
    return `${masterState.volumen ?? 1}:${masterState.muted ? 1 : 0}:${plugs}`
  }, [masterState])

  const sharedTracksRef = useRef(sharedTracks)
  const masterStateRef = useRef(masterState)
  const routingRef = useRef(projectRouting)
  sharedTracksRef.current = sharedTracks
  masterStateRef.current = masterState
  routingRef.current = projectRouting

  useEffect(() => {
    if (satellite) return
    // Leer store fresco: tras musicBuild/ensure el load llama resync antes del render React;
    // sharedTracksRef suele ir un tick atrás → graph sin slots → MIDI con slot en mapa pero silencio.
    registerProjectGraphResync(() => {
      const st = tienda.obtenerEstado()
      syncNativeChannelMix(
        st.project?.tracks ?? sharedTracksRef.current,
        st.project?.master ?? masterStateRef.current,
        st.project?.routing ?? routingRef.current,
      )
    })
    return () => registerProjectGraphResync(null)
  }, [satellite, tienda])

  useEffect(() => {
    if (satellite) return
    const tracksConfig: TrackAudioConfig[] = tracksAudioConfigFromShared(sharedTracks)
    audioEngine.applyTracksConfig(tracksConfig)
    syncNativeChannelMix(sharedTracks, masterState, projectRouting)
  }, [satellite, trackMixSig, masterMixSig, sharedTracks, vstRuntimeGen, masterState, projectRouting])

  // Automatización vol/pan en play: muestreo ~20 Hz del playhead
  useEffect(() => {
    if (satellite || !playing) return
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < 50) return
      last = now
      const tSec = positionMsRef.current / 1000
      const snapped = applyAutomationAtTime(sharedTracks, tSec)
      syncNativeChannelMix(snapped, masterState, projectRouting)
      applyParamAutomationAtTime(sharedTracks, tSec)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [satellite, playing, sharedTracks, masterState, trackMixSig, projectRouting])

  const clockRef = useRef<TransportClock | null>(null)

  if (!clockRef.current) {
    clockRef.current = new TransportClock({
      bpm: BPM,
      timeSignatureNumerator: BEATS_PER_BAR,
      startPosition: {
        beats: 0,
        segundos: 0,
        samples: 0,
        ticks: 0,
        compases: 0,
        frames: 0,
        tiempoMusical: '1.1.1.0',
        porcentaje: 0,
      },
    })
  }

  const clock = clockRef.current

  // Mantener BPM y compás del reloj alineados con el proyecto
  useEffect(() => {
    clock.setBpm(BPM)
    clock.setTimeSignature(BEATS_PER_BAR)
    clock.setSampleRate(audioEngine.getSampleRate())
    if (!satellite) clock.setTimelineSource(() => audioEngine.getTimelineSeconds())
  }, [BPM, BEATS_PER_BAR, clock, satellite])

  const lastStoreSyncRef = useRef(0)

  // Inicializar buffers sintéticos de demostración en audioEngine
  useEffect(() => {
    if (satellite) return
    try {
      const drumsBuf = audioEngine.generateDemoBuffer('drums', (256 * 60) / BPM)
      audioEngine.setAudioBuffer('demo-drums', drumsBuf)

      const bassBuf = audioEngine.generateDemoBuffer('bass', (256 * 60) / BPM)
      audioEngine.setAudioBuffer('demo-bass', bassBuf)

      const chordsBuf = audioEngine.generateDemoBuffer('chords', (256 * 60) / BPM)
      audioEngine.setAudioBuffer('demo-chords', chordsBuf)

      const leadBuf = audioEngine.generateDemoBuffer('lead', (256 * 60) / BPM)
      audioEngine.setAudioBuffer('demo-lead', leadBuf)
    } catch (e) {
      console.warn('AudioEngine synth initialization deferred until user interaction', e)
    }
  }, [])

  useEffect(() => {
    let lastUiMs = 0
    const unsubscribe = clock.subscribe((position) => {
      const ms = position.segundos * 1000
      const loopMs = loopMsRef.current
      const clamped = progressToMs(msToProgress(ms, loopMs), loopMs)
      const ahora = performance.now()
      // En play, el intervalo de audio es la fuente de verdad para satélites.
      // Aquí solo actualizamos UI local / ref cuando no estamos publicando audio.
      if (!playingRef.current) {
        positionMsRef.current = clamped
      }
      if (ahora - lastUiMs >= 250) {
        lastUiMs = ahora
        setPositionMs(clamped)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [clock, tienda, satellite])

  // Primary: responder sync con reloj monotónico.
  useEffect(() => {
    if (satellite) return
    return startPlayheadSyncResponder(() => {
      if (playingRef.current) {
        try {
          const ms = audioEngine.getMonotonicTimelineSeconds() * 1000
          if (Number.isFinite(ms) && ms >= 0) return ms
        } catch {
          /* fall through */
        }
      }
      return positionMsRef.current
    }, () => playingRef.current)
  }, [satellite])

  // Primary: actualizar ref local a menudo; publicar a undock poco (satélite free-runea).
  useEffect(() => {
    if (satellite || !playing) return
    const tickLocal = () => {
      if (!playingRef.current) return
      try {
        const ms = audioEngine.getMonotonicTimelineSeconds() * 1000
        if (!Number.isFinite(ms) || ms < 0) return
        positionMsRef.current = ms
      } catch {
        /* ignore */
      }
    }
    tickLocal()
    const localId = window.setInterval(tickLocal, 32)
    const pubId = window.setInterval(() => {
      if (!playingRef.current) return
      publishPlayheadTick(positionMsRef.current, true)
    }, 500)
    publishPlayheadTick(positionMsRef.current, true)
    return () => {
      window.clearInterval(localId)
      window.clearInterval(pubId)
    }
  }, [satellite, playing])

  // Ventana undock: free-run (ancla fija) + solo seek/pause re-anclan.
  useEffect(() => {
    if (!satellite) return
    requestPlayheadSync()
    return startPlayheadSyncReceiver((tick) => {
      const prev = satelliteAnchorRef.current
      const merged = mergeSatellitePlayheadTick(prev, tick)
      if (
        prev &&
        prev.playing === merged.playing &&
        prev.ms === merged.ms &&
        prev.wall === merged.wall
      ) {
        return
      }
      satelliteAnchorRef.current = merged
      positionMsRef.current = merged.playing ? extrapolatePlayheadMs(merged) : merged.ms
      if (!merged.playing || !prev?.playing) {
        setPositionMs(merged.ms)
      }
    })
  }, [satellite])

  // Store pause/play en satélite.
  useEffect(() => {
    if (!satellite) return
    if (!playing) {
      // No pisar un seek reciente (W→0): preferir ancla/store ya en 0.
      const a = satelliteAnchorRef.current
      const ms = a && !a.playing ? a.ms : a ? extrapolatePlayheadMs(a) : positionMsRef.current
      satelliteAnchorRef.current = { ms, wall: Date.now(), playing: false }
      positionMsRef.current = ms
      setPositionMs(ms)
      return
    }
    // Al pasar a play: invalidar ancla para que el próximo tick (posición actual) fije el free-run.
    satelliteAnchorRef.current = {
      ms: satelliteAnchorRef.current?.ms ?? positionMsRef.current,
      wall: Date.now(),
      playing: false,
    }
    requestPlayheadSync()
  }, [playing, satellite])

  const triggerAudioPlayback = useCallback(async (startMs: number, currentClips: LoadedClip[]) => {
    // Estado fresco (CLI/musicBuild puede ir por delante del cierre React).
    const freshTracks = tienda.obtenerEstado().project?.tracks ?? sharedTracks

    // Datos de edición del clip (mute, ganancia, fades, slip) desde el store: los clips cargados solo
    // conocen posición y audio.
    type ClipEdicion = {
      id: string
      silenciado?: boolean
      ganancia?: number
      clipInicio?: number
      fadeIn?: { duracion?: number; curva?: string } | null
      fadeOut?: { duracion?: number; curva?: string } | null
      inverso?: boolean
    }
    const edicionPorId = new Map<string, ClipEdicion>()
    for (const trk of freshTracks) for (const c of (trk.clips ?? []) as ClipEdicion[]) edicionPorId.set(c.id, c)
    const playbackClips: AudioClipPlaybackInfo[] = currentClips
      .filter((c) => (c.kind ?? 'audio') !== 'midi')
      .map((c) => {
        const e = edicionPorId.get(c.id)
        return {
          id: c.id,
          trackId: c.trackId,
          inicio: c.inicioSeconds,
          duracion: c.duracionSeconds,
          sourcePathOrId: c.sourceId,
          // clipInicio se guarda en beats.
          clipInicio: e?.clipInicio ? beatsASegundos(e.clipInicio, BPM) : 0,
          silenciado: e?.silenciado === true,
          gananciaDb: e?.ganancia,
          fadeInSec: e?.fadeIn?.duracion,
          fadeOutSec: e?.fadeOut?.duracion,
          fadeInCurva: e?.fadeIn?.curva,
          fadeOutCurva: e?.fadeOut?.curva,
          inverso: e?.inverso === true,
        }
      })

    // MIDI siempre desde el store: tras daw.musicBuild el play del bridge
    // suele llegar antes de que React regenere `clips` → schedule vacío + silencio
    // con audit.notes>0 y vstSlot presente.
    const midiClips: MidiClipPlaybackInfo[] = []
    for (const trk of freshTracks) {
      if (!Array.isArray(trk.clips)) continue
      for (const rawClip of trk.clips) {
        if (!esMidiClip(rawClip)) continue
        if ((rawClip as { silenciado?: boolean }).silenciado) continue
        const inicioBeats = rawClip.inicio ?? 0
        const inicioSeconds = beatsASegundos(inicioBeats, BPM)
        const raw = rawClip as {
          id: string
          notas?: Array<{ pitch: number; velocidad?: number; inicio: number; duracion: number; mute?: boolean }>
          expression?: { cc?: Array<{ cc: number; puntos?: Array<{ tiempo: number; valor: number }> }> }
        }
        const loaded = currentClips.find((c) => c.id === raw.id && c.kind === 'midi')
        const fromClip = loaded && Array.isArray(loaded.notes) && loaded.notes.length > 0 ? loaded.notes : null
        const fromStore = Array.isArray(raw.notas) ? raw.notas : []
        const notas = fromClip
          ? fromClip.map((n) => ({
              pitch: n.pitch,
              velocidad: n.velocidad,
              inicio: n.inicio,
              duracion: n.duracion,
              mute: n.mute,
            }))
          : fromStore
        const ccs: Array<{ cc: number; timeSec: number; value: number }> = []
        for (const lane of raw.expression?.cc ?? []) {
          for (const pt of lane.puntos ?? []) {
            // Contrato: valor normalizado 0..1 (ver midi-cc-recorder.ts); un valor 1 es el máximo, no «CC = 1».
            ccs.push({
              cc: lane.cc,
              timeSec: inicioSeconds + beatsASegundos(pt.tiempo, BPM),
              value: valorCcAMidi(pt.valor),
            })
          }
        }
        if (notas.length === 0 && ccs.length === 0) continue
        midiClips.push({
          id: raw.id,
          trackId: trk.id,
          notes: notas
            .filter((n) => !n.mute && Number.isFinite(n.pitch))
            .map((n) => ({
              pitch: n.pitch,
              velocity: typeof n.velocidad === 'number' ? n.velocidad : 100,
              startSec: inicioSeconds + beatsASegundos(n.inicio, BPM),
              durationSec: Math.max(0.03, beatsASegundos(n.duracion, BPM)),
            })),
          ccs,
        })
      }
    }

    const trackAudioConfig = (): TrackAudioConfig[] => tracksAudioConfigFromShared(freshTracks)

    if (midiClips.length === 0) {
      const storeMidi = freshTracks.reduce((n, t) => {
        for (const c of t.clips ?? []) {
          if (esMidiClip(c) && Array.isArray((c as { notas?: unknown[] }).notas)) {
            n += ((c as { notas: unknown[] }).notas).length
          }
        }
        return n
      }, 0)
      if (storeMidi > 0 || currentClips.some((c) => c.kind === 'midi')) {
        console.warn('[playback] clips MIDI sin notas resolubles', {
          storeMidi,
          loaded: currentClips.filter((c) => c.kind === 'midi').map((c) => ({ id: c.id, n: c.noteCount })),
        })
      }
    }
    let armed = await audioEngine.armNativeMixOutput()
    if (!armed) {
      await new Promise((r) => setTimeout(r, 250))
      armed = await audioEngine.armNativeMixOutput()
    }
    if (!armed) {
      const motivo = audioEngine.getTimingDiagnostics().lastArmError
      console.warn('[playback] native mix not armed', motivo)
      if (motivo && motivo !== 'no-plugin-host-api' && motivo !== 'undock-window') {
        tienda.busEventos.emit('comando.fallido', {
          type: 'audio.engine',
          error: `El motor de audio nativo no está disponible (${String(motivo)}). No habrá sonido hasta que arranque.`,
        })
      }
    }
    // Carga de VSTs asíncrona no bloqueante: dispara en segundo plano y publica el grafo
    const loadP = ensureProjectVstInstruments(
      freshTracks.map((t) => ({ id: t.id, plugins: t.plugins })),
      masterState?.plugins,
    )
    loadP.then(() => {
      syncNativeChannelMix(freshTracks, masterState, projectRouting)
    }).catch((err) => {
      console.warn('[playback] background VST ensure error:', err)
    })
    // Publicar graph inmediatamente con tracks frescos para arrancar el audio en 0 ms
    syncNativeChannelMix(freshTracks, masterState, projectRouting)
    let cfg0 = trackAudioConfig()
    let slotN = cfg0.filter((t) => t.vstInstrumentSlotId).length
    const noteN = midiClips.reduce((n, c) => n + c.notes.length, 0)
    if (noteN > 0 && slotN === 0) {
      console.warn('[playback] MIDI con notas pero sin slots VST — esperando load…', {
        noteN,
        tracks: freshTracks.length,
      })
      await Promise.race([loadP, new Promise<void>((r) => setTimeout(r, 8000))])
      syncNativeChannelMix(
        tienda.obtenerEstado().project?.tracks ?? freshTracks,
        tienda.obtenerEstado().project?.master ?? masterState,
        tienda.obtenerEstado().project?.routing ?? projectRouting,
      )
      cfg0 = trackAudioConfig()
      slotN = cfg0.filter((t) => t.vstInstrumentSlotId).length
    }
    if (noteN > 0 && slotN === 0) {
      console.warn('[playback] MIDI con notas pero sin slots VST', { noteN, tracks: freshTracks.length })
    }
    // Espera a que estén en el host los clips de los primeros segundos (máx. 4 s): el reloj de la UI
    // arranca después (clock.play tras triggerAudioPlayback), así el playhead no corre con el audio mudo.
    await audioEngine.playClips(startMs / 1000, playbackClips, cfg0, midiClips, BPM)
    const stComp = tienda.obtenerEstado()
    if ((stComp.project.takeFolders ?? []).some((f) => f.segments.length > 0 || f.takeActivoId)) {
      const stemByTrackId = new Map(freshTracks.map((t, i) => [t.id, i]))
      void scheduleCompPlayback(stComp, {
        startSec: startMs / 1000,
        sampleRate: audioEngine.getSampleRate(),
        stemByTrackId,
      })
    }
    void loadP.then(() => {
      const cfg = trackAudioConfig()
      audioEngine.applyTracksConfig(cfg)
      for (const t of cfg) {
        audioEngine.patchTrackVstInstrument(t.id, t.vstInstrumentSlotId)
      }
      syncNativeChannelMix(freshTracks, masterState, projectRouting)
    })
  }, [sharedTracks, BPM, masterState, projectRouting, tienda])

  // Sync clock & audio: Space = pause/resume en el playhead; Stop = cero
  // NO pisar positionMsRef aquí: en satélite (undock) el ref lo actualiza
  // BroadcastChannel ~30 Hz; en primary lo actualiza clock.subscribe. Si
  // reasignamos desde el state React (lento) en cada render, el playhead
  // se congela hasta pausar.

  useEffect(() => {
    if (satellite) return
    if (playing) {
      // Usar posición del store/ref YA alineada (p.ej. tras W → 0), y fijar motor YA.
      const ms = positionMsRef.current
      const seconds = ms / 1000
      try {
        audioEngine.seekTimeline(seconds)
      } catch {
        /* ignore */
      }
      publishPlayheadTick(ms, true)
      const beats = (seconds * BPM) / 60
      clock.seek({
        beats,
        segundos: seconds,
        samples: Math.round(seconds * audioEngine.getSampleRate()),
        ticks: beats * PPQ,
        compases: 0,
        frames: 0,
        tiempoMusical: '',
        porcentaje: 0,
      })
      let cancelled = false
      void (async () => {
        await waitUntilProjectReady({ timeoutMs: 18_000, allowDegraded: true })
        if (cancelled || !playingRef.current) return
        await triggerAudioPlayback(ms, clips)
        if (cancelled || !playingRef.current) return
        if (!clock.isPlaying) clock.play()
        // Metrónomo DESPUÉS de playClips (mismo reloj / epoch). Antes corría en paralelo → desync.
        if (metronomeOn) {
          const beat = audioEngine.getMonotonicTimelineSeconds() / (60 / BPM)
          audioEngine.startMetronome(BPM, BEATS_PER_BAR, beat)
        }
      })()
      return () => {
        cancelled = true
      }
    }

    // Pause (o ya parado por Stop): congelar playhead
    if (clock.isPlaying) {
      clock.pause()
    }
    const pos = clock.getCurrentPosition()
    const ms = Math.max(0, pos.segundos * 1000)
    positionMsRef.current = ms
    setPositionMs(ms)
    try {
      audioEngine.seekTimeline(ms / 1000)
    } catch {
      /* ignore */
    }
    publishPlayheadTick(ms, false)
    lastStoreSyncRef.current = performance.now()
    tienda.establecerEstado((s) => ({
      ...s,
      transport: {
        ...s.transport,
        posicion: pos,
      },
    }))
    audioEngine.stopAllSources()
    audioEngine.stopMetronome()
    void nativeAudioBridge.pause()
  }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reaper: el clip vive en la pista — al cambiar trackId, reprogramar con la cadena de destino.
  const clipPlacementSig = useMemo(
    () => clips.map((c) => `${c.id}>${c.trackId}`).sort().join('|'),
    [clips],
  )

  useEffect(() => {
    if (satellite || !playing) return
    triggerAudioPlayback(positionMsRef.current, clips)
    // Solo reaccionar a placement (clip→pista), no a cada mutación de notas/waveform
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipPlacementSig])

  // Sync metrónomo: BPM/compás en caliente; no reiniciar en cada play (eso lo hace el efecto playing).
  useEffect(() => {
    if (satellite) return
    if (!playing) {
      audioEngine.stopMetronome()
      return
    }
    if (!metronomeOn) {
      audioEngine.stopMetronome()
      return
    }
    const beat = audioEngine.getTimelineSeconds() / (60 / BPM)
    audioEngine.updateMetronomeGrid(BPM, BEATS_PER_BAR, beat)
  }, [metronomeOn, BPM, BEATS_PER_BAR, timeSignatureDen, satellite]) // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback(() => {
    if (!playing) {
      void (async () => {
        await waitUntilProjectReady({ timeoutMs: 18_000, allowDegraded: true })
        const r = await tienda.executor.execute('transport.toggle', {})
        if (!r.success) {
          tienda.busEventos.emit('comando.fallido', { type: 'transport.play', error: r.error?.message })
        }
      })()
    }
  }, [tienda, playing])

  const pause = useCallback(() => {
    if (playing) {
      void tienda.executor.execute('transport.toggle', {}).then((r) => {
        if (!r.success) {
          tienda.busEventos.emit('comando.fallido', { type: 'transport.pause', error: r.error?.message })
        }
      })
    }
  }, [tienda, playing])

  const togglePlay = useCallback(() => {
    void (async () => {
      if (!playingRef.current) {
        await waitUntilProjectReady({ timeoutMs: 18_000, allowDegraded: true })
      }
      const r = await tienda.executor.execute('transport.toggle', {})
      if (!r.success) {
        tienda.busEventos.emit('comando.fallido', { type: 'transport.toggle', error: r.error?.message })
      }
    })()
  }, [tienda])

  const stop = useCallback(() => {
    // Primero congelar el reloj en el punto de inicio (donde el usuario dejó el cursor; 0 por defecto) para que el
    // effect de pausa no reintroduzca la posición. transport.stop deja el estado en ese mismo punto.
    clock.stop()
    const inicioMs = puntoInicioDe(tienda.obtenerEstado().transport) * 1000
    positionMsRef.current = inicioMs
    setPositionMs(inicioMs)
    if (inicioMs > 0) {
      const seg = inicioMs / 1000
      const beats = seg * (BPM / 60)
      try {
        clock.seek({
          beats,
          segundos: seg,
          samples: Math.round(seg * audioEngine.getSampleRate()),
          ticks: beats * PPQ,
          compases: beats / BEATS_PER_BAR,
          frames: Math.round(seg * 30),
          tiempoMusical: '',
          porcentaje: 0,
        })
        audioEngine.seekTimeline(seg)
      } catch {
        /* ignore */
      }
    }
    audioEngine.stopAllSources()
    audioEngine.stopMetronome()
    void nativeAudioBridge.pause()
    void tienda.executor.execute('transport.stop', {}).then((r) => {
      if (!r.success) {
        tienda.busEventos.emit('comando.fallido', { type: 'transport.stop', error: r.error?.message })
      }
    })
  }, [tienda, clock, BPM, BEATS_PER_BAR])

  stopRef.current = stop

  const toggleRecording = useCallback(() => {
    void tienda.executor.execute('transport.toggleRecord', {})
  }, [tienda])

  const recStartBeatsRef = useRef(0)
  const wasRecordingRef = useRef(false)
  const recPlanRef = useRef<{ deviceKey: string; trackIds: string[] }[]>([])

  const audioIoSig = useMemo(
    () =>
      sharedTracks
        .map(
          (t) =>
            `${t.id}:${t.tipo}:${audioInputOf(t)}:${t.armada ? 1 : 0}:${t.configuracion?.monitorizarEntrada ? 1 : 0}`,
        )
        .join('|'),
    [sharedTracks],
  )

  useEffect(() => {
    if (satellite) return
    const routes = sharedTracks.map((t) => toAudioRouteTrack(t))
    const monitorIds = new Set(audioMonitorTargetIds(routes))
    for (const t of routes) {
      if (!isAudioRecordTrack(t.tipo)) continue
      void audioEngine.setInputMonitor(t.id, audioInputOf(t) || undefined, monitorIds.has(t.id))
    }
  }, [satellite, audioIoSig, sharedTracks])

  const hydratedSourcesRef = useRef(new Set<string>())
  useEffect(() => {
    if (satellite) return
    const gen = getProjectReadyGeneration()
    const pending: Promise<void>[] = []
    let needed = 0
    for (const trk of sharedTracks) {
      if (!Array.isArray(trk.clips)) continue
      for (const clip of trk.clips) {
        if (!esAudioClip(clip)) continue
        // Preferir la ruta definitiva en disco si existe
        const sourceId = clip.source?.ruta || ((clip as unknown as { sourceId?: string }).sourceId) || clip.id
        if (!sourceId) continue
        if (audioEngine.getAudioBuffer(sourceId) || audioEngine.getAudioBuffer(clip.id)) continue
        // Grabaciones (.wav) y media relativa del proyecto (`media/...`) o rutas absolutas
        const esMediaRelativa = esRutaMediaRelativa(sourceId)
        needed += 1
        if (hydratedSourcesRef.current.has(sourceId)) continue
        hydratedSourcesRef.current.add(sourceId)
        pending.push(
          (esMediaRelativa
            ? cargarBytesMedia(sourceId, projectRuta)
            : loadRecordingBytes(sourceId, projectRuta)
          ).then(async (bytes) => {
            if (!bytes) {
              setFailedSourcesState((prev) => ({
                ...prev,
                [sourceId]: 'El archivo de audio no se encuentra en el proyecto',
                [clip.id]: 'El archivo de audio no se encuentra en el proyecto',
              }))
              return
            }
            try {
              const buf = await audioEngine.decodeArrayBuffer(sourceId, bytes)
              if (buf) {
                if (clip.id) audioEngine.setAudioBuffer(clip.id, buf)
                if (clip.source?.ruta) audioEngine.setAudioBuffer(clip.source.ruta, buf)
                const cName = clip.nombre
                if (cName) audioEngine.setAudioBuffer(cName, buf)
              }
            } catch (err) {
              console.warn('[playback-provider] Error al decodificar audio buffer para clip:', sourceId, err)
              setFailedSourcesState((prev) => ({
                ...prev,
                [sourceId]: 'Archivo dañado o formato no decodificable',
                [clip.id]: 'Archivo dañado o formato no decodificable',
              }))
            }
          }),
        )
      }
    }
    if (needed === 0) {
      markProjectBuffersNotNeeded(gen)
      return
    }
    if (pending.length === 0) {
      reportProjectBuffersSettled(true, 'Buffers ya en memoria', gen)
      return
    }
    void Promise.allSettled(pending).then(() => {
      reportProjectBuffersSettled(true, 'Buffers de clips listos', gen)
    })
  }, [satellite, sharedTracks, projectRuta])

  const punchActive = useDAWState((s) => Boolean(s.transport?.punch?.activo))
  const punchStartBeats = useDAWState((s) => s.transport?.punch?.inicio?.beats ?? 0)
  const punchEndBeats = useDAWState((s) => s.transport?.punch?.fin?.beats ?? 0)
  const punchActiveRef = useRef(punchActive)
  const punchEndBeatsRef = useRef(punchEndBeats)
  punchActiveRef.current = punchActive
  punchEndBeatsRef.current = punchEndBeats
  const recGenRef = useRef(0)

  // Punch out: cortar grabación al salir de la ventana
  useEffect(() => {
    if (satellite || !recording || !punchActive) return
    const posBeats = positionMs / Math.max(1e-6, msPerBeatRef.current)
    if (posBeats >= punchEndBeats && punchEndBeats > punchStartBeats) {
      void tienda.executor.execute('transport.toggleRecord', {})
    }
  }, [satellite, recording, punchActive, punchEndBeats, punchStartBeats, positionMs, tienda])

  useEffect(() => {
    if (satellite) return
    const recOn = recording
    if (recOn && !wasRecordingRef.current) {
      const routes = sharedTracks.map((t) => toAudioRouteTrack(t))
      const armedAudioIds = audioRecordTargetIds(routes)
      const armedMidi = sharedTracks.filter((t) => t.armada && isMidiLikeTrack(t.tipo))
      if (armedAudioIds.length === 0 && armedMidi.length === 0) {
        tienda.busEventos.emit('comando.fallido', {
          type: 'transport.toggleRecord',
          error: 'Arma una pista de audio o MIDI',
        })
        void tienda.executor.execute('transport.toggleRecord', {})
        return
      }
      wasRecordingRef.current = true
      iniciarFinalizacionGrabacion()
      const gen = ++recGenRef.current
      const transport = tienda.obtenerEstado().transport
      const useCountIn = Boolean(transport.countIn?.activo)
      const bars = Math.max(1, transport.countIn?.compases ?? 1)
      const usePunch = Boolean(transport.punch?.activo)
      const pStart = transport.punch?.inicio?.beats ?? 0
      const pEnd = transport.punch?.fin?.beats ?? 0

      tienda.busEventos.emit('grabacion.iniciada', {})
      if (!playingRef.current) {
        void tienda.executor.execute('transport.toggle', {}).then((r) => {
          if (!r.success) {
            tienda.busEventos.emit('comando.fallido', {
              type: 'transport.toggle',
              error: r.error?.message,
            })
          }
        })
      }
      // Count-in: metrónomo + esperar N compases antes de capturar
      if (useCountIn && !transport.metronomo?.activo) {
        void tienda.executor.execute('transport.toggleMetronome', {})
      }

      if (armedAudioIds.length === 0) {
        recPlanRef.current = []
        // MIDI-only: count-in ajusta el inicio de captura en el host MIDI vía tiempo
        const delayMs = useCountIn ? bars * BEATS_PER_BAR * (60000 / BPM) : 0
        if (delayMs > 0) {
          window.setTimeout(() => {
            if (recGenRef.current !== gen || !wasRecordingRef.current) return
            recStartBeatsRef.current = usePunch && pEnd > pStart
              ? pStart
              : Math.max(0, positionMsRef.current / msPerBeatRef.current)
          }, delayMs)
        } else {
          recStartBeatsRef.current =
            usePunch && pEnd > pStart
              ? pStart
              : Math.max(0, positionMsRef.current / msPerBeatRef.current)
        }
        return
      }
      const groups = groupArmedAudioByDevice(routes)
      recPlanRef.current = [...groups.entries()].map(([deviceKey, trackIds]) => ({ deviceKey, trackIds }))
      void (async () => {
        const delayMs = useCountIn ? bars * BEATS_PER_BAR * (60000 / BPM) : 0
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs))
        }
        if (recGenRef.current !== gen || !wasRecordingRef.current) return
        recStartBeatsRef.current =
          usePunch && pEnd > pStart
            ? pStart
            : Math.max(0, positionMsRef.current / msPerBeatRef.current)
        let anyOk = false
        let someFailed = false
        for (const { deviceKey, trackIds } of recPlanRef.current) {
          const monitorId = trackIds.find((id) => {
            const t = routes.find((r) => r.id === id)
            return Boolean(t?.configuracion?.monitorizarEntrada)
          })
          const ok = await audioEngine.startInputCapture({
            deviceId: deviceKey || undefined,
            monitorTrackId: monitorId ?? null,
          })
          if (ok) anyOk = true
          else someFailed = true
        }
        if (!anyOk) {
          const nativeOut = audioEngine.usesNativeOutput?.() ?? false
          tienda.busEventos.emit('comando.fallido', {
            type: 'transport.toggleRecord',
            error: nativeOut
              ? 'Entrada de audio Chromium deshabilitada mientras ASIO/host nativo posee el dispositivo. Usa WASAPI Shared para monitor/grabación soft, o monitoriza por hardware del interface.'
              : 'No se pudo acceder al micrófono o al dispositivo de entrada',
          })
          if (armedMidi.length === 0) {
            wasRecordingRef.current = false
            recPlanRef.current = []
            void tienda.executor.execute('transport.toggleRecord', {})
          }
        } else if (someFailed) {
          tienda.busEventos.emit('comando.fallido', {
            type: 'transport.toggleRecord',
            error: 'Algunos dispositivos de entrada no se pudieron abrir',
          })
        }
      })()
      return
    }
    if (!recOn && wasRecordingRef.current) {
      wasRecordingRef.current = false
      recGenRef.current += 1
      const startBeats = recStartBeatsRef.current
      const plan = recPlanRef.current
      recPlanRef.current = []
      tienda.busEventos.emit('grabacion.detenida', {})
      if (plan.length === 0) {
        cerrarFinalizacionGrabacion()
        return
      }
      const punchOn = punchActiveRef.current
      const punchEnd = punchEndBeatsRef.current
      // La escritura del WAV es asíncrona: quien abra o cierre el proyecto espera
      // a que la toma esté en disco (U6).
      void (async () => {
        for (const { deviceKey, trackIds } of plan) {
          const memKey = `rec-${Date.now()}-${deviceKey || 'default'}`
          const result = await audioEngine.stopInputCapture(memKey, deviceKey || undefined)
          if (!result) continue
          let buffer = result.buffer
          let durationSec = result.duration
          const clipStart = startBeats
          // Punch: recortar al fin de ventana si la toma se pasó
          if (punchOn && punchEnd > clipStart) {
            const maxBeats = punchEnd - clipStart
            const maxSec = (maxBeats * 60) / BPM
            if (durationSec > maxSec && maxSec > 0.05) {
              const sr = buffer.sampleRate
              const frames = Math.min(buffer.length, Math.floor(maxSec * sr))
              const trimmed = new AudioBuffer({
                length: frames,
                numberOfChannels: buffer.numberOfChannels,
                sampleRate: sr,
              })
              for (let c = 0; c < buffer.numberOfChannels; c++) {
                trimmed.copyToChannel(buffer.getChannelData(c).subarray(0, frames), c)
              }
              buffer = trimmed
              durationSec = frames / sr
            }
          }
          const durationBeats = segundosABeats(durationSec, BPM)
          if (durationBeats < 0.05) continue
          const buckets = Math.min(4096, Math.max(256, Math.floor(durationSec * 80)))
          const waveform = packStereoPeaks(extractStereoPeaks(buffer, buckets))
          const wav = encodeWavFromAudioBuffer(buffer)
          const fileName = makeRecordingFileName(trackIds[0] ?? 'pista')
          const saved = await saveRecordingWav(wav, fileName, projectRuta)
          // Si no se pudo guardar en el proyecto: aviso visible + reintento en userData.
          // Nunca se pierde la toma en silencio.
          let sourceId = saved?.sourceId
          if (!sourceId) {
            const fallback = await saveRecordingWavFallback(wav, fileName)
            if (!fallback) {
              tienda.busEventos.emit('comando.fallido', {
                type: 'audio.record',
                error:
                  'No se pudo guardar la grabación en disco: revisa los permisos de la carpeta del proyecto o el espacio en disco.',
              })
              continue
            }
            sourceId = fallback.sourceId
            tienda.busEventos.emit('comando.fallido', {
              type: 'audio.record',
              error: `La grabación se guardó fuera del proyecto (${fallback.absPath}).`,
            })
          }
          if (sourceId !== memKey) {
            audioEngine.setAudioBuffer(sourceId, buffer)
          }
          if (sourceId) {
            void guardarWaveformPeak(sourceId, waveform, projectRuta)
          }
          for (const trackId of trackIds) {
            // La pista pudo borrarse mientras se grababa: la toma no se pierde,
            // se guarda en una pista "Toma recuperada" (U6).
            let destino = trackId
            if (!tienda.obtenerEstado().project.tracks.some((t) => t.id === trackId)) {
              const creada = await tienda.executor.execute('track.create', {
                nombre: 'Toma recuperada',
                tipo: 'audio',
              })
              const nuevaId = (creada.result as { trackId?: string })?.trackId
              if (!creada.success || !nuevaId) {
                tienda.busEventos.emit('comando.fallido', {
                  type: 'audio.record',
                  error: `La pista de grabación ya no existe y no se pudo crear "Toma recuperada": la toma está en ${sourceId}.`,
                })
                continue
              }
              destino = nuevaId
              tienda.busEventos.emit('comando.fallido', {
                type: 'audio.record',
                error: `La pista de grabación ya no existía: la toma se guardó en "Toma recuperada".`,
              })
            }
            const modo = tienda.obtenerEstado().transport?.modoGrabacion ?? 'normal'
            if (modo === 'comping') {
              await tienda.executor.execute('take.folder.ensure', { pistaId: destino })
              const added = await tienda.executor.execute('take.add', {
                pistaId: destino,
                archivo: sourceId,
                nombre: `Take ${Date.now().toString(36).slice(-4)}`,
                inicioGrabacion: clipStart,
                finGrabacion: clipStart + durationBeats,
                sampleRate: buffer.sampleRate,
                bitDepth: 24,
                canales: buffer.numberOfChannels,
              })
              const takeId = (added.result as { takeId?: string })?.takeId
              if (takeId) {
                await tienda.executor.execute('comp.segment.set', {
                  pistaId: destino,
                  takeId,
                  timelineInicio: clipStart,
                  timelineFin: clipStart + durationBeats,
                  origenInicio: 0,
                  origenFin: durationSec,
                })
              }
              const creado = await tienda.executor.execute('clip.create', {
                pistaId: destino,
                nombre: `Take`,
                inicio: clipStart,
                duracion: durationBeats,
                sourceId,
                waveform,
              })
              if (!creado.success) {
                tienda.busEventos.emit('comando.fallido', {
                  type: 'audio.record',
                  error: `No se pudo crear el clip de la toma: ${creado.error?.message ?? 'error desconocido'}`,
                })
              }
            } else {
              const creado = await tienda.executor.execute('clip.create', {
                pistaId: destino,
                nombre: 'Grabación',
                inicio: clipStart,
                duracion: durationBeats,
                sourceId,
                waveform,
              })
              if (!creado.success) {
                tienda.busEventos.emit('comando.fallido', {
                  type: 'audio.record',
                  error: `No se pudo crear el clip de la grabación: ${creado.error?.message ?? 'error desconocido'}`,
                })
              }
            }
          }
        }
      })().finally(() => {
        cerrarFinalizacionGrabacion()
      })
    }
  }, [recording, satellite, sharedTracks, tienda, BPM, projectRuta, BEATS_PER_BAR, transportModoGrabacion])

  const toggleLooping = useCallback(() => {
    void tienda.executor.execute('transport.toggleLoop', {})
  }, [tienda])

  const seekToProgress = useCallback(
    (p: number) => {
      const msPerBeat = msPerBeatRef.current
      const targetBeats = Math.max(0, Math.min(TOTAL_BEATS, p * TOTAL_BEATS))
      const targetMs = targetBeats * msPerBeat
      const targetTicks = targetBeats * PPQ
      const targetSeconds = targetMs / 1000

      clock.seek({
        beats: targetBeats,
        segundos: targetSeconds,
        samples: Math.round(targetSeconds * audioEngine.getSampleRate()),
        ticks: targetTicks,
        compases: targetBeats / BEATS_PER_BAR,
        frames: Math.round(targetSeconds * 30),
        tiempoMusical: '',
        porcentaje: p,
      })
      setPositionMs(targetMs)
      positionMsRef.current = targetMs
      try {
        audioEngine.seekTimeline(targetSeconds)
      } catch {
        /* ignore */
      }
      if (!satellite) publishPlayheadTick(targetMs, playingRef.current)
      // Arrastre en la barra de progreso = gesto del usuario: también fija el punto de inicio de Stop.
      void tienda.executor.execute('transport.seek', { segundos: targetSeconds, marcarInicio: true })

      if (playing) {
        void triggerAudioPlayback(targetMs, clips).then(() => {
          if (metronomeOn) {
            audioEngine.updateMetronomeGrid(BPM, BEATS_PER_BAR, targetBeats)
          }
        })
      }
    },
    [clock, playing, clips, triggerAudioPlayback, tienda, TOTAL_BEATS, BEATS_PER_BAR, metronomeOn, BPM, satellite],
  )

  /**
   * Salto a un beat exacto (sin ajustar a la rejilla): lo usa el loop y seekToBeats tras el snap.
   * `marcarInicio`: el salto es un gesto del usuario y fija el punto al que vuelve Stop (el loop no lo marca).
   */
  const seekToBeatsExact = useCallback(
    (targetBeats: number, marcarInicio = false) => {
      const msPerBeat = msPerBeatRef.current
      const targetMs = targetBeats * msPerBeat
      const targetTicks = targetBeats * PPQ
      const targetSeconds = targetMs / 1000

      clock.seek({
        beats: targetBeats,
        segundos: targetSeconds,
        samples: Math.round(targetSeconds * audioEngine.getSampleRate()),
        ticks: targetTicks,
        compases: targetBeats / BEATS_PER_BAR,
        frames: Math.round(targetSeconds * 30),
        tiempoMusical: '',
        porcentaje: targetBeats / TOTAL_BEATS,
      })
      setPositionMs(targetMs)
      positionMsRef.current = targetMs
      try {
        audioEngine.seekTimeline(targetSeconds)
      } catch {
        /* ignore */
      }
      if (!satellite) publishPlayheadTick(targetMs, playingRef.current)
      void tienda.executor.execute('transport.seek', { segundos: targetSeconds, ...(marcarInicio ? { marcarInicio: true } : {}) })

      if (playing) {
        void triggerAudioPlayback(targetMs, clips).then(() => {
          if (metronomeOn) {
            audioEngine.updateMetronomeGrid(BPM, BEATS_PER_BAR, targetBeats)
          }
        })
      }
    },
    [clock, playing, clips, triggerAudioPlayback, tienda, TOTAL_BEATS, BEATS_PER_BAR, metronomeOn, BPM, satellite],
  )

  /** Clic del usuario en la regla (Arrange / Piano Roll): mueve el playhead y fija el punto de inicio. */
  const seekToBeats = useCallback(
    (beats: number) => {
      const st = tienda.obtenerEstado()
      seekToBeatsExact(
        snapSeekBeat(Math.max(0, beats), {
          playheadSnap: st.ui?.playheadSnap !== false,
          snapEnabled: st.project?.timeline?.snap ?? true,
          snapValor: st.project?.timeline?.snapValor ?? 1,
          beatsPerBar: st.project?.timeSignature?.numerador ?? BEATS_PER_BAR,
        }),
        true,
      )
    },
    [tienda, seekToBeatsExact, BEATS_PER_BAR],
  )

  // Fin de la canción: con loop, vuelve al inicio de la región (o de la canción); sin loop y con
  // «detener al final» (por defecto), se detiene y vuelve al inicio cuando se apaga la cola de reverb.
  const seekExactRef = useRef(seekToBeatsExact)
  seekExactRef.current = seekToBeatsExact
  useEffect(() => {
    if (satellite || !playing) return
    let silencioSec = 0
    let ultimo = performance.now()
    let ocupado = false
    const id = window.setInterval(() => {
      const ahora = performance.now()
      const dt = (ahora - ultimo) / 1000
      ultimo = ahora
      if (ocupado) return
      const st = tienda.obtenerEstado()
      if (st.transport?.grabacion === 'grabando') return // grabando: la canción crece, no se corta
      const nivel = audioEngine.getMasterMeterLevel()
      const pico = nivel > 0 ? Math.pow(nivel, 1 / 0.6) : 0
      silencioSec = pico < umbralSilencioLineal() ? silencioSec + dt : 0
      const fin = detectarFinProyecto(st.project)
      const loop = st.transport?.loop
      const d = decidirFinReproduccion({
        ahoraSec: audioEngine.getMonotonicTimelineSeconds(),
        finContenidoSec: fin.vacio ? null : fin.finSegundos,
        loop: { activo: Boolean(loop?.activo), inicioSec: loop?.inicio?.segundos, finSec: loop?.fin?.segundos },
        detenerAlFinal: getPreferenciasTransporte().detenerAlFinal,
        picoMaster: pico,
        silencioSec,
      })
      if (d.tipo === 'saltar') {
        ocupado = true
        silencioSec = 0
        const bpm = safeProjectBpm(st)
        seekExactRef.current((d.segundos * bpm) / 60)
        window.setTimeout(() => {
          ocupado = false
        }, 300)
      } else if (d.tipo === 'detener') {
        ocupado = true
        stopRef.current()
      }
    }, 50)
    return () => window.clearInterval(id)
  }, [playing, satellite, tienda])

  const addClipFromFile = useCallback(
    async (trackId: string, file: File, startBeats = 0) => {
      try {
        importProgress.start(file.name)
        importProgress.setProgress(0.1, 'reading')

        // Validación previa: extensión y tamaño (la duración se comprueba al decodificar).
        const previa = validarImportacionAudio({ ruta: file.name, tamanoBytes: file.size })
        if (previa.nivel === 'error') throw new Error(previa.mensaje ?? 'Archivo no importable')

        const bufferKey = `file-${trackId}-${Date.now()}`
        importProgress.setProgress(0.35, 'decoding')
        let buffer: AudioBuffer
        let duration: number
        try {
          const decodificado = await audioEngine.decodeAudioFile(bufferKey, file)
          buffer = decodificado.buffer
          duration = decodificado.duration
        } catch (err) {
          throw new Error(
            `No se pudo decodificar "${file.name}". El archivo puede estar dañado o usar un formato no compatible.`,
            { cause: err },
          )
        }
        const durationBeats = secondsToBeats(duration, BPM)

        const duracion = validarImportacionAudio({ ruta: file.name, duracionSec: duration })
        if (duracion.nivel === 'error') throw new Error(duracion.mensaje ?? 'Archivo no importable')
        if (duracion.nivel === 'aviso') {
          tienda.busEventos.emit('comando.fallido', {
            type: 'audio.import',
            error: duracion.mensaje ?? 'El archivo es largo',
          })
        }

        importProgress.setProgress(0.7, 'peaks')
        const buckets = Math.min(4096, Math.max(512, Math.floor(duration * 80)))
        const peaks = extractStereoPeaks(buffer, buckets)
        const waveform = packStereoPeaks(peaks)

        // Copia al media del proyecto: el clip guarda la ruta RELATIVA para que
        // el proyecto siga funcionando en otra carpeta o en otro equipo.
        importProgress.setProgress(0.85, 'copying')
        const copia = await copiarAudioAlProyecto(file, projectRuta)
        if (copia.error && !copia.rutaRelativa) {
          // Antes se ignoraba: el clip quedaba solo en memoria y se perdía al reabrir el proyecto.
          tienda.busEventos.emit('comando.fallido', {
            type: 'audio.import',
            error: `${file.name}: no se pudo copiar al proyecto (${copia.error}). El audio solo estará disponible en esta sesión.`,
          })
        }

        importProgress.setProgress(0.9, 'creating')
        let targetTrackId = trackId
        const estadoPistas = tienda.obtenerEstado().project.tracks
        const pistaActual = estadoPistas.find((t) => t.id === targetTrackId)
        if (!pistaActual || pistaActual.tipo !== 'audio') {
          const resTrack = await tienda.executor.execute('track.create', {
            nombre: file.name.replace(/\.[^.]+$/, ''),
            tipo: 'audio',
          })
          if (resTrack.success && (resTrack.result as { trackId?: string })?.trackId) {
            targetTrackId = (resTrack.result as { trackId: string }).trackId
          }
        }

        const res = await tienda.executor.execute('clip.create', {
          pistaId: targetTrackId,
          nombre: file.name.replace(/\.[^.]+$/, ''),
          inicio: startBeats,
          duracion: durationBeats,
          sourceId: copia.rutaRelativa ?? bufferKey,
          waveform,
        })
        if (!res.success) throw new Error(res.error?.message ?? 'No se pudo crear el clip')

        const createdClipId = (res.result as { clipId?: string })?.clipId
        audioEngine.setAudioBuffer(bufferKey, buffer)
        if (copia.rutaRelativa) audioEngine.setAudioBuffer(copia.rutaRelativa, buffer)
        if (createdClipId) audioEngine.setAudioBuffer(createdClipId, buffer)
        audioEngine.setAudioBuffer(file.name, buffer)

        importProgress.finish()

        if (playing) {
          // Re-schedule clips on the native host from current playhead.
          void triggerAudioPlayback(positionMsRef.current, clips)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        importProgress.fail(msg)
        throw err
      }
    },
    // positionMs NO va en deps: cambiaba 4x/s, recreaba actionsValue y re-renderizaba
    // ArrangementView + PianoRoll completos durante el play. Se lee de positionMsRef.
    [tienda, playing, BPM, importProgress, triggerAudioPlayback, clips, projectRuta],
  )

  const getPositionMs = useCallback(() => {
    if (satellite) {
      return extrapolatePlayheadMs(satelliteAnchorRef.current)
    }
    if (playingRef.current) {
      try {
        const ms = audioEngine.getMonotonicTimelineSeconds() * 1000
        if (Number.isFinite(ms) && ms >= 0) return ms
      } catch {
        /* fall through */
      }
    }
    return positionMsRef.current
  }, [satellite])

  const actionsValue = useMemo(
    () => ({
      playing,
      recording,
      looping,
      clips,
      play,
      pause,
      togglePlay,
      stop,
      toggleRecording,
      toggleLooping,
      seekToProgress,
      seekToBeats,
      addClipFromFile,
      getPositionMs,
    }),
    [
      playing,
      recording,
      looping,
      clips,
      play,
      pause,
      togglePlay,
      stop,
      toggleRecording,
      toggleLooping,
      seekToProgress,
      seekToBeats,
      addClipFromFile,
      getPositionMs,
    ],
  )

  const clockValue = useMemo(
    () => ({
      positionMs,
      progress: msToProgress(positionMs, loopMsRef.current),
    }),
    [positionMs],
  )

  return (
    <PlaybackActionsContext.Provider value={actionsValue}>
      <PlaybackClockContext.Provider value={clockValue}>{children}</PlaybackClockContext.Provider>
    </PlaybackActionsContext.Provider>
  )
}

export function usePlaybackActions() {
  const ctx = useContext(PlaybackActionsContext)
  if (!ctx) throw new Error('usePlaybackActions debe usarse dentro de PlaybackProvider')
  return ctx
}

export function usePlaybackClock() {
  const ctx = useContext(PlaybackClockContext)
  if (!ctx) throw new Error('usePlaybackClock debe usarse dentro de PlaybackProvider')
  return ctx
}

export function usePlayback(): PlaybackState {
  const actions = usePlaybackActions()
  const clock = usePlaybackClock()
  return { ...actions, ...clock }
}

export { msATiempoFormateado as formatTimecode } from '@/lib/audio-conversions'

export function msToBarBeat(ms: number, bpm = 120, beatsPerBar = 4) {
  const msPerBeat = 60000 / bpm
  const totalBeats = ms / msPerBeat
  const bar = Math.floor(totalBeats / beatsPerBar) + 1
  const beat = Math.floor(totalBeats % beatsPerBar) + 1
  return { bar, beat }
}
