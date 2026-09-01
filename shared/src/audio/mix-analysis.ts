/**
 * Análisis de mezcla post-bounce: loudness + true-peak + espectro + correlación.
 */

import {
  compareLoudnessTarget,
  measureLoudnessBs1770,
  type LoudnessResult,
  type LoudnessTargetName,
} from './loudness-bs1770'

export type BandEnergy = {
  hzCenter: number
  label: string
  db: number
}

export type MixAnalysisReport = {
  loudness: LoudnessResult
  crestFactorDb: number
  clippingSamples: number
  clipping: boolean
  stereoCorrelation: number
  spectrumBands: BandEnergy[]
  truePeakDb: number
  peakDb: number
  sampleRate: number
  frames: number
}

export type AudioListenReport = MixAnalysisReport & {
  ok: boolean
  issues: string[]
  target?: LoudnessTargetName
  targetDeltaDb?: number
  suggestion?: string
  summary: string
}

const BAND_EDGES = [20, 60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000, 22000]
const BAND_LABELS = ['sub', 'bass', 'low', 'lowMid', 'mid', 'highMid', 'pres', 'brill', 'air', 'top']

function dbFromLin(x: number): number {
  if (x <= 1e-12) return -120
  return 20 * Math.log10(x)
}

/** Correlación estéreo (−1..1). Mono ≈ 1; invertido ≈ −1. */
export function measureStereoCorrelation(l: ArrayLike<number>, r: ArrayLike<number>): number {
  const n = Math.min(l.length, r.length)
  if (n < 2) return 1
  let sumL = 0
  let sumR = 0
  for (let i = 0; i < n; i++) {
    sumL += Number(l[i] ?? 0)
    sumR += Number(r[i] ?? 0)
  }
  const meanL = sumL / n
  const meanR = sumR / n
  let num = 0
  let denL = 0
  let denR = 0
  for (let i = 0; i < n; i++) {
    const a = Number(l[i] ?? 0) - meanL
    const b = Number(r[i] ?? 0) - meanR
    num += a * b
    denL += a * a
    denR += b * b
  }
  const den = Math.sqrt(denL * denR)
  if (den < 1e-12) return 1
  return Math.max(-1, Math.min(1, num / den))
}

function countClipping(channels: ArrayLike<number>[], thresh = 0.999): number {
  let n = 0
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      if (Math.abs(Number(ch[i] ?? 0)) >= thresh) n++
    }
  }
  return n
}

/** DFT por bandas (energía media en ventanas) — compacto para IA. */
export function measureSpectrumBands(
  channels: ArrayLike<number>[],
  sampleRate: number,
): BandEnergy[] {
  const nCh = Math.max(1, channels.length)
  const frames = channels[0]?.length ?? 0
  if (frames < 64) {
    return BAND_LABELS.map((label, i) => ({
      hzCenter: (BAND_EDGES[i]! + BAND_EDGES[i + 1]!) / 2,
      label,
      db: -120,
    }))
  }
  // Mezcla a mono
  const mono = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let s = 0
    for (let c = 0; c < nCh; c++) s += Number(channels[c]![i] ?? 0)
    mono[i] = s / nCh
  }
  // FFT radix-2 truncada
  let N = 1
  while (N < Math.min(frames, 4096)) N <<= 1
  N = Math.min(N, 4096)
  const re = new Float32Array(N)
  const im = new Float32Array(N)
  const off = Math.max(0, Math.floor((frames - N) / 2))
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
    re[i] = mono[off + i]! * w
  }
  fftInPlace(re, im)
  const bandEnergy = new Float64Array(BAND_LABELS.length)
  const bandCount = new Int32Array(BAND_LABELS.length)
  for (let k = 1; k < N / 2; k++) {
    const hz = (k * sampleRate) / N
    const mag2 = re[k]! * re[k]! + im[k]! * im[k]!
    for (let b = 0; b < BAND_LABELS.length; b++) {
      if (hz >= BAND_EDGES[b]! && hz < BAND_EDGES[b + 1]!) {
        bandEnergy[b]! += mag2
        bandCount[b]!++
        break
      }
    }
  }
  return BAND_LABELS.map((label, i) => {
    const avg = bandCount[i]! > 0 ? bandEnergy[i]! / bandCount[i]! : 0
    return {
      hzCenter: (BAND_EDGES[i]! + BAND_EDGES[i + 1]!) / 2,
      label,
      db: dbFromLin(Math.sqrt(avg) / Math.max(1, N / 4)),
    }
  })
}

function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length
  let j = 0
  for (let i = 1; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wlenRe = Math.cos(ang)
    const wlenIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let wRe = 1
      let wIm = 0
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k]!
        const uIm = im[i + k]!
        const vRe = re[i + k + len / 2]! * wRe - im[i + k + len / 2]! * wIm
        const vIm = re[i + k + len / 2]! * wIm + im[i + k + len / 2]! * wRe
        re[i + k] = uRe + vRe
        im[i + k] = uIm + vIm
        re[i + k + len / 2] = uRe - vRe
        im[i + k + len / 2] = uIm - vIm
        const nextWRe = wRe * wlenRe - wIm * wlenIm
        wIm = wRe * wlenIm + wIm * wlenRe
        wRe = nextWRe
      }
    }
  }
}

export function measureMixAnalysis(
  channels: ArrayLike<number>[],
  sampleRate: number,
): MixAnalysisReport {
  const loudness = measureLoudnessBs1770(channels, sampleRate)
  const frames = channels[0]?.length ?? 0
  const l = channels[0] ?? new Float32Array(0)
  const r = channels[1] ?? l
  const clippingSamples = countClipping(channels)
  const crestFactorDb = dbFromLin(loudness.peak) - (loudness.integrated + 0.691) // rough vs LUFS
  return {
    loudness,
    crestFactorDb,
    clippingSamples,
    clipping: clippingSamples > 0,
    stereoCorrelation: measureStereoCorrelation(l, r),
    spectrumBands: measureSpectrumBands(channels, sampleRate),
    truePeakDb: dbFromLin(loudness.truePeak),
    peakDb: dbFromLin(loudness.peak),
    sampleRate,
    frames,
  }
}

export function buildAudioListenReport(
  analysis: MixAnalysisReport,
  opts?: { target?: LoudnessTargetName; maxTruePeakDb?: number },
): AudioListenReport {
  const issues: string[] = []
  const maxTp = opts?.maxTruePeakDb ?? -1
  if (analysis.clipping) issues.push(`Clipping: ${analysis.clippingSamples} samples`)
  if (analysis.truePeakDb > maxTp) {
    issues.push(`True-peak ${analysis.truePeakDb.toFixed(1)} dBTP > ceiling ${maxTp} dBTP`)
  }
  if (analysis.stereoCorrelation < -0.3) {
    issues.push(`Correlación estéreo baja (${analysis.stereoCorrelation.toFixed(2)})`)
  }
  if (analysis.stereoCorrelation > 0.98 && analysis.spectrumBands[0]) {
    /* mono-ish OK for some masters — no issue */
  }
  let targetDeltaDb: number | undefined
  let suggestion: string | undefined
  if (opts?.target) {
    const cmp = compareLoudnessTarget(analysis.loudness.integrated, opts.target)
    targetDeltaDb = cmp.deltaDb
    suggestion = cmp.suggestion
    if (Math.abs(cmp.deltaDb) > 1.5) {
      issues.push(`Fuera de target ${opts.target}: Δ ${cmp.deltaDb.toFixed(1)} dB`)
    }
  }
  const ok = issues.length === 0
  const topBands = [...analysis.spectrumBands]
    .sort((a, b) => b.db - a.db)
    .slice(0, 3)
    .map((b) => `${b.label} ${b.db.toFixed(0)}dB`)
    .join(', ')
  const summary = ok
    ? `OK · ${analysis.loudness.integrated.toFixed(1)} LUFS · TP ${analysis.truePeakDb.toFixed(1)} dBTP · corr ${analysis.stereoCorrelation.toFixed(2)} · bandas ${topBands}`
    : `Problemas: ${issues.join('; ')} · ${analysis.loudness.integrated.toFixed(1)} LUFS`
  return {
    ...analysis,
    ok,
    issues,
    target: opts?.target,
    targetDeltaDb,
    suggestion,
    summary,
  }
}

/** Aplica ganancia lineal a canales (normalización). */
export function applyGainToChannels(
  channels: Float32Array[],
  gainLinear: number,
): Float32Array[] {
  return channels.map((ch) => {
    const out = new Float32Array(ch.length)
    for (let i = 0; i < ch.length; i++) out[i] = ch[i]! * gainLinear
    return out
  })
}

export function normalizeGainForTarget(
  analysis: MixAnalysisReport,
  mode: 'peak' | 'lufs',
  targetDb: number,
): number {
  if (mode === 'peak') {
    const peakDb = analysis.peakDb
    if (peakDb <= -120) return 1
    return Math.pow(10, (targetDb - peakDb) / 20)
  }
  const delta = targetDb - analysis.loudness.integrated
  return Math.pow(10, delta / 20)
}
