/**
 * Deduplicación de notas MIDI (mismo pitch + inicio ≈ mismo evento).
 */

export type DedupeableNote = {
  id?: string
  pitch: number
  inicio: number
  duracion: number
  velocidad?: number
}

const START_EPS = 1e-3

function noteKey(n: { pitch: number; inicio: number }): string {
  const start = Math.round(n.inicio / START_EPS) * START_EPS
  return `${Math.round(n.pitch)}@${start.toFixed(4)}`
}

/**
 * Conserva una nota por (pitch, inicio): la de mayor velocidad (desempate: primera).
 */
export function dedupeMidiNotes<T extends DedupeableNote>(
  notes: readonly T[],
): { kept: T[]; removedCount: number } {
  const best = new Map<string, T>()
  const order: string[] = []
  for (const n of notes) {
    const k = noteKey(n)
    const prev = best.get(k)
    if (!prev) {
      best.set(k, n)
      order.push(k)
      continue
    }
    const prevVel = Number(prev.velocidad ?? 80)
    const nextVel = Number(n.velocidad ?? 80)
    if (nextVel > prevVel) best.set(k, n)
  }
  const kept = order.map((k) => best.get(k)!).filter(Boolean)
  return { kept, removedCount: Math.max(0, notes.length - kept.length) }
}

export function countDuplicateMidiNotes(notes: ReadonlyArray<{ pitch: number; inicio: number }>): number {
  const seen = new Set<string>()
  let dupes = 0
  for (const n of notes) {
    const k = noteKey(n)
    if (seen.has(k)) dupes += 1
    else seen.add(k)
  }
  return dupes
}
