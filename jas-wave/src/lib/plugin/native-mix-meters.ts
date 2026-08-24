/**
 * Peaks del mix nativo (post-fader / post-master) vía plugin-host getMixMeters.
 * stemIndex coincide con setTrackStemLayout / encodeTrackGraph.
 */

type MixMetersSnapshot = {
  masterPeak: number
  byStem: Float32Array
  updatedAt: number
}

const byStem = new Float32Array(64)
let masterPeak = 0
let updatedAt = 0
let pollPromise: Promise<void> | null = null
let stemIdOrder: string[] = []

/** Hold: no borrar picos a 0 entre polls lentos. */
const HOLD_MS = 180

export function setMixMeterTrackOrder(trackIds: string[]): void {
  stemIdOrder = trackIds.slice(0, 64)
}

export function getMixMeterTrackOrder(): string[] {
  return stemIdOrder.slice()
}

export function getNativeMasterPeak(): number {
  return masterPeak
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
      const raw = (await api.pluginHostSend({ type: 'getMixMeters' })) as {
        ok?: boolean
        masterPeak?: number
        tracks?: Array<{ index?: number; peak?: number }>
      }
      if (!raw || raw.ok === false) return
      const now = performance.now()
      const hold = updatedAt > 0 && now - updatedAt < HOLD_MS
      if (typeof raw.masterPeak === 'number' && Number.isFinite(raw.masterPeak)) {
        const next = Math.max(0, Math.min(1, raw.masterPeak))
        masterPeak = hold ? Math.max(masterPeak * 0.88, next) : next
      }
      const nextStem = new Float32Array(64)
      for (const t of raw.tracks ?? []) {
        const i = typeof t.index === 'number' ? t.index : -1
        const p = typeof t.peak === 'number' ? t.peak : 0
        if (i >= 0 && i < 64 && Number.isFinite(p)) nextStem[i] = Math.max(0, Math.min(1, p))
      }
      for (let i = 0; i < 64; i++) {
        byStem[i] = hold ? Math.max(byStem[i]! * 0.88, nextStem[i]!) : nextStem[i]!
      }
      updatedAt = now
    } catch {
      /* host no listo */
    }
  })().finally(() => {
    pollPromise = null
  })
  return pollPromise
}

export function snapshotNativeMixMeters(): MixMetersSnapshot {
  return { masterPeak, byStem: byStem.slice(), updatedAt }
}
