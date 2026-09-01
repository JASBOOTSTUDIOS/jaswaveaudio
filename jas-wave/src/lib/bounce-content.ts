/**
 * Contenido del proyecto para el bounce offline.
 *
 * Convierte DAWState → eventos concretos con los que el Plugin Host
 * puede renderizar audio real:
 *  - notas/CCs de clips MIDI hacia slots VST (delaySamples absolutos)
 *  - clips de audio (se pre-renderizan en Web Audio)
 *
 * Los stems son DRY: fader/pan/mute/solo viven en el grafo nativo
 * (syncReaperTrackGraph), igual que en playback en vivo.
 */

import { beatsASegundos } from '@/lib/audio-conversions'

export interface BounceNoteEvent {
  slotId?: string
  pitch: number
  velocity: number
  /** Segundos timeline absolutos. */
  startSec: number
  durSec: number
}

export interface BounceCcEvent {
  slotId?: string
  cc: number
  value: number
  timeSec: number
}

export interface BounceAudioClip {
  /** Key del buffer en audioEngine (ruta del archivo o key demo/importado). */
  sourceKey: string
  inicioSec: number
  duracionSec: number
  clipInicioSec: number
}

export interface BounceTrack {
  trackId: string
  stemIndex: number
  notes: BounceNoteEvent[]
  ccs: BounceCcEvent[]
  audioClips: BounceAudioClip[]
}

export interface BounceContent {
  bpm: number
  tracks: BounceTrack[]
  /** Fin del contenido (s o ventana pedida, lo que sea mayor). */
  totalSec: number
}

type ClipLike = {
  id: string
  tipo?: string
  trackId?: string
  inicio?: number
  duracion?: number
  notas?: Array<{
    pitch: number
    velocidad?: number
    inicio: number
    duracion: number
    mute?: boolean
  }>
  expression?: {
    cc?: Array<{ cc: number; puntos?: Array<{ tiempo: number; valor: number }> }>
  }
  clipInicio?: number
  source?: { ruta?: string }
}

type TrackLike = {
  id: string
  nombre?: string
  tags?: string[]
  clips?: ClipLike[]
  plugins?: unknown
}

export type BounceSourceState = {
  project: {
    bpm?: { valor?: number } | null
    tracks?: TrackLike[] | null
  }
}

export interface BounceSlotResolution {
  slotId?: string
}

/** Resuelve instrumento activo de una pista (slot VST). */
export type BounceSlotResolver = (
  trackId: string,
  plugins: unknown,
) => BounceSlotResolution

const noResolver: BounceSlotResolver = () => ({})

const MAX_STEMS = 64

function sourceKeyForClip(clip: ClipLike, trackId: string): string {
  const ruta = clip.source?.ruta
  if (ruta && ruta !== '') return ruta
  if (trackId === 'drums') return 'demo-drums'
  if (trackId === 'bass') return 'demo-bass'
  if (trackId === 'piano') return 'demo-chords'
  if (trackId === 'guitar') return 'demo-lead'
  return clip.id
}

/**
 * @param opts.startSec inicio de la ventana (default 0)
 * @param opts.endSec   fin de la ventana; si se omite se usa el fin del último evento
 * @param resolve       resolución de instrumento por pista (inyectable para tests)
 */
export function buildBounceContent(
  state: BounceSourceState,
  opts?: { startSec?: number; endSec?: number },
  resolve: BounceSlotResolver = noResolver,
): BounceContent {
  const bpm = state.project?.bpm?.valor ?? 120
  const startSec = Math.max(0, opts?.startSec ?? 0)
  const tracksIn = state.project?.tracks ?? []
  let contentEnd = startSec + 1

  const out: BounceTrack[] = []
  tracksIn.forEach((trk, i) => {
    if (i >= MAX_STEMS) return
    const resolved = resolve(trk.id, trk.plugins)
    const slotId = resolved.slotId

    const track: BounceTrack = {
      trackId: trk.id,
      stemIndex: i,
      notes: [],
      ccs: [],
      audioClips: [],
    }

    for (const clip of trk.clips ?? []) {
      const clipStart = beatsASegundos(clip.inicio ?? 0, bpm)
      const clipDur = beatsASegundos(clip.duracion ?? 16, bpm)
      const clipEnd = clipStart + clipDur
      contentEnd = Math.max(
        contentEnd,
        opts?.endSec != null ? Math.min(clipEnd, opts.endSec) : clipEnd,
      )
      if (clip.tipo !== 'midi') {
        // Clip de audio: entra si solapa la ventana
        if (clipEnd <= startSec) continue
        track.audioClips.push({
          sourceKey: sourceKeyForClip(clip, trk.id),
          inicioSec: clipStart,
          duracionSec: clipDur,
          clipInicioSec: clip.clipInicio ?? 0,
        })
        continue
      }

      for (const n of clip.notas ?? []) {
        if (n.mute || !Number.isFinite(n.pitch)) continue
        const noteStart = clipStart + beatsASegundos(n.inicio ?? 0, bpm)
        const noteDur = Math.max(0.03, beatsASegundos(n.duracion ?? 0.25, bpm))
        const noteEnd = noteStart + noteDur
        if (noteEnd <= startSec) continue
        if (opts?.endSec != null && noteStart >= opts.endSec) continue
        contentEnd = Math.max(contentEnd, noteEnd)
        track.notes.push({
          slotId,
          pitch: n.pitch,
          velocity: typeof n.velocidad === 'number' ? n.velocidad : 100,
          startSec: noteStart,
          durSec: noteDur,
        })
      }

      for (const lane of clip.expression?.cc ?? []) {
        for (const pt of lane.puntos ?? []) {
          const timeSec = clipStart + beatsASegundos(pt.tiempo ?? 0, bpm)
          if (timeSec < startSec - 0.02) continue
          if (opts?.endSec != null && timeSec > opts.endSec) continue
          const nrm = pt.valor <= 1 ? pt.valor : pt.valor / 127
          contentEnd = Math.max(contentEnd, timeSec)
          track.ccs.push({
            slotId,
            cc: lane.cc,
            value: Math.max(0, Math.min(127, Math.round(nrm * 127))),
            timeSec,
          })
        }
      }
    }

    if (
      track.notes.length > 0 ||
      track.ccs.length > 0 ||
      track.audioClips.length > 0
    ) {
      out.push(track)
    }
  })

  if (opts?.endSec != null) contentEnd = Math.max(contentEnd, opts.endSec)
  return { bpm, tracks: out, totalSec: contentEnd - startSec }
}
