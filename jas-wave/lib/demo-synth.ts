/**
 * Síntesis procedural de clips de demostración (Drums, Bass, Chords, Lead).
 *
 * Diseño (estabilidad + calidad):
 *  - Osciladores con fase integrada (sin discontinuidades de fase).
 *  - Envolventes que llegan a CERO exactamente en el límite de cada nota
 *    (sin clicks de truncado).
 *  - PRNG con semilla determinista → el mismo buffer se genera igual siempre.
 *  - Normalización final a pico <= 0.92 → nunca recorta en el master.
 */

export type DemoType = 'drums' | 'bass' | 'chords' | 'lead' | 'synth'

export interface DemoRender {
  left: Float32Array
  right: Float32Array
}

const kTargetPeak = 0.92
const kTau = Math.PI * 2

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** PRNG determinista (LCG) → demos reproducibles entre sesiones. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Filtro de un polo (determinista por muestra). */
class OnePole {
  private y = 0
  private readonly alpha: number
  constructor(sampleRate: number, cutoffHz: number) {
    const a = (Math.PI * 2 * cutoffHz) / sampleRate
    this.alpha = 1 - Math.exp(-a)
  }
  push(x: number): number {
    this.y += this.alpha * (x - this.y)
    return this.y
  }
}

/**
 * Envolvente "pluck" a cero:
 *  - Attack lineal corto (sin pop al inicio).
 *  - Release cuadrático que llega exactamente a 0 en u === noteLen (sin click).
 */
function pluckEnv(uSec: number, noteLenSec: number, attackSec: number): number {
  const atk = Math.min(1, uSec / attackSec)
  const rel = uSec / noteLenSec
  if (rel >= 1) return 0
  const tail = 1 - rel
  return atk * tail * tail
}

/** Envolvente de pad: attack, sustain y release suave a cero. */
function padEnv(uSec: number, lenSec: number, attackSec: number, sustainFrac: number): number {
  const atk = Math.min(1, uSec / attackSec)
  const f = uSec / lenSec
  if (f >= 1) return 0
  if (f <= sustainFrac) return atk
  const tail = (1 - f) / (1 - sustainFrac)
  return atk * tail * tail
}

function addHitLR(
  bufL: Float32Array,
  bufR: Float32Array,
  srcL: ArrayLike<number>,
  srcR: ArrayLike<number>,
  start: number,
): void {
  const n = srcL.length
  for (let i = 0; i < n; i++) {
    const j = start + i
    if (j < 0 || j >= bufL.length) break
    bufL[j] += srcL[i]
    bufR[j] += srcR[i]
  }
}

function renderKick(sr: number, frames: number): { l: Float32Array; r: Float32Array } {
  const l = new Float32Array(frames)
  const r = new Float32Array(frames)
  let phase = 0
  for (let i = 0; i < frames; i++) {
    const t = i / sr
    const freq = 42 + 143 * Math.exp(-t * 24)
    phase += (kTau * freq) / sr
    const env = Math.min(1, t / 0.0012) * Math.exp(-t * 15)
    const body = Math.sin(phase) * env
    let s = body * 0.85
    if (t < 0.006) s += Math.min(1, t / 0.0006) * Math.sin(kTau * 240 * t) * 0.25 * Math.exp(-t * 500)
    l[i] = s
    r[i] = s
  }
  return { l, r }
}

function renderSnare(sr: number, frames: number, rnd: () => number): { l: Float32Array; r: Float32Array } {
  const l = new Float32Array(frames)
  const r = new Float32Array(frames)
  let phase = 0
  let lp = 0
  for (let i = 0; i < frames; i++) {
    const t = i / sr
    phase += (kTau * 189) / sr
    const noise = rnd() * 2 - 1
    lp += 0.38 * (noise - lp)
    const hp = noise - lp
    const env = Math.min(1, t / 0.0009) * Math.exp(-t * 20)
    const s = (hp * 0.62 + Math.sin(phase) * 0.42 + lp * 0.24) * env
    l[i] = s * 0.62
    r[i] = s * 0.62
  }
  return { l, r }
}

function renderHat(sr: number, frames: number, rnd: () => number, accent: boolean): { l: Float32Array; r: Float32Array } {
  const l = new Float32Array(frames)
  const r = new Float32Array(frames)
  let lp = 0
  const amp = accent ? 0.34 : 0.22
  const pan = accent ? 0.14 : -0.14
  for (let i = 0; i < frames; i++) {
    const t = i / sr
    const noise = rnd() * 2 - 1
    lp += 0.12 * (noise - lp)
    const hp = noise - lp
    const env = Math.min(1, t / 0.0005) * Math.exp(-t * 72)
    const s = hp * env * amp
    l[i] = s * (1 - Math.max(0, pan))
    r[i] = s * (1 + Math.min(0, pan))
  }
  return { l, r }
}

function renderDrums(sr: number, length: number): DemoRender {
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  const rnd = makeRng(hashString('drums.v1'))
  const bpm = 134
  const spb = 60 / bpm
  const barLen = spb * 4
  const bars = Math.floor(length / sr / barLen)

  for (let b = 0; b < bars; b++) {
    for (let beat = 0; beat < 4; beat++) {
      const t0 = (b * barLen + beat * spb) * sr
      const kick = renderKick(sr, Math.round(spb * 0.95 * sr))
      addHitLR(left, right, kick.l, kick.r, Math.round(t0))

      if (beat === 1 || beat === 3) {
        const snare = renderSnare(sr, Math.round(spb * 0.98 * sr), rnd)
        addHitLR(left, right, snare.l, snare.r, Math.round(t0))
      }

      for (let eighth = 0; eighth < 2; eighth++) {
        const hatT0 = t0 + eighth * (spb / 2) * sr
        const hat = renderHat(sr, Math.round((spb / 2) * 0.98 * sr), rnd, eighth === 1)
        addHitLR(left, right, hat.l, hat.r, Math.round(hatT0))
      }
    }
  }
  return { left, right }
}

const kBassNotes = [55, 55, 65.41, 58.27, 55, 61.74, 58.27, 60.0]

function renderBass(sr: number, length: number): DemoRender {
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  const bpm = 134
  const spb = 60 / bpm
  const noteLen = spb / 2
  const nIdx = Math.floor(length / (noteLen * sr))

  for (let i = 0; i < nIdx; i++) {
    const freq = kBassNotes[i % kBassNotes.length]
    const start = Math.round(i * noteLen * sr)
    const frames = Math.min(Math.round(noteLen * sr), length - start)
    if (frames <= 0) break
    let phase = 0
    const lp = new OnePole(sr, 2600)
    for (let s = 0; s < frames; s++) {
      const u = s / sr
      const env = pluckEnv(u, noteLen, 0.0032)
      phase = (u * freq) % 1
      const saw = lp.push(phase * 2 - 1)
      const sub = Math.sin(kTau * (freq / 2) * u)
      const val = (saw * 0.42 + sub * 0.16) * env * 0.95
      left[start + s] = val
      right[start + s] = val
    }
  }
  return { left, right }
}

const kChords: number[][] = [
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
  [261.63, 329.63, 392.0],
  [196.0, 246.94, 293.66],
]

function renderChords(sr: number, length: number): DemoRender {
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  const bpm = 134
  const spb = 60 / bpm
  const barLen = spb * 4
  const nIdx = Math.floor(length / (barLen * sr))

  for (let i = 0; i < nIdx; i++) {
    const chord = kChords[i % kChords.length]
    const start = Math.round(i * barLen * sr)
    const frames = Math.min(Math.round(barLen * sr), length - start)
    if (frames <= 0) break
    const lp = new OnePole(sr, 4200)
    for (let s = 0; s < frames; s++) {
      const u = s / sr
      const env = padEnv(u, barLen, 1 / sr * 32, 0.72)
      let sum = 0
      for (const f of chord) sum += Math.sin(kTau * f * u)
      const val = lp.push(sum * 0.12) * env
      left[start + s] = val
      right[start + s] = val
    }
  }
  return { left, right }
}

const kArpNotes = [440, 523.25, 659.25, 783.99, 659.25, 523.25]

function renderLead(sr: number, length: number): DemoRender {
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  const bpm = 134
  const spb = 60 / bpm
  const noteLen = spb / 4
  const nIdx = Math.floor(length / (noteLen * sr))

  for (let i = 0; i < nIdx; i++) {
    const freq = kArpNotes[i % kArpNotes.length]
    const start = Math.round(i * noteLen * sr)
    const frames = Math.min(Math.round(noteLen * sr), length - start)
    if (frames <= 0) break
    let phase = 0
    const lp = new OnePole(sr, 3400)
    for (let s = 0; s < frames; s++) {
      const u = s / sr
      const env = pluckEnv(u, noteLen, 0.004)
      phase = (u * freq) % 1
      const tone = Math.sin(kTau * freq * u)
      const val = (lp.push(phase * 2 - 1) * 0.6 + tone * 0.4) * env * 0.34
      left[start + s] = val
      right[start + s] = val
    }
  }
  return { left, right }
}

/** Normaliza el buffer al pico objetivo (garantiza que nunca recorte). */
function normalizeToPeak(left: Float32Array, right: Float32Array, target: number): void {
  let peak = 0
  for (let i = 0; i < left.length; i++) {
    const a = Math.abs(left[i])
    const b = Math.abs(right[i])
    if (a > peak) peak = a
    if (b > peak) peak = b
  }
  if (peak > target) {
    const g = target / peak
    for (let i = 0; i < left.length; i++) {
      left[i] *= g
      right[i] *= g
    }
  }
}

/**
 * Sintetiza un clip de demo determinista.
 * @param type  drums | bass | chords | lead | synth
 * @param sampleRate  ejemplo 48000
 * @param durationSec  duración en segundos
 */
export function synthDemoSamples(type: DemoType, sampleRate: number, durationSec: number): DemoRender {
  const sr = sampleRate > 8000 ? sampleRate : 48000
  const duration = Math.max(1, durationSec)
  const length = Math.floor(sr * duration)

  let out: DemoRender
  if (type === 'drums') {
    out = renderDrums(sr, length)
  } else if (type === 'bass') {
    out = renderBass(sr, length)
  } else if (type === 'chords') {
    out = renderChords(sr, length)
  } else {
    out = renderLead(sr, length)
  }

  normalizeToPeak(out.left, out.right, kTargetPeak)

  if (out.left.length > length || out.right.length > length) {
    out.left = out.left.slice(0, length)
    out.right = out.right.slice(0, length)
  }
  return out
}