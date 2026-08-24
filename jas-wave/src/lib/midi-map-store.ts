/**
 * Persistencia de MIDI Learn (localStorage) + sesión de captura.
 */

import { eatListsFromBindings, upsertBinding, type MidiMapBinding, type MidiMapTrigger } from './midi-map'

const STORAGE_KEY = 'jaswave.midiMap.v1'

type Doc = { version: 1; bindings: MidiMapBinding[] }

let bindings: MidiMapBinding[] = load()
let learnTargetId: string | null = null
const listeners = new Set<() => void>()

function load(): MidiMapBinding[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const doc = JSON.parse(raw) as Doc
    if (doc?.version !== 1 || !Array.isArray(doc.bindings)) return []
    return doc.bindings.filter((b) => b && typeof b.targetId === 'string' && b.trigger)
  } catch {
    return []
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, bindings } satisfies Doc))
  } catch {
    /* quota / private mode */
  }
}

function emit(): void {
  for (const l of listeners) l()
}

export const midiMapStore = {
  getBindings(): MidiMapBinding[] {
    return bindings
  },

  getLearnTargetId(): string | null {
    return learnTargetId
  },

  eatCsv(): { ccs: string; notes: string } {
    return eatListsFromBindings(bindings)
  },

  subscribe(cb: () => void): () => void {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },

  startLearn(targetId: string): void {
    learnTargetId = targetId
    emit()
  },

  cancelLearn(): void {
    if (!learnTargetId) return
    learnTargetId = null
    emit()
  },

  assign(targetId: string, trigger: MidiMapTrigger): void {
    bindings = upsertBinding(bindings, { targetId, trigger })
    learnTargetId = null
    persist()
    emit()
  },

  captureIfLearning(trigger: MidiMapTrigger): boolean {
    if (!learnTargetId) return false
    this.assign(learnTargetId, trigger)
    return true
  },

  unbind(targetId: string): void {
    bindings = bindings.filter((b) => b.targetId !== targetId)
    persist()
    emit()
  },

  replaceAll(next: MidiMapBinding[]): void {
    bindings = next
    persist()
    emit()
  },

  clearAll(): void {
    bindings = []
    learnTargetId = null
    persist()
    emit()
  },
}
