/**
 * ITU-R BS.1770-4 loudness (K-weighting + gated integrated) en TS puro.
 */

export type LoudnessResult = {
  integrated: number
  shortTerm: number
  momentary: number
  rangoDinamico: number
  peak: number
  truePeak: number
  lufs: number
}

function biquadProcess(
  input: Float32Array,
  b0: number,
  b1: number,
  b2: number,
  a1: number,
  a2: number,
): Float32Array {
  const out = new Float32Array(input.length)
  let z1 = 0
  let z2 = 0
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!
    const y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    out[i] = y
  }
  return out
}

/** Coefs K-weighting a 48 kHz (BS.1770). */
function kWeight48k(ch: Float32Array): Float32Array {
  // Stage 1: high shelf
  const s1 = biquadProcess(ch, 1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585)
  // Stage 2: high-pass
  return biquadProcess(s1, 1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621)
}

function meanSquare(block: Float32Array): number {
  let s = 0
  for (let i = 0; i < block.length; i++) s += block[i]! * block[i]!
  return s / Math.max(1, block.length)
}

function lufsFromMs(ms: number): number {
  if (ms <= 1e-12) return -70
  return -0.691 + 10 * Math.log10(ms)
}

/**
 * Analiza PCM interleaved o canales separados (float -1..1).
 * sampleRate preferible 48000; otros rates usan la misma curva (aprox).
 */
export function measureLoudnessBs1770(
  channels: ArrayLike<number>[],
  sampleRate: number,
): LoudnessResult {
  const nCh = Math.max(1, channels.length)
  const frames = channels[0]?.length ?? 0
  if (frames === 0) {
    return {
      integrated: -70,
      shortTerm: -70,
      momentary: -70,
      rangoDinamico: 0,
      peak: 0,
      truePeak: 0,
      lufs: -70,
    }
  }

  const weighted: Float32Array[] = []
  let peak = 0
  for (let c = 0; c < nCh; c++) {
    const src = channels[c]!
    const f = new Float32Array(frames)
    for (let i = 0; i < frames; i++) {
      const x = Number(src[i] ?? 0)
      const a = Math.abs(x)
      if (a > peak) peak = a
      f[i] = x
    }
    weighted.push(sampleRate >= 44000 && sampleRate <= 50000 ? kWeight48k(f) : f)
  }

  // True peak approx: 4× linear upsample peak
  let truePeak = peak
  for (let c = 0; c < nCh; c++) {
    const src = channels[c]!
    for (let i = 0; i < frames - 1; i++) {
      const a = Number(src[i] ?? 0)
      const b = Number(src[i + 1] ?? 0)
      for (let k = 1; k < 4; k++) {
        const t = k / 4
        const x = a + (b - a) * t
        const ax = Math.abs(x)
        if (ax > truePeak) truePeak = ax
      }
    }
  }

  const blockMom = Math.max(1, Math.round(sampleRate * 0.4))
  const hopMom = Math.max(1, Math.round(sampleRate * 0.1))
  const blockShort = Math.max(1, Math.round(sampleRate * 3))
  const hopShort = Math.max(1, Math.round(sampleRate * 1))

  const momMs: number[] = []
  for (let start = 0; start + blockMom <= frames; start += hopMom) {
    let ms = 0
    for (let c = 0; c < nCh; c++) {
      const slice = weighted[c]!.subarray(start, start + blockMom)
      ms += meanSquare(slice)
    }
    momMs.push(ms)
  }

  const shortMs: number[] = []
  for (let start = 0; start + blockShort <= frames; start += hopShort) {
    let ms = 0
    for (let c = 0; c < nCh; c++) {
      const slice = weighted[c]!.subarray(start, start + blockShort)
      ms += meanSquare(slice)
    }
    shortMs.push(ms)
  }

  // Gated integrated (absolute −70 LUFS, relative −10)
  const absThresh = Math.pow(10, (-70 + 0.691) / 10)
  const aboveAbs = momMs.filter((m) => m > absThresh)
  let integrated = -70
  if (aboveAbs.length) {
    const meanAbs = aboveAbs.reduce((a, b) => a + b, 0) / aboveAbs.length
    const relThresh = meanAbs * Math.pow(10, -1) // −10 LU
    const gated = aboveAbs.filter((m) => m > relThresh)
    if (gated.length) {
      const meanG = gated.reduce((a, b) => a + b, 0) / gated.length
      integrated = lufsFromMs(meanG)
    }
  }

  const momentary = momMs.length ? lufsFromMs(momMs[momMs.length - 1]!) : -70
  const shortTerm = shortMs.length ? lufsFromMs(shortMs[shortMs.length - 1]!) : -70

  // LRA approx: 10th–95th percentile of short-term
  let lra = 0
  if (shortMs.length >= 2) {
    const sorted = shortMs.map(lufsFromMs).sort((a, b) => a - b)
    const p10 = sorted[Math.floor(sorted.length * 0.1)]!
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!
    lra = Math.max(0, p95 - p10)
  }

  return {
    integrated,
    shortTerm,
    momentary,
    rangoDinamico: lra,
    peak,
    truePeak,
    lufs: integrated,
  }
}

export const LOUDNESS_TARGETS = {
  streaming: -14,
  club: -9,
  cd: -9,
} as const

export type LoudnessTargetName = keyof typeof LOUDNESS_TARGETS

export function compareLoudnessTarget(
  integratedLufs: number,
  target: LoudnessTargetName,
): { targetLufs: number; deltaDb: number; gainLinear: number; suggestion: string } {
  const targetLufs = LOUDNESS_TARGETS[target]
  const deltaDb = targetLufs - integratedLufs
  const gainLinear = Math.pow(10, deltaDb / 20)
  const suggestion =
    Math.abs(deltaDb) < 0.5
      ? `Ya está cerca del target ${target} (${targetLufs} LUFS).`
      : deltaDb > 0
        ? `Sube ~${deltaDb.toFixed(1)} dB el master (o baja el limiter threshold) hacia ${targetLufs} LUFS.`
        : `Baja ~${Math.abs(deltaDb).toFixed(1)} dB el master hacia ${targetLufs} LUFS.`
  return { targetLufs, deltaDb, gainLinear, suggestion }
}
