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
const sidechainByStem = new Float32Array(64)
let masterPeak = 0
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
        tracks?: Array<{ index?: number; peak?: number; sidechainPeak?: number }>
      } | null
      if (!raw || raw.ok === false) return
      const now = performance.now()
      const hold = updatedAt > 0 && now - updatedAt < HOLD_MS
      if (typeof raw.masterPeak === 'number' && Number.isFinite(raw.masterPeak)) {
        const next = Math.max(0, Math.min(1, raw.masterPeak))
        masterPeak = hold ? Math.max(masterPeak * 0.88, next) : next
      }
      const nextStem = new Float32Array(64)
      const nextSidechain = new Float32Array(64)
      for (const t of raw.tracks ?? []) {
        const i = typeof t.index === 'number' ? t.index : -1
        const p = typeof t.peak === 'number' ? t.peak : 0
        const sc = typeof t.sidechainPeak === 'number' ? t.sidechainPeak : 0
        if (i >= 0 && i < 64 && Number.isFinite(p)) nextStem[i] = Math.max(0, Math.min(1, p))
        if (i >= 0 && i < 64 && Number.isFinite(sc)) nextSidechain[i] = Math.max(0, Math.min(1, sc))
      }
      for (let i = 0; i < 64; i++) {
        byStem[i] = hold ? Math.max(byStem[i]! * 0.88, nextStem[i]!) : nextStem[i]!
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
