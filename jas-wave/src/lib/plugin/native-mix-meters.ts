/**
 * Peaks del mix nativo (post-fader / post-master) vía plugin-host getMixMeters.
 * stemIndex coincide con setTrackStemLayout / encodeTrackGraph.
 */

type MixMetersSnapshot = {
  masterPeak: number
  byStem: Float32Array
  sidechainByStem: Float32Array
  updatedAt: number
}

const byStem = new Float32Array(64)
const byStemL = new Float32Array(64)
const byStemR = new Float32Array(64)
const sidechainByStem = new Float32Array(64)
let masterPeak = 0

/** Medición completa del master nativo (post-fader, post-limitador). Los niveles son lineales 0..1. */
export type NativeMasterMetering = {
  peakL: number
  peakR: number
  rmsL: number
  rmsR: number
  /** −1 (fuera de fase) … +1 (mono). */
  correlation: number
  lufsMomentary: number
  lufsShort: number
  lufsIntegrated: number
}
const masterMetering: NativeMasterMetering = {
  peakL: 0,
  peakR: 0,
  rmsL: 0,
  rmsR: 0,
  correlation: 1,
  lufsMomentary: -120,
  lufsShort: -120,
  lufsIntegrated: -120,
}
let updatedAt = 0
let pollPromise: Promise<void> | null = null
let stemIdOrder: string[] = []

/** Hold: no borrar picos a 0 entre polls lentos. */
const HOLD_MS = 180

export function isNativeMeterHostAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.electron?.pluginHostSend
}

export function setMixMeterTrackOrder(trackIds: string[]): void {
  stemIdOrder = trackIds.slice(0, 64)
  if (!isNativeMeterHostAvailable() || trackIds.length === 0) return
  try {
    void window.electron!.pluginHostSend!({
      type: 'setMeterTrackOrder',
      ids: trackIds.slice(0, 64).join(','),
    })
  } catch {
    /* ignore */
  }
}

export function getMixMeterTrackOrder(): string[] {
  return stemIdOrder.slice()
}

export function getNativeMasterPeak(): number {
  return masterPeak
}

/** Espectro del master (dBFS por columna log 20 Hz–20 kHz), calculado en el host con la FFT de los plugins. */
const MASTER_SPECTRUM_COLS = 96
const masterSpectrum = new Float32Array(MASTER_SPECTRUM_COLS).fill(-140)
let spectrumPoll: Promise<void> | null = null

export function getNativeMasterSpectrum(): Float32Array {
  return masterSpectrum
}

export async function refreshNativeMasterSpectrum(): Promise<void> {
  if (spectrumPoll) return spectrumPoll
  const api = typeof window !== 'undefined' ? window.electron : undefined
  if (!api?.pluginHostSend) return
  spectrumPoll = (async () => {
    try {
      const raw = (await Promise.race([
        api.pluginHostSend({ type: 'getMasterSpectrum', count: MASTER_SPECTRUM_COLS }),
        new Promise<null>((r) => setTimeout(() => r(null), 500)),
      ])) as { ok?: boolean; columns?: number[] } | null
      if (!raw || raw.ok === false || !Array.isArray(raw.columns)) return
      for (let i = 0; i < MASTER_SPECTRUM_COLS; i++) {
        const v = raw.columns[i]
        masterSpectrum[i] = typeof v === 'number' && Number.isFinite(v) ? Math.max(-140, Math.min(0, v)) : -140
      }
    } catch {
      /* host ocupado: se conserva el último espectro */
    }
  })().finally(() => {
    spectrumPoll = null
  })
  return spectrumPoll
}

/** Espectro post-fader por pista: cada pista tiene su tap en el host, así que varios se ven a la vez. */
const STEM_SPECTRUM_COLS = 48
const stemSpectra = new Map<string, Float32Array>()
const stemSpectrumPolls = new Map<string, Promise<void>>()

/** Columnas en dBFS (log 20 Hz–20 kHz) de `trackId`, o null si aún no hay datos de esa pista. */
export function getNativeTrackSpectrum(trackId: string): Float32Array | null {
  return stemSpectra.get(trackId) ?? null
}

export async function refreshNativeTrackSpectrum(trackId: string): Promise<void> {
  const enCurso = stemSpectrumPolls.get(trackId)
  if (enCurso) return enCurso
  const api = typeof window !== 'undefined' ? window.electron : undefined
  if (!api?.pluginHostSend) return
  const index = stemIdOrder.indexOf(trackId)
  if (index < 0) return
  const poll = (async () => {
    try {
      const raw = (await Promise.race([
        api.pluginHostSend({ type: 'getStemSpectrum', index, count: STEM_SPECTRUM_COLS }),
        new Promise<null>((r) => setTimeout(() => r(null), 500)),
      ])) as { ok?: boolean; columns?: number[] } | null
      if (!raw || raw.ok === false || !Array.isArray(raw.columns)) return
      let cols = stemSpectra.get(trackId)
      if (!cols) {
        cols = new Float32Array(STEM_SPECTRUM_COLS).fill(-140)
        stemSpectra.set(trackId, cols)
      }
      for (let i = 0; i < STEM_SPECTRUM_COLS; i++) {
        const v = raw.columns[i]
        cols[i] = typeof v === 'number' && Number.isFinite(v) ? Math.max(-140, Math.min(0, v)) : -140
      }
    } catch {
      /* host ocupado: se conserva el último espectro */
    }
  })().finally(() => {
    stemSpectrumPolls.delete(trackId)
  })
  stemSpectrumPolls.set(trackId, poll)
  return poll
}

/** Apaga el tap del host de esa pista (su tira cerró el espectro). Los demás siguen. */
export function releaseNativeTrackSpectrum(trackId: string): void {
  stemSpectra.delete(trackId)
  const index = stemIdOrder.indexOf(trackId)
  const api = typeof window !== 'undefined' ? window.electron : undefined
  if (index < 0 || !api?.pluginHostSend) return
  void Promise.resolve(api.pluginHostSend({ type: 'getStemSpectrum', index, release: true })).catch(() => {})
}

export function getNativeMasterMetering(): NativeMasterMetering {
  return masterMetering
}

/** Reinicia la sonoridad integrada del master (p. ej. al empezar una pasada de reproducción). */
export function resetNativeMasterLoudness(): void {
  try {
    void window.electron?.pluginHostSend?.({ type: 'resetMasterLoudness' })
  } catch {
    /* ignore */
  }
}

export function getNativeTrackSidechainPeak(trackId: string): number | null {
  const idx = stemIdOrder.indexOf(trackId)
  if (idx < 0 || idx >= 64) return null
  return sidechainByStem[idx] ?? 0
}

export function snapshotNativeSidechainPeaks(trackIds: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id of trackIds) {
    const p = getNativeTrackSidechainPeak(id)
    if (p != null && p > 0) out[id] = p
  }
  return out
}

export function getNativeTrackPeak(trackId: string): number | null {
  const idx = stemIdOrder.indexOf(trackId)
  if (idx < 0 || idx >= 64) return null
  return byStem[idx] ?? 0
}

/** Picos L/R post-fader de la pista (lineal 0..1), o null si no está en el grafo nativo. */
export function getNativeTrackPeakStereo(trackId: string): { l: number; r: number } | null {
  const idx = stemIdOrder.indexOf(trackId)
  if (idx < 0 || idx >= 64) return null
  return { l: byStemL[idx] ?? 0, r: byStemR[idx] ?? 0 }
}

/** Max peak across all stems (útil para master cuando el bus DAW está silenciado). */
export function getNativeMaxStemPeak(): number {
  let m = 0
  for (let i = 0; i < stemIdOrder.length && i < 64; i++) {
    const p = byStem[i] ?? 0
    if (p > m) m = p
  }
  return m
}

export function hasFreshNativeMeters(maxAgeMs = 1000): boolean {
  return updatedAt > 0 && performance.now() - updatedAt < maxAgeMs
}

export async function refreshNativeMixMeters(): Promise<void> {
  if (pollPromise) return pollPromise
  const api = typeof window !== 'undefined' ? window.electron : undefined
  if (!api?.pluginHostSend) return
  pollPromise = (async () => {
    try {
      const raw = (await Promise.race([
        api.pluginHostSend({ type: 'getMixMeters' }),
        new Promise<null>((r) => setTimeout(() => r(null), 500)),
      ])) as {
        ok?: boolean
        masterPeak?: number
        masterPeakL?: number
        masterPeakR?: number
        masterRmsL?: number
        masterRmsR?: number
        masterCorrelation?: number
        lufsMomentary?: number
        lufsShort?: number
        lufsIntegrated?: number
        tracks?: Array<{ index?: number; peak?: number; peakL?: number; peakR?: number; sidechainPeak?: number }>
      } | null
      if (!raw || raw.ok === false) return
      const now = performance.now()
      const hold = updatedAt > 0 && now - updatedAt < HOLD_MS
      if (typeof raw.masterPeak === 'number' && Number.isFinite(raw.masterPeak)) {
        const next = Math.max(0, Math.min(1, raw.masterPeak))
        masterPeak = hold ? Math.max(masterPeak * 0.88, next) : next
      }
      const lin = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)
      const lufs = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-120, Math.min(12, v)) : -120)
      masterMetering.peakL = hold ? Math.max(masterMetering.peakL * 0.88, lin(raw.masterPeakL)) : lin(raw.masterPeakL)
      masterMetering.peakR = hold ? Math.max(masterMetering.peakR * 0.88, lin(raw.masterPeakR)) : lin(raw.masterPeakR)
      masterMetering.rmsL = lin(raw.masterRmsL)
      masterMetering.rmsR = lin(raw.masterRmsR)
      masterMetering.correlation =
        typeof raw.masterCorrelation === 'number' && Number.isFinite(raw.masterCorrelation)
          ? Math.max(-1, Math.min(1, raw.masterCorrelation))
          : 1
      masterMetering.lufsMomentary = lufs(raw.lufsMomentary)
      masterMetering.lufsShort = lufs(raw.lufsShort)
      masterMetering.lufsIntegrated = lufs(raw.lufsIntegrated)
      const nextStem = new Float32Array(64)
      const nextSidechain = new Float32Array(64)
      const nextL = new Float32Array(64)
      const nextR = new Float32Array(64)
      for (const t of raw.tracks ?? []) {
        const i = typeof t.index === 'number' ? t.index : -1
        const p = typeof t.peak === 'number' ? t.peak : 0
        const sc = typeof t.sidechainPeak === 'number' ? t.sidechainPeak : 0
        if (i >= 0 && i < 64 && Number.isFinite(p)) nextStem[i] = Math.max(0, Math.min(1, p))
        if (i >= 0 && i < 64 && Number.isFinite(sc)) nextSidechain[i] = Math.max(0, Math.min(1, sc))
        if (i >= 0 && i < 64) {
          // Hosts antiguos sin L/R: ambos canales = pico combinado.
          nextL[i] = typeof t.peakL === 'number' ? lin(t.peakL) : nextStem[i]!
          nextR[i] = typeof t.peakR === 'number' ? lin(t.peakR) : nextStem[i]!
        }
      }
      for (let i = 0; i < 64; i++) {
        byStem[i] = hold ? Math.max(byStem[i]! * 0.88, nextStem[i]!) : nextStem[i]!
        byStemL[i] = hold ? Math.max(byStemL[i]! * 0.88, nextL[i]!) : nextL[i]!
        byStemR[i] = hold ? Math.max(byStemR[i]! * 0.88, nextR[i]!) : nextR[i]!
        sidechainByStem[i] = hold
          ? Math.max(sidechainByStem[i]! * 0.88, nextSidechain[i]!)
          : nextSidechain[i]!
      }
      updatedAt = now
    } catch {
      /* host ocupado — conservar peaks previos */
    }
  })().finally(() => {
    pollPromise = null
  })
  return pollPromise
}

export function snapshotNativeMixMeters(): MixMetersSnapshot {
  return { masterPeak, byStem: byStem.slice(), sidechainByStem: sidechainByStem.slice(), updatedAt }
}
