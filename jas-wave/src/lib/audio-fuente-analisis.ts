/**
 * Fuente de audio para las herramientas de análisis del agente (voz→MIDI, AudioLens).
 *
 * El estado del proyecto no guarda PCM: `analysis.voiceToMelody` & co. necesitan `audioData` + `sampleRate`.
 * Este módulo los resuelve en la capa de la app a partir de:
 *   - `audioRef`: una nota de voz o archivo adjunto en el chat (registro en memoria), o
 *   - `clipId`: un clip de audio del proyecto con su buffer ya decodificado en el motor de audio.
 * Siempre se devuelve mono y remuestreado con filtro a `SR_ANALISIS` (con su frecuencia real).
 */

import type { DAWState } from '../../../shared/src/types/state'

export const SR_ANALISIS = 22050
export const MAX_ANALISIS_SEG = 30
const MAX_ADJUNTOS = 8

export type AudioAnalisis = { audioData: number[]; sampleRate: number; duracionSeg: number }

// ── Registro de adjuntos del chat ───────────────────────────────────────────────

const adjuntos = new Map<string, AudioAnalisis>()

/** Registra el audio de un adjunto para que el agente pueda referirse a él con `audioRef`. */
export function registrarAudioAdjunto(id: string, audio: AudioAnalisis): void {
  adjuntos.delete(id)
  adjuntos.set(id, audio)
  while (adjuntos.size > MAX_ADJUNTOS) {
    const masAntiguo = adjuntos.keys().next().value
    if (masAntiguo === undefined) break
    adjuntos.delete(masAntiguo)
  }
}

export function quitarAudioAdjunto(id: string): void {
  adjuntos.delete(id)
}

export function obtenerAudioAdjunto(id: string): AudioAnalisis | undefined {
  return adjuntos.get(id)
}

// ── DSP puro ───────────────────────────────────────────────────────────────────

/** Mezcla los canales a mono (promedio). */
export function mezclarAMono(canales: ArrayLike<number>[]): Float32Array {
  const n = canales[0]?.length ?? 0
  const mono = new Float32Array(n)
  if (canales.length === 0) return mono
  for (const c of canales) for (let i = 0; i < n; i++) mono[i] = (mono[i] ?? 0) + (c[i] ?? 0)
  const k = 1 / canales.length
  for (let i = 0; i < n; i++) mono[i] = (mono[i] ?? 0) * k
  return mono
}

/**
 * Remuestreo con filtro paso-bajo sinc con ventana de Hann (anti-aliasing al decimar).
 * `desdeSeg` y `maxSeg` recortan la región analizada.
 */
export function remuestrear(mono: ArrayLike<number>, srOrigen: number, srDestino: number, desdeSeg = 0, maxSeg = Infinity): Float32Array {
  const inicio = Math.max(0, Math.floor(desdeSeg * srOrigen))
  const disponibles = Math.max(0, mono.length - inicio)
  const largoSeg = Math.min(disponibles / srOrigen, maxSeg)
  const outLen = Math.max(0, Math.floor(largoSeg * srDestino))
  const out = new Float32Array(outLen)
  if (outLen === 0) return out
  if (srOrigen === srDestino) {
    for (let i = 0; i < outLen; i++) out[i] = mono[inicio + i] ?? 0
    return out
  }
  const razon = srOrigen / srDestino
  const corte = Math.min(1, 1 / razon) * 0.95 // fracción de Nyquist de la entrada
  const semiancho = Math.ceil(16 * Math.max(1, razon))
  for (let i = 0; i < outLen; i++) {
    const centro = inicio + i * razon
    const k0 = Math.max(0, Math.ceil(centro - semiancho))
    const k1 = Math.min(mono.length - 1, Math.floor(centro + semiancho))
    let acc = 0
    let pesoTotal = 0
    for (let k = k0; k <= k1; k++) {
      const d = k - centro
      const x = Math.PI * corte * d
      const sinc = Math.abs(d) < 1e-9 ? corte : Math.sin(x) / (Math.PI * d)
      const ventana = 0.5 * (1 + Math.cos((Math.PI * d) / semiancho))
      const w = sinc * ventana
      acc += (mono[k] ?? 0) * w
      pesoTotal += w
    }
    // normalizar para ganancia unidad en continua también en los bordes del buffer
    out[i] = pesoTotal !== 0 ? acc / pesoTotal : 0
  }
  return out
}

// ── Resolución de la fuente ──────────────────────────────────────────────────────

export type BufferDecodificado = { sampleRate: number; channels: ArrayLike<number>[] }
export type BuscarBuffer = (clave: string) => BufferDecodificado | undefined

type ClipAudioEstado = {
  id: string
  tipo: string
  inicio?: number
  duracion?: number
  clipInicio?: number
  source?: { ruta?: string }
  sourceId?: string
}

function clipPorId(estado: DAWState, clipId: string): ClipAudioEstado | undefined {
  for (const t of estado.project.tracks) {
    for (const c of (t.clips ?? []) as unknown as ClipAudioEstado[]) if (c.id === clipId) return c
  }
  return undefined
}

/** Audio de un clip del proyecto: recorta el trozo que el clip muestra (clipInicio + duración en beats). */
export function audioDeClip(estado: DAWState, clipId: string, buscarBuffer: BuscarBuffer): AudioAnalisis {
  const clip = clipPorId(estado, clipId)
  if (!clip) throw new Error(`Clip no encontrado: ${clipId}`)
  if (clip.tipo !== 'audio') throw new Error(`El clip ${clipId} es de tipo ${clip.tipo}: solo se analiza audio`)
  const clave = clip.source?.ruta || clip.sourceId || clip.id
  const buf = buscarBuffer(clave) ?? buscarBuffer(clip.id)
  if (!buf) throw new Error(`El audio del clip ${clipId} no está cargado en memoria (reprodúcelo o impórtalo de nuevo)`)
  const bpm = estado.project.bpm?.valor && estado.project.bpm.valor > 0 ? estado.project.bpm.valor : 120
  const segPorBeat = 60 / bpm
  const desde = Math.max(0, (clip.clipInicio ?? 0) * segPorBeat)
  const duracion = clip.duracion && clip.duracion > 0 ? clip.duracion * segPorBeat : Infinity
  const mono = mezclarAMono(buf.channels)
  const pcm = remuestrear(mono, buf.sampleRate, SR_ANALISIS, desde, Math.min(duracion, MAX_ANALISIS_SEG))
  if (pcm.length === 0) throw new Error(`El clip ${clipId} no tiene audio en la región seleccionada`)
  return { audioData: Array.from(pcm), sampleRate: SR_ANALISIS, duracionSeg: pcm.length / SR_ANALISIS }
}

export const TIPOS_ANALISIS_CON_AUDIO: ReadonlySet<string> = new Set([
  'analysis.audioLens',
  'analysis.voiceToDrums',
  'analysis.voiceToMelody',
  'analysis.extractMidi',
])

/**
 * Completa el payload de una acción de análisis con `audioData` y `sampleRate` reales.
 * Devuelve un payload nuevo (sin `audioRef`, que no existe en el esquema del comando).
 * Si no hay audio resoluble lanza un error claro: nunca se analiza silencio.
 */
export function prepararPayloadAnalisisAudio(
  tipo: string,
  payload: Record<string, unknown>,
  estado: DAWState,
  buscarBuffer: BuscarBuffer,
): Record<string, unknown> {
  if (!TIPOS_ANALISIS_CON_AUDIO.has(tipo)) return payload
  const { audioRef, ...resto } = payload
  const yaTieneAudio = Array.isArray(resto.audioData) && resto.audioData.length > 0
  if (yaTieneAudio) return resto

  if (typeof audioRef === 'string' && audioRef) {
    const a = obtenerAudioAdjunto(audioRef)
    if (!a) throw new Error(`No hay ningún audio adjunto con id «${audioRef}» (¿se quitó del chat?)`)
    return { ...resto, audioData: a.audioData, sampleRate: a.sampleRate }
  }
  if (typeof resto.clipId === 'string' && resto.clipId) {
    const a = audioDeClip(estado, resto.clipId, buscarBuffer)
    return { ...resto, audioData: a.audioData, sampleRate: a.sampleRate }
  }
  // Un único adjunto en el chat: es lo que el usuario quiere analizar
  if (adjuntos.size === 1) {
    const a = [...adjuntos.values()][0]!
    return { ...resto, audioData: a.audioData, sampleRate: a.sampleRate }
  }
  throw new Error('Indica qué audio analizar: audioRef (nota de voz adjunta) o clipId (clip de audio del proyecto)')
}
