/**
 * Lectura/validación segura de BPM (evita NaN pegajoso vía `??`).
 */

import type { DAWState } from '../types/state'

export const BPM_MIN = 20
export const BPM_MAX = 300
export const BPM_DEFAULT = 120

export function isValidBpm(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= BPM_MIN && value <= BPM_MAX
}

/** Coerce unknown → BPM válido o null (no escribe NaN). */
export function parseBpmInput(value: unknown): number | null {
  if (typeof value === 'number') return isValidBpm(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return isValidBpm(n) ? n : null
  }
  return null
}

/** Lee BPM del estado; NaN/undefined → fallback (default 120). */
export function safeProjectBpm(state: Pick<DAWState, 'project'> | null | undefined, fallback = BPM_DEFAULT): number {
  const raw = state?.project?.bpm?.valor
  if (isValidBpm(raw)) return raw
  const transport = (state as { transport?: { bpm?: number } } | null | undefined)?.transport?.bpm
  if (isValidBpm(transport)) return transport
  return isValidBpm(fallback) ? fallback : BPM_DEFAULT
}
