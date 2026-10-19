/**
 * Sync bidireccional clip MIDI ↔ clip-*.md (Docs).
 * Observa DAW + AgentDocs; anti-bucle con hash + debounce.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { findMidiClip } from '../../../shared/src/midi/query'
import {
  getAgentDoc,
  subscribeAgentDocs,
  writeAgentDoc,
} from './agent-docs'
import {
  midiClipDocSlug,
  parseMidiClipMd,
  serializeMidiClipMd,
} from './midi-clip-markdown'

export type MidiClipMdBound = {
  projectId: string
  clipId: string
  trackId: string
  slug: string
}

export type MidiClipMdSyncStatus = {
  bound: boolean
  clipId: string | null
  trackId: string | null
  slug: string | null
  parseErrors: string[]
  lastOrigin: 'daw' | 'md' | null
  noteCount: number
}

const DEBOUNCE_MS = 200

type Session = {
  tienda: TiendaDAW
  projectId: string
  clipId: string
  trackId: string
  slug: string
  unsubDaw: () => void
  unsubDocs: () => void
  dawTimer: ReturnType<typeof setTimeout> | null
  mdTimer: ReturnType<typeof setTimeout> | null
  /** Último markdown que escribimos desde DAW (o aplicamos a DAW). */
  lastMdHash: string
  /** Fingerprint del clip DAW que ya reflejamos en el .md. */
  lastDawFp: string
  applyingFromMd: boolean
  writingFromDaw: boolean
  parseErrors: string[]
  lastOrigin: 'daw' | 'md' | null
}

let session: Session | null = null
/** Preferencia al abrir la tool (sobrevive unmount/remount breve). */
let preferred: { clipId: string; trackId: string } | null = null
const statusListeners = new Set<() => void>()

const EMPTY_STATUS: MidiClipMdSyncStatus = {
  bound: false,
  clipId: null,
  trackId: null,
  slug: null,
  parseErrors: [],
  lastOrigin: null,
  noteCount: 0,
}

/** Snapshot estable para useSyncExternalStore (mismo ref si no cambió). */
let cachedStatus: MidiClipMdSyncStatus = EMPTY_STATUS
let cachedStatusKey = 'empty'

function statusCacheKey(s: MidiClipMdSyncStatus): string {
  return [
    s.bound ? '1' : '0',
    s.clipId ?? '',
    s.trackId ?? '',
    s.slug ?? '',
    String(s.noteCount),
    s.lastOrigin ?? '',
    s.parseErrors.join('|'),
  ].join('\0')
}

function hashText(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

function dawFingerprint(
  clip: {
    id: string
    trackId: string
    nombre: string
    inicio: number
    duracion: number
    notas?: Array<{
      id: string
      pitch: number
      inicio: number
      duracion: number
      velocidad: number
      canal: number
      mute?: boolean
    }>
    expression?: unknown
  },
): string {
  const notes = [...(clip.notas ?? [])]
    .map(
      (n) =>
        `${n.id}:${n.pitch}:${n.inicio}:${n.duracion}:${n.velocidad}:${n.canal}:${n.mute ? 1 : 0}`,
    )
    .sort()
    .join('|')
  return hashText(
    `${clip.id}|${clip.trackId}|${clip.nombre}|${clip.inicio}|${clip.duracion}|${notes}|${JSON.stringify(clip.expression ?? null)}`,
  )
}

function emitStatus(): void {
  for (const l of statusListeners) l()
}

export function subscribeMidiClipMdSync(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function getMidiClipMdSyncStatus(): MidiClipMdSyncStatus {
  let next: MidiClipMdSyncStatus
  if (!session) {
    next = preferred
      ? {
          bound: false,
          clipId: preferred.clipId,
          trackId: preferred.trackId,
          slug: midiClipDocSlug(preferred.clipId),
          parseErrors: [],
          lastOrigin: null,
          noteCount: 0,
        }
      : EMPTY_STATUS
  } else {
    const ref = findMidiClip(session.tienda.obtenerEstado(), session.clipId, session.trackId)
    next = {
      bound: true,
      clipId: session.clipId,
      trackId: session.trackId,
      slug: session.slug,
      parseErrors: session.parseErrors,
      lastOrigin: session.lastOrigin,
      noteCount: ref?.clip.notas?.length ?? 0,
    }
  }
  const key = statusCacheKey(next)
  if (key === cachedStatusKey) return cachedStatus
  cachedStatusKey = key
  cachedStatus = next
  return cachedStatus
}

export function getBoundMidiClip(): MidiClipMdBound | null {
  if (!session) return null
  return {
    projectId: session.projectId,
    clipId: session.clipId,
    trackId: session.trackId,
    slug: session.slug,
  }
}

export function getPreferredMidiClipMd(): { clipId: string; trackId: string } | null {
  return preferred
}

export function setPreferredMidiClipMd(clipId: string, trackId: string): void {
  preferred = { clipId, trackId }
  emitStatus()
}

function serializeFromDaw(tienda: TiendaDAW, clipId: string, trackId: string): string | null {
  const st = tienda.obtenerEstado()
  const ref = findMidiClip(st, clipId, trackId)
  if (!ref) return null
  const track = st.project.tracks.find((t) => t.id === ref.trackId)
  return serializeMidiClipMd(ref.clip, {
    bpm: st.project.bpm?.valor,
    compas: `${st.project.timeSignature?.numerador ?? 4}/${st.project.timeSignature?.denominador ?? 4}`,
    trackName: track?.nombre,
  })
}

/** Crea o sobrescribe el .md desde el estado actual del clip (baseline DAW). */
export function ensureMidiClipDoc(
  tienda: TiendaDAW,
  clipId: string,
  trackId: string,
): { slug: string; markdown: string } | null {
  const md = serializeFromDaw(tienda, clipId, trackId)
  if (!md) return null
  const st = tienda.obtenerEstado()
  const projectId = st.project.id
  const slug = midiClipDocSlug(clipId)
  const ref = findMidiClip(st, clipId, trackId)
  writeAgentDoc(projectId, slug, md, {
    origin: 'system',
    title: `Clip · ${ref?.clip.nombre ?? clipId}`,
    preserveUserNotes: false,
  })
  return { slug, markdown: md }
}

function pushDawToMd(s: Session): void {
  if (s.applyingFromMd) return
  const md = serializeFromDaw(s.tienda, s.clipId, s.trackId)
  if (!md) return
  const ref = findMidiClip(s.tienda.obtenerEstado(), s.clipId, s.trackId)
  if (!ref) return
  const fp = dawFingerprint(ref.clip)
  if (fp === s.lastDawFp) return
  const h = hashText(md)
  if (h === s.lastMdHash) {
    s.lastDawFp = fp
    return
  }
  s.writingFromDaw = true
  try {
    writeAgentDoc(s.projectId, s.slug, md, {
      origin: 'system',
      title: `Clip · ${ref.clip.nombre}`,
      preserveUserNotes: false,
    })
    s.lastMdHash = h
    s.lastDawFp = fp
    s.lastOrigin = 'daw'
    s.parseErrors = []
  } finally {
    // Microtask: docs emit is sync; clear flag after listeners run
    queueMicrotask(() => {
      if (session === s) s.writingFromDaw = false
    })
  }
  emitStatus()
}

async function pushMdToDaw(s: Session): Promise<void> {
  if (s.writingFromDaw) return
  const doc = getAgentDoc(s.projectId, s.slug)
  const markdown = doc?.content ?? ''
  if (!markdown.trim()) return
  const h = hashText(markdown)
  if (h === s.lastMdHash) return

  const parsed = parseMidiClipMd(markdown)
  if (parsed.errors.length) {
    s.parseErrors = parsed.errors
    emitStatus()
    return
  }

  const clipId = parsed.meta.clipId || s.clipId
  const trackId = parsed.meta.trackId || s.trackId
  const existing = findMidiClip(s.tienda.obtenerEstado(), clipId, trackId)
  if (!existing) {
    s.parseErrors = [`Clip no encontrado: ${clipId}`]
    emitStatus()
    return
  }

  s.applyingFromMd = true
  s.parseErrors = []
  try {
    await s.tienda.executor.execute('midi.notes.set', {
      pistaId: trackId,
      clipId,
      notas: parsed.notas,
      duracion: parsed.meta.duracion > 0 ? parsed.meta.duracion : undefined,
    })
    s.lastMdHash = h
    s.lastDawFp = dawFingerprint(
      findMidiClip(s.tienda.obtenerEstado(), clipId, trackId)?.clip ?? existing.clip,
    )
    s.lastOrigin = 'md'
    if (clipId !== s.clipId || trackId !== s.trackId) {
      s.clipId = clipId
      s.trackId = trackId
      preferred = { clipId, trackId }
    }
  } finally {
    queueMicrotask(() => {
      if (session === s) s.applyingFromMd = false
    })
  }
  emitStatus()
}

function scheduleDawPush(s: Session): void {
  if (s.dawTimer) clearTimeout(s.dawTimer)
  s.dawTimer = setTimeout(() => {
    s.dawTimer = null
    if (session !== s) return
    pushDawToMd(s)
  }, DEBOUNCE_MS)
}

function scheduleMdPush(s: Session): void {
  if (s.mdTimer) clearTimeout(s.mdTimer)
  s.mdTimer = setTimeout(() => {
    s.mdTimer = null
    if (session !== s) return
    void pushMdToDaw(s)
  }, DEBOUNCE_MS)
}

export function unbindMidiClipMdSync(): void {
  if (!session) {
    emitStatus()
    return
  }
  const s = session
  session = null
  if (s.dawTimer) clearTimeout(s.dawTimer)
  if (s.mdTimer) clearTimeout(s.mdTimer)
  s.unsubDaw()
  s.unsubDocs()
  emitStatus()
}

/**
 * Activa sync clip ↔ doc. Re-serializa el .md desde DAW al bind (baseline).
 * Devuelve unsubscribe (también limpia preferred opcionalmente no).
 */
export function bindMidiClipMdSync(opts: {
  tienda: TiendaDAW
  clipId: string
  trackId: string
}): MidiClipMdBound | null {
  unbindMidiClipMdSync()

  const ensured = ensureMidiClipDoc(opts.tienda, opts.clipId, opts.trackId)
  if (!ensured) return null

  const st = opts.tienda.obtenerEstado()
  const projectId = st.project.id
  const ref = findMidiClip(st, opts.clipId, opts.trackId)
  if (!ref) return null

  preferred = { clipId: opts.clipId, trackId: opts.trackId }

  const s: Session = {
    tienda: opts.tienda,
    projectId,
    clipId: opts.clipId,
    trackId: opts.trackId,
    slug: ensured.slug,
    unsubDaw: () => {},
    unsubDocs: () => {},
    dawTimer: null,
    mdTimer: null,
    lastMdHash: hashText(ensured.markdown),
    lastDawFp: dawFingerprint(ref.clip),
    applyingFromMd: false,
    writingFromDaw: false,
    parseErrors: [],
    lastOrigin: 'daw',
  }

  s.unsubDaw = opts.tienda.suscribir(() => {
    if (session !== s || s.applyingFromMd) return
    scheduleDawPush(s)
  })

  s.unsubDocs = subscribeAgentDocs(() => {
    if (session !== s || s.writingFromDaw) return
    const doc = getAgentDoc(s.projectId, s.slug)
    if (!doc) return
    if (hashText(doc.content) === s.lastMdHash) return
    scheduleMdPush(s)
  })

  session = s
  emitStatus()
  return {
    projectId,
    clipId: opts.clipId,
    trackId: opts.trackId,
    slug: ensured.slug,
  }
}

/** Ensure + bind + remember preferred (llamar antes de abrir la tool). */
export function openMidiClipMdSync(
  tienda: TiendaDAW,
  clipId: string,
  trackId: string,
): MidiClipMdBound | null {
  setPreferredMidiClipMd(clipId, trackId)
  return bindMidiClipMdSync({ tienda, clipId, trackId })
}
