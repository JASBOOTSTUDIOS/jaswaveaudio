import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import { TransportClock } from '@/lib/transport-clock'
import { audioEngine, type AudioClipPlaybackInfo, type MidiClipPlaybackInfo, type TrackAudioConfig } from '@/lib/audio-engine'
import { TRACKS } from '@/lib/daw-data'
import type { AudioClip } from '../../shared/src/types/clips'
import { msATiempoFormateado, msACompasBeat, beatsASegundos, segundosABeats } from '@/lib/audio-conversions'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { useImportProgress } from '@/src/context/import-progress-context'
import { extractStereoPeaks, packStereoPeaks } from '@/lib/stereo-peaks'

const MIN_TOTAL_BARS = 160
const PPQ = 480

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
}

const PlaybackContext = createContext<PlaybackState | null>(null)

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
  const tienda = useDAW()
  const importProgress = useImportProgress()
  const transportState = useDAWState((s) => s.transport)
  const sharedTracks = useDAWState((s) => s.project?.tracks || [])
  const projectBpm = useDAWState((s) => s.project?.bpm?.valor ?? 120)
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
    if (!masterState) return
    audioEngine.setMasterVolume(typeof masterState.volumen === 'number' ? masterState.volumen : 1.0)
    audioEngine.setMasterPan(typeof masterState.paneo === 'number' ? masterState.paneo : 0)
    audioEngine.setMasterMuted(Boolean(masterState.muted))
  }, [masterState?.volumen, masterState?.paneo, masterState?.muted])

  const [positionMs, setPositionMs] = useState(0)

  const playing = Boolean(transportState?.reproduciendo)
  const recording = transportState?.grabacion === 'grabando'
  const looping = Boolean(transportState?.loop?.activo)
  const metronomeOn = Boolean(transportState?.metronomo?.activo)

  // Sync positionMs from shared state when transport position changes externally (e.g. Home key, seek command)
  useEffect(() => {
    if (!playing) {
      const sharedSeconds = transportState?.posicion?.segundos ?? 0
      const sharedMs = sharedSeconds * 1000
      setPositionMs((prev) => {
        if (Math.abs(prev - sharedMs) > 1) return sharedMs
        return prev
      })
    }
  }, [transportState?.posicion?.segundos, playing])

  // Map clips from shared store tracks (+ backfill peaks desde buffer en memoria)
  const peaksCacheRef = useRef<Map<string, number[]>>(new Map())
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
                const buf = audioEngine.getAudioBuffer(sourceId)
                if (buf) {
                  const buckets = Math.min(4096, Math.max(512, Math.floor(buf.duration * 80)))
                  waveform = packStereoPeaks(extractStereoPeaks(buf, buckets))
                  peaksCacheRef.current.set(cacheKey, waveform)
                }
              }
          }

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
          })
        }
      }
    }
    return list
  }, [sharedTracks, BPM])

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
  }, [BPM, BEATS_PER_BAR, clock])

  const lastStoreSyncRef = useRef(0)

  // Inicializar buffers sintéticos de demostración en audioEngine
  useEffect(() => {
    try {
      const drumsBuf = audioEngine.generateDemoBuffer('drums', (64 * 60) / BPM)
      audioEngine.setAudioBuffer('demo-drums', drumsBuf)

      const bassBuf = audioEngine.generateDemoBuffer('bass', (64 * 60) / BPM)
      audioEngine.setAudioBuffer('demo-bass', bassBuf)

      const chordsBuf = audioEngine.generateDemoBuffer('chords', (64 * 60) / BPM)
      audioEngine.setAudioBuffer('demo-chords', chordsBuf)

      const leadBuf = audioEngine.generateDemoBuffer('lead', (56 * 60) / BPM)
      audioEngine.setAudioBuffer('demo-lead', leadBuf)
    } catch (e) {
      console.warn('AudioEngine synth initialization deferred until user interaction', e)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = clock.subscribe((position) => {
      const ms = position.segundos * 1000
      const loopMs = loopMsRef.current
      const progress = msToProgress(ms, loopMs)
      setPositionMs(progressToMs(progress, loopMs))

      // Throttle sync a DAWState (sin undo) para que atajos/IA vean posición real
      const ahora = performance.now()
      if (ahora - lastStoreSyncRef.current > 200) {
        lastStoreSyncRef.current = ahora
        tienda.establecerEstado((s) => ({
          ...s,
          transport: {
            ...s.transport,
            posicion: position,
          },
        }))
      }
    })

    return () => {
      unsubscribe()
    }
  }, [clock, tienda])

  const triggerAudioPlayback = useCallback((startMs: number, currentClips: LoadedClip[]) => {
    audioEngine.ensureContext()

    const playbackClips: AudioClipPlaybackInfo[] = currentClips
      .filter((c) => (c.kind ?? 'audio') !== 'midi')
      .map((c) => ({
        id: c.id,
        trackId: c.trackId,
        inicio: c.inicioSeconds,
        duracion: c.duracionSeconds,
        sourcePathOrId: c.sourceId,
      }))

    const midiClips: MidiClipPlaybackInfo[] = []
    for (const c of currentClips) {
      if (c.kind !== 'midi') continue
      const trk = sharedTracks.find((t) => t.id === c.trackId)
      const raw = trk?.clips?.find((x: { id: string }) => x.id === c.id) as
        | { notas?: Array<{ pitch: number; velocidad?: number; inicio: number; duracion: number; mute?: boolean }> }
        | undefined
      const notas = Array.isArray(raw?.notas) ? raw.notas : []
      if (notas.length === 0) continue
      midiClips.push({
        id: c.id,
        trackId: c.trackId,
        notes: notas
          .filter((n) => !n.mute && Number.isFinite(n.pitch))
          .map((n) => ({
            pitch: n.pitch,
            velocity: typeof n.velocidad === 'number' ? n.velocidad : 100,
            startSec: c.inicioSeconds + beatsASegundos(n.inicio, BPM),
            durationSec: Math.max(0.03, beatsASegundos(n.duracion, BPM)),
          })),
      })
    }

    const tracksConfig: TrackAudioConfig[] = sharedTracks.map((t) => ({
      id: t.id,
      volumen: typeof t.volumen === 'number' ? t.volumen : 0.8,
      paneo: typeof t.paneo === 'number' ? t.paneo : 0,
      silenciada: Boolean(t.silenciada),
      soloActiva: Boolean(t.soloActiva),
    }))

    audioEngine.playClips(startMs / 1000, playbackClips, tracksConfig, midiClips)
  }, [sharedTracks, BPM])

  // Firma estable: no re-disparar audio por recalculos de waveform/referencias
  const playbackSignature = useMemo(
    () =>
      clips
        .map((c) =>
          c.kind === 'midi'
            ? `m:${c.id}:${c.trackId}:${c.noteCount ?? 0}:${c.inicioBeats}:${c.duracionBeats}`
            : `a:${c.id}:${c.trackId}:${c.sourceId}:${c.inicioBeats}:${c.duracionBeats}`,
        )
        .join('|'),
    [clips],
  )

  // Sync clock & audio: Space = pause/resume en el playhead; Stop = cero
  const positionMsRef = useRef(0)
  positionMsRef.current = positionMs

  useEffect(() => {
    if (playing) {
      const ms = positionMsRef.current
      const seconds = ms / 1000
      const beats = (seconds * BPM) / 60
      clock.seek({
        beats,
        segundos: seconds,
        samples: Math.round(seconds * 44100),
        ticks: beats * PPQ,
        compases: 0,
        frames: 0,
        tiempoMusical: '',
        porcentaje: 0,
      })
      clock.play()
      triggerAudioPlayback(ms, clips)
      return
    }

    // Pause (o ya parado por Stop): congelar playhead
    if (clock.isPlaying) {
      clock.pause()
    }
    const pos = clock.getCurrentPosition()
    const ms = Math.max(0, pos.segundos * 1000)
    setPositionMs(ms)
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
  }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-disparar solo si YA estaba sonando y cambio el contenido (evitar doble start al play)
  const wasPlayingRef = useRef(false)
  useEffect(() => {
    const was = wasPlayingRef.current
    wasPlayingRef.current = playing
    // Solo reprogramar si ya estaba en play y cambio el contenido (no al primer play)
    if (!playing || !was) return
    triggerAudioPlayback(positionMsRef.current, clips)
  }, [playbackSignature, playing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync metronome with playback, BPM, compás y seek
  useEffect(() => {
    if (playing && metronomeOn) {
      const currentBeat = (positionMs / 1000) / (60 / BPM)
      audioEngine.updateMetronomeGrid(BPM, BEATS_PER_BAR, currentBeat)
    } else {
      audioEngine.stopMetronome()
    }
  }, [playing, metronomeOn, BPM, BEATS_PER_BAR, timeSignatureDen])

  const play = useCallback(() => {
    if (!playing) {
      void tienda.executor.execute('transport.toggle', {}).then((r) => {
        if (!r.success) {
          tienda.busEventos.emit('comando.fallido', { type: 'transport.play', error: r.error?.message })
        }
      })
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
    void tienda.executor.execute('transport.toggle', {}).then((r) => {
      if (!r.success) {
        tienda.busEventos.emit('comando.fallido', { type: 'transport.toggle', error: r.error?.message })
      }
    })
  }, [tienda])

  const stop = useCallback(() => {
    // Primero congelar reloj en 0 para que el effect de pause no reintroduzca posición
    clock.stop()
    setPositionMs(0)
    audioEngine.stopAllSources()
    audioEngine.stopMetronome()
    void tienda.executor.execute('transport.stop', {}).then((r) => {
      if (!r.success) {
        tienda.busEventos.emit('comando.fallido', { type: 'transport.stop', error: r.error?.message })
      }
    })
  }, [tienda, clock])

  const toggleRecording = useCallback(() => {
    void tienda.executor.execute('transport.toggleRecord', {})
  }, [tienda])

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
        samples: Math.round(targetSeconds * 44100),
        ticks: targetTicks,
        compases: targetBeats / BEATS_PER_BAR,
        frames: Math.round(targetSeconds * 30),
        tiempoMusical: '',
        porcentaje: p,
      })
      setPositionMs(targetMs)
      void tienda.executor.execute('transport.seek', { segundos: targetSeconds })

      if (playing) {
        triggerAudioPlayback(targetMs, clips)
        if (metronomeOn) {
          audioEngine.updateMetronomeGrid(BPM, BEATS_PER_BAR, targetBeats)
        }
      }
    },
    [clock, playing, clips, triggerAudioPlayback, tienda, TOTAL_BEATS, BEATS_PER_BAR, metronomeOn, BPM],
  )

  const seekToBeats = useCallback(
    (beats: number) => {
      const msPerBeat = msPerBeatRef.current
      const targetBeats = Math.max(0, beats)
      const targetMs = targetBeats * msPerBeat
      const targetTicks = targetBeats * PPQ
      const targetSeconds = targetMs / 1000

      clock.seek({
        beats: targetBeats,
        segundos: targetSeconds,
        samples: Math.round(targetSeconds * 44100),
        ticks: targetTicks,
        compases: targetBeats / BEATS_PER_BAR,
        frames: Math.round(targetSeconds * 30),
        tiempoMusical: '',
        porcentaje: targetBeats / TOTAL_BEATS,
      })
      setPositionMs(targetMs)
      void tienda.executor.execute('transport.seek', { segundos: targetSeconds })

      if (playing) {
        triggerAudioPlayback(targetMs, clips)
        if (metronomeOn) {
          audioEngine.updateMetronomeGrid(BPM, BEATS_PER_BAR, targetBeats)
        }
      }
    },
    [clock, playing, clips, triggerAudioPlayback, tienda, TOTAL_BEATS, BEATS_PER_BAR, metronomeOn, BPM],
  )

  const addClipFromFile = useCallback(
    async (trackId: string, file: File, startBeats = 0) => {
      try {
        importProgress.start(file.name)
        importProgress.setProgress(0.1, 'reading')

        const ctx = audioEngine.ensureContext()
        if (ctx.state === 'suspended') {
          await ctx.resume()
        }

        const bufferKey = `file-${trackId}-${Date.now()}`
        importProgress.setProgress(0.35, 'decoding')
        const { buffer, duration } = await audioEngine.decodeAudioFile(bufferKey, file)
        const durationBeats = secondsToBeats(duration, BPM)

        importProgress.setProgress(0.7, 'peaks')
        const buckets = Math.min(4096, Math.max(512, Math.floor(duration * 80)))
        const peaks = extractStereoPeaks(buffer, buckets)
        const waveform = packStereoPeaks(peaks)

        importProgress.setProgress(0.9, 'creating')
        await tienda.executor.execute('clip.create', {
          pistaId: trackId,
          nombre: file.name.replace(/\.[^.]+$/, ''),
          inicio: startBeats,
          duracion: durationBeats,
          sourceId: bufferKey,
          waveform,
        })

        importProgress.finish()

        if (playing) {
          const currentSec = positionMs / 1000
          const clipStartSec = beatsASegundos(startBeats, BPM)
          if (currentSec < clipStartSec + duration) {
            const trackNode = audioEngine.getTrackNode(trackId)
            const sourceNode = ctx.createBufferSource()
            sourceNode.buffer = buffer
            sourceNode.connect(trackNode.gain)
            const offset = Math.max(0, currentSec - clipStartSec)
            const delay = Math.max(0, clipStartSec - currentSec)
            sourceNode.start(ctx.currentTime + delay, offset, duration - offset)
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        importProgress.fail(msg)
        throw err
      }
    },
    [tienda, playing, positionMs, BPM, importProgress],
  )

  const value: PlaybackState = {
    playing,
    recording,
    looping,
    positionMs,
    progress: msToProgress(positionMs, loopMsRef.current),
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
  }

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>
}

export function usePlayback() {
  const ctx = useContext(PlaybackContext)
  if (!ctx) throw new Error('usePlayback debe usarse dentro de PlaybackProvider')
  return ctx
}

export { msATiempoFormateado as formatTimecode } from '@/lib/audio-conversions'

export function msToBarBeat(ms: number, bpm = 120, beatsPerBar = 4) {
  const msPerBeat = 60000 / bpm
  const totalBeats = ms / msPerBeat
  const bar = Math.floor(totalBeats / beatsPerBar) + 1
  const beat = Math.floor(totalBeats % beatsPerBar) + 1
  return { bar, beat }
}
