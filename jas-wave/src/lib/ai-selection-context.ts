/**
 * Selección anclada al chat (Cursor-like Cmd/Ctrl+L).
 * MIDI (notas) o fragmento de plan.md / docs.
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

export type MidiNotesSelectionAnchor = {
  kind: 'midi-notes'
  trackId: string
  trackName: string
  clipId: string
  clipName: string
  noteIds: string[]
  notes: AnchoredMidiNote[]
  label: string
  createdAt: number
}

export type DocTextSelectionAnchor = {
  kind: 'doc-text'
  slug: string
  heading: string | null
  text: string
  label: string
  createdAt: number
}

export type MusicalSelectionAnchor = MidiNotesSelectionAnchor | DocTextSelectionAnchor

const MAX_NOTES_IN_PROMPT = 64
const MAX_DOC_CHARS = 4000

type Listener = () => void

let anchor: MusicalSelectionAnchor | null = null
const listeners = new Set<Listener>()
let rememberedDoc = { slug: 'plan.md', markdown: '' }

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

export function rememberOpenDoc(slug: string, markdown: string): void {
  rememberedDoc = { slug: slug || 'plan.md', markdown }
}

export function headingNearSnippet(md: string, snippet: string): string | null {
  const needle = snippet.trim()
  if (!needle) return null
  let pos = md.indexOf(needle)
  if (pos < 0) {
    const short = needle.slice(0, 48)
    pos = md.toLowerCase().indexOf(short.toLowerCase())
  }
  if (pos < 0) return null
  const before = md.slice(0, pos)
  let last: string | null = null
  const re = /^(#{2,6})\s+(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(before))) last = m[2]!.trim()
  return last
}

export function buildMidiNotesAnchor(opts: {
  trackId: string
  trackName: string
  clipId: string
  clipName: string
  notes: AnchoredMidiNote[]
}): MidiNotesSelectionAnchor {
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

export function buildDocTextAnchor(opts: {
  slug: string
  markdown: string
  text: string
}): DocTextSelectionAnchor {
  const text = opts.text.replace(/\r\n/g, '\n').trim().slice(0, MAX_DOC_CHARS)
  const heading = headingNearSnippet(opts.markdown, text)
  const one = text.replace(/\s+/g, ' ')
  const loc = `${opts.slug}${heading ? ` · ${heading}` : ''}`
  const label = one.length <= 42 ? `${loc}: ${one}` : `${loc} · ${one.slice(0, 40)}…`
  return {
    kind: 'doc-text',
    slug: opts.slug || 'plan.md',
    heading,
    text,
    label,
    createdAt: Date.now(),
  }
}

export function selectionHasContext(a: MusicalSelectionAnchor | null): boolean {
  if (!a) return false
  if (a.kind === 'midi-notes') return a.notes.length > 0
  return a.text.trim().length > 0
}

/** Captura texto seleccionado en el editor/preview de Docs. */
export function captureActiveDocTextSelection(): boolean {
  if (typeof document === 'undefined') return false
  const ae = document.activeElement
  if (ae instanceof HTMLTextAreaElement && ae.dataset.docSlug) {
    const start = ae.selectionStart
    const end = ae.selectionEnd
    if (end > start) {
      const text = ae.value.slice(start, end)
      if (text.trim().length >= 2) {
        setMusicalSelectionAnchor(
          buildDocTextAnchor({ slug: ae.dataset.docSlug, markdown: ae.value, text }),
        )
        return true
      }
    }
  }
  const sel = window.getSelection?.()
  const text = sel?.toString() ?? ''
  if (text.trim().length < 2) return false
  const node = sel?.anchorNode
  const el = node instanceof Element ? node : node?.parentElement
  const host = el?.closest?.('[data-doc-preview]') as HTMLElement | null
  if (!host) return false
  const slug = host.dataset.docSlug || rememberedDoc.slug
  const markdown = rememberedDoc.slug === slug ? rememberedDoc.markdown : rememberedDoc.markdown
  setMusicalSelectionAnchor(buildDocTextAnchor({ slug, markdown, text }))
  return true
}

/** Bloque para system/user context del agente. */
export function formatMusicalSelectionForPrompt(a: MusicalSelectionAnchor | null): string {
  if (!a || !selectionHasContext(a)) return ''
  if (a.kind === 'doc-text') {
    return [
      '## Fragmento de documento anclado (usuario · Ctrl+L / Hacer)',
      `Archivo: ${a.slug}`,
      a.heading ? `Sección: «${a.heading}»` : 'Sección: (sin encabezado cercano)',
      'Texto seleccionado:',
      '---',
      a.text,
      '---',
      'OBLIGATORIO: actualiza SOLO este fragmento / esa sección de plan.md (<<<DOC>>>). No reescribas el resto ni «Notas del usuario».',
      'Emite ACTIONS solo para implementar ESTA parte. No reconstruyas la canción entera salvo que el fragmento lo pida.',
    ].join('\n')
  }
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

export type AskAiSelectionDetail = { autoSend?: string }

export function dispatchAskAiAboutSelection(detail?: AskAiSelectionDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ASK_AI_SELECTION_EVENT, { detail: detail ?? {} }))
}
