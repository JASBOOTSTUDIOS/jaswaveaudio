/**
 * Propuestas MIDI de la IA para overlay verde/rojo en piano roll (diff tipo Cursor).
 */

import { parseMidiClipMd } from './midi-clip-markdown'

export type ProposedMidiNote = {
  pitch: number
  inicio: number
  duracion: number
  velocidad: number
  /** add = verde (insertar); remove = rojo (quitar) */
  kind: 'add' | 'remove'
  noteId?: string
}

export type MidiProposalOverlay = {
  trackId: string
  clipId?: string
  notes: ProposedMidiNote[]
  sourceMessageId?: string
  label?: string
  updatedAt: number
}

type Listener = () => void

let overlay: MidiProposalOverlay | null = null
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l()
}

export function subscribeMidiProposal(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getMidiProposalOverlay(): MidiProposalOverlay | null {
  return overlay
}

export function clearMidiProposalOverlay(): void {
  if (!overlay) return
  overlay = null
  emit()
}

export function setMidiProposalOverlay(next: MidiProposalOverlay | null): void {
  overlay = next
  emit()
}

export function notesFromActionPayload(payload?: Record<string, unknown>): ProposedMidiNote[] {
  if (!payload) return []
  const raw = payload.notas ?? payload.notes
  if (!Array.isArray(raw)) return []
  return raw
    .map((n): ProposedMidiNote | null => {
      if (!n || typeof n !== 'object') return null
      const o = n as Record<string, unknown>
      const pitch = Number(o.pitch ?? o.nota)
      const inicio = Number(o.inicio ?? o.start ?? 0)
      const duracion = Number(o.duracion ?? o.duration ?? 0.25)
      const velocidad = Number(o.velocidad ?? o.velocity ?? 80)
      if (!Number.isFinite(pitch)) return null
      return {
        pitch,
        inicio: Number.isFinite(inicio) ? inicio : 0,
        duracion: Number.isFinite(duracion) ? Math.max(0.05, duracion) : 0.25,
        velocidad: Number.isFinite(velocidad) ? velocidad : 80,
        kind: 'add',
        noteId: o.id != null ? String(o.id) : undefined,
      }
    })
    .filter((x): x is ProposedMidiNote => Boolean(x))
    .slice(0, 400)
}

/** Publica overlay desde acciones pendientes (midi.clip.create / notes.set / md.upsert…). */
export function publishMidiProposalFromActions(
  actions: Array<{ type: string; payload?: Record<string, unknown> }>,
  opts?: { messageId?: string },
): void {
  const midiActs = actions.filter(
    (a) =>
      a.type === 'midi.clip.create' ||
      a.type === 'midi.notes.set' ||
      a.type === 'daw.generateMidiSong' ||
      a.type === 'midi.clip.md.upsert' ||
      a.type === 'midi.clip.md.apply',
  )
  if (!midiActs.length) {
    clearMidiProposalOverlay()
    return
  }
  const first = midiActs[0]!
  const p = first.payload ?? {}
  let notes = notesFromActionPayload(p)
  if (
    !notes.length &&
    (first.type === 'midi.clip.md.upsert' || first.type === 'midi.clip.md.apply') &&
    typeof p.markdown === 'string'
  ) {
    try {
      notes = parseMidiClipMd(p.markdown).notas.map((n) => ({
        pitch: n.pitch,
        inicio: n.inicio,
        duracion: n.duracion,
        velocidad: n.velocidad,
        kind: 'add' as const,
        noteId: n.id,
      }))
    } catch {
      /* ignore */
    }
  }
  const trackId = String(p.pistaId ?? p.trackId ?? '')
  if (!notes.length || !trackId) {
    if (first.type !== 'daw.generateMidiSong') clearMidiProposalOverlay()
    return
  }
  setMidiProposalOverlay({
    trackId,
    clipId: p.clipId != null ? String(p.clipId) : undefined,
    notes,
    sourceMessageId: opts?.messageId,
    label: String(p.nombre ?? first.type),
    updatedAt: Date.now(),
  })
}

export function publishMidiProposalFromMdPreview(data: {
  trackId: string
  clipId?: string
  notes: Array<{ id?: string; pitch: number; inicio: number; duracion: number; velocidad: number }>
  label?: string
  messageId?: string
}): void {
  if (!data.trackId || !data.notes.length) return
  setMidiProposalOverlay({
    trackId: data.trackId,
    clipId: data.clipId,
    notes: data.notes.map((n) => ({
      pitch: n.pitch,
      inicio: n.inicio,
      duracion: n.duracion,
      velocidad: n.velocidad,
      kind: 'add',
      noteId: n.id,
    })),
    sourceMessageId: data.messageId,
    label: data.label,
    updatedAt: Date.now(),
  })
}
