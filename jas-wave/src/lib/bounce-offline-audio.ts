/**
 * Pre-render offline del contenido Web Audio (clips de audio + Soft Pad).
 *
 * Replica la colocación de clips y las voces sine del motor en vivo
 * (audio-engine.ts) sobre un OfflineAudioContext por pista, y devuelve
 * PCM estéreo interleave DRY por stemIndex (el fader/pan/mute lo aplica
 * el grafo nativo, igual que con los taps JWST en vivo).
 */

import { audioEngine } from '@/lib/audio-engine'
import { normalizeSoftPadRole, scheduleRoleVoice, type SoftPadRole } from '@/lib/role-voice'
import type { BounceContent, BounceTrack } from './bounce-content'

export type StemBuffers = Map<number, Float32Array>

function interleave(buffer: AudioBuffer, frames: number): Float32Array {
  const out = new Float32Array(frames * 2)
  const l = buffer.getChannelData(0)
  const r = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : l
  const n = Math.min(frames, buffer.length)
  for (let i = 0; i < n; i++) {
    out[i * 2] = l[i]!
    out[i * 2 + 1] = r[i]!
  }
  return out
}

async function resolveBuffer(
  key: string,
): Promise<AudioBuffer | undefined> {
  const cached = audioEngine.getAudioBuffer(key)
  if (cached) return cached
  try {
    const bin = await window.electron?.fileReadBinary?.(key)
    if (!bin || bin.byteLength === 0) return undefined
    return await audioEngine.decodeArrayBuffer(key, bin.buffer as ArrayBuffer)
  } catch {
    return undefined
  }
}

function placeClip(
  ctx: OfflineAudioContext,
  buffer: AudioBuffer,
  destination: AudioNode,
  clip: { inicioSec: number; duracionSec: number; clipInicioSec: number },
  startSec: number,
): void {
  const clipEnd = clip.inicioSec + clip.duracionSec
  if (startSec >= clipEnd) return

  let offset = 0
  let delay = 0
  let consumed = 0
  if (startSec > clip.inicioSec) {
    consumed = startSec - clip.inicioSec
    offset = consumed + clip.clipInicioSec
  } else {
    delay = clip.inicioSec - startSec
  }

  if (offset >= buffer.duration) return
  offset = Math.max(0, offset)

  const sourceNode = ctx.createBufferSource()
  sourceNode.buffer = buffer
  sourceNode.connect(destination)

  const clipRemain = Math.max(0, clip.duracionSec - consumed)
  // Si el clip de timeline es más largo que el buffer, loopear hasta cubrir
  if (clipRemain > buffer.duration - offset + 0.01) {
    sourceNode.loop = true
    sourceNode.loopStart = clip.clipInicioSec
    sourceNode.loopEnd = buffer.duration
    sourceNode.start(delay, offset, clipRemain)
  } else {
    const remainingDuration = Math.min(clipRemain, buffer.duration - offset)
    if (remainingDuration <= 0.001) return
    sourceNode.start(delay, offset, remainingDuration)
  }
}

function scheduleSoftPadVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  pitch: number,
  velocity: number,
  when: number,
  durationSec: number,
  role: SoftPadRole = 'default',
): void {
  scheduleRoleVoice(
    ctx as OfflineAudioContext,
    destination,
    pitch,
    velocity,
    Math.max(0, when),
    Math.max(0.04, durationSec),
    role,
  )
}

async function renderTrackStem(
  track: BounceTrack,
  opts: { startSec: number; durationSec: number; sampleRate: number },
): Promise<Float32Array | null> {
  const needsWeb =
    track.audioClips.length > 0 || (track.softPad && track.notes.length > 0)
  if (!needsWeb) return null

  const frames = Math.max(
    1,
    Math.ceil(opts.durationSec * opts.sampleRate),
  )
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: frames,
    sampleRate: opts.sampleRate,
  })
  const gain = ctx.createGain()
  gain.gain.value = 1
  gain.connect(ctx.destination)

  for (const clip of track.audioClips) {
    const buffer = await resolveBuffer(clip.sourceKey)
    if (!buffer) continue
    placeClip(ctx, buffer, gain, clip, opts.startSec)
  }

  if (track.softPad) {
    for (const note of track.notes) {
      const when = note.startSec - opts.startSec
      if (when + note.durSec <= 0) continue
      scheduleSoftPadVoice(
        ctx,
        gain,
        note.pitch,
        note.velocity,
        Math.max(0, when),
        note.durSec,
        normalizeSoftPadRole(track.softPadRole),
      )
    }
  }

  const rendered = await ctx.startRendering()
  return interleave(rendered, frames)
}

/**
 * Pre-renderiza todas las pistas con contenido Web Audio.
 * Devuelve Map<stemIndex, PCM interleaved estéreo>.
 */
export async function prerenderWebStems(
  content: BounceContent,
  opts: { startSec: number; durationSec: number; sampleRate: number },
): Promise<StemBuffers> {
  const out: StemBuffers = new Map()
  for (const track of content.tracks) {
    const pcm = await renderTrackStem(track, opts)
    if (pcm) out.set(track.stemIndex, pcm)
  }
  return out
}
