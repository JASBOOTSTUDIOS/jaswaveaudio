/**
 * Selección musical anclada al chat (Cursor-like Cmd/Ctrl+L).
 * Serializa notas/clip/pista para que el LLM sepa de qué habla el usuario.
 */

import { countDuplicateMidiNotes } from './midi-note-dedupe'

export type AnchoredMidiNote = {
  id: string
  pitch: number
  inicio: number
  duracion: number
  velocidad: number
  canal?: number
}

export type MusicalSelectionAnchor = {
  kind: 'midi-notes'
  trackId: string
  trackName: string
  clipId: string
  clipName: string
  noteIds: string[]
  notes: AnchoredMidiNote[]
  /** Resumen corto para chips UI */
  label: string
  createdAt: number
}

const MAX_NOTES_IN_PROMPT = 64

type Listener = () => void

let anchor: MusicalSelectionAnchor | null = null
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l()
}

export function subscribeMusicalSelection(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getMusicalSelectionAnchor(): MusicalSelectionAnchor | null {
  return anchor
}

export function clearMusicalSelectionAnchor(): void {
  if (!anchor) return
  anchor = null
  emit()
}

export function setMusicalSelectionAnchor(next: MusicalSelectionAnchor | null): void {
  anchor = next
  emit()
}

export function buildMidiNotesAnchor(opts: {
  trackId: string
  trackName: string
  clipId: string
  clipName: string
  notes: AnchoredMidiNote[]
}): MusicalSelectionAnchor {
  const notes = opts.notes.slice(0, MAX_NOTES_IN_PROMPT)
  const noteIds = notes.map((n) => n.id)
  const pitches = notes.map((n) => n.pitch)
  const lo = pitches.length ? Math.min(...pitches) : 0
  const hi = pitches.length ? Math.max(...pitches) : 0
  const label =
    notes.length === 0
      ? 'Selección vacía'
      : notes.length === 1
        ? `1 nota · pista «${opts.trackName}» · pitch ${notes[0]!.pitch}`
        : `${notes.length} notas · «${opts.trackName}» · pitches ${lo}–${hi}`
  return {
    kind: 'midi-notes',
    trackId: opts.trackId,
    trackName: opts.trackName,
    clipId: opts.clipId,
    clipName: opts.clipName,
    noteIds,
    notes,
    label,
    createdAt: Date.now(),
  }
}

/** Bloque para system/user context del agente. */
export function formatMusicalSelectionForPrompt(a: MusicalSelectionAnchor | null): string {
  if (!a || a.notes.length === 0) return ''
  const dupes = countDuplicateMidiNotes(a.notes)
  const lines = a.notes.map(
    (n) =>
      `- id=${n.id} pitch=${n.pitch} inicio=${Number(n.inicio.toFixed(4))}b dur=${Number(n.duracion.toFixed(4))}b vel=${n.velocidad}${
        n.canal != null ? ` ch=${n.canal}` : ''
      }`,
  )
  const truncated = a.noteIds.length > a.notes.length
  const out = [
    '## Selección musical anclada (usuario · Ctrl+L / botón Preguntar)',
    `Pista: «${a.trackName}» (${a.trackId})`,
    `Clip: «${a.clipName}» (${a.clipId})`,
    `Notas (${a.noteIds.length}${truncated ? `, mostrando ${a.notes.length}` : ''}):`,
    ...lines,
    '',
  ]
  if (dupes > 0) {
    out.push(
      `⚠️ DETECTADO: ~${dupes} notas duplicadas (mismo pitch+inicio). Para limpiar usa midi.notes.dedupe { pistaId, clipId } — NO digas que no puedes leer las notas: ya están arriba.`,
    )
  }
  out.push(
    'Cuando el usuario diga «estas notas», «esta secuencia», «esto», opera SOLO sobre estos noteIds / este clip.',
    'Las notas YA están listadas aquí: no necesitas midi.notes.get si tienes bastantes datos.',
    'Usa midi.notes.dedupe (duplicados), midi.notes.set / midi.transpose / midi.quantize / midi.deleteNotes / midi.setVelocity.',
    'Para inspeccionar el clip completo: midi.notes.get { clipId, pistaId? } o midi.getClipSummary { clipId }.',
    'No regeneres todo el clip salvo que lo pida.',
  )
  return out.join('\n')
}

/** Prefijo opcional en el mensaje del usuario. */
export function selectionChipInsertText(a: MusicalSelectionAnchor): string {
  return `[selección: ${a.label}] `
}

/** Evento DOM: pedir foco al chat con la selección actual. */
export const ASK_AI_SELECTION_EVENT = 'jaswave-ask-ai-selection'

export function dispatchAskAiAboutSelection(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ASK_AI_SELECTION_EVENT))
}
