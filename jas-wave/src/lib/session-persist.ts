/**
 * Autosave de sesión contra reload: proyecto + UI + buffers de audio en IndexedDB.
 */

import type { DAWState } from '../../../shared/src/types/state'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { audioEngine } from '@/lib/audio-engine'

const DB_NAME = 'jaswave-session-v1'
const STORE = 'snapshots'
const KEY = 'current'
const VERSION = 1

export type PersistedAudioBuffer = {
  sampleRate: number
  length: number
  numberOfChannels: number
  channels: ArrayBuffer[]
}

export type SessionSnapshot = {
  version: typeof VERSION
  savedAt: number
  project: DAWState['project']
  transport: DAWState['transport']
  ui: Pick<
    NonNullable<DAWState['ui']>,
    'zoomHorizontal' | 'zoomVertical' | 'scrollX' | 'herramientaActiva'
  >
  selection: DAWState['selection']
  audio: Record<string, PersistedAudioBuffer>
}

export type HydrateProgress = {
  phase: 'idle' | 'db' | 'snapshot' | 'project' | 'audio' | 'done' | 'empty'
  label: string
  /** 0..1 */
  progress: number
  detail?: string
}

export type HydrateOptions = {
  onProgress?: (p: HydrateProgress) => void
  /** Si true, no restaura buffers de audio (ventanas flotantes / arranque rápido). */
  skipAudio?: boolean
  /** Restaura audio en segundo plano tras aplicar el proyecto. */
  audioBackground?: boolean
}

function report(
  onProgress: HydrateOptions['onProgress'],
  phase: HydrateProgress['phase'],
  label: string,
  progress: number,
  detail?: string,
) {
  onProgress?.({ phase, label, progress: Math.max(0, Math.min(1, progress)), detail })
}

function yieldUi(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

async function idbPut(value: SessionSnapshot): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'))
    })
  } finally {
    db.close()
  }
}

async function idbGet(): Promise<SessionSnapshot | null> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve((req.result as SessionSnapshot | undefined) ?? null)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'))
    })
  } finally {
    db.close()
  }
}

async function idbClear(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear failed'))
    })
  } finally {
    db.close()
  }
}

function buildSnapshot(state: DAWState): SessionSnapshot {
  const ui = state.ui
  return {
    version: VERSION,
    savedAt: Date.now(),
    project: structuredClone(state.project),
    transport: structuredClone(state.transport),
    ui: {
      zoomHorizontal: ui?.zoomHorizontal ?? 1,
      zoomVertical: ui?.zoomVertical ?? 1,
      scrollX: ui?.scrollX ?? 0,
      herramientaActiva: ui?.herramientaActiva ?? 'select',
    },
    selection: structuredClone(state.selection),
    audio: audioEngine.exportAudioBuffersForPersist(),
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving = false
let pending = false

export async function saveSessionNow(tienda: TiendaDAW): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  if (saving) {
    pending = true
    return
  }
  saving = true
  try {
    const snap = buildSnapshot(tienda.obtenerEstado())
    await idbPut(snap)
  } catch (err) {
    console.warn('[session-persist] save failed', err)
  } finally {
    saving = false
    if (pending) {
      pending = false
      void saveSessionNow(tienda)
    }
  }
}

export function scheduleSessionSave(tienda: TiendaDAW, delayMs = 800): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveSessionNow(tienda)
  }, delayMs)
}

export async function loadSessionSnapshot(): Promise<SessionSnapshot | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const snap = await idbGet()
    if (!snap || snap.version !== VERSION || !snap.project) return null
    return snap
  } catch (err) {
    console.warn('[session-persist] load failed', err)
    return null
  }
}

export async function clearSessionSnapshot(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    await idbClear()
  } catch (err) {
    console.warn('[session-persist] clear failed', err)
  }
}

/** Aplica proyecto/UI/transporte sin audio. */
export function applySessionProject(tienda: TiendaDAW, snap: SessionSnapshot): void {
  tienda.establecerEstado((s) => ({
    ...s,
    project: snap.project,
    transport: {
      ...s.transport,
      ...snap.transport,
      reproduciendo: false,
      modo:
        snap.transport?.modo === 'record'
          ? 'stop'
          : snap.transport?.modo === 'pause'
            ? 'pause'
            : 'stop',
      grabacion: 'inactiva',
    },
    ui: {
      ...s.ui,
      zoomHorizontal: snap.ui.zoomHorizontal,
      zoomVertical: snap.ui.zoomVertical,
      scrollX: snap.ui.scrollX,
      herramientaActiva: snap.ui.herramientaActiva,
    },
    selection: snap.selection ?? s.selection,
  }))
}

async function restoreAudioChunked(
  audio: Record<string, PersistedAudioBuffer>,
  onProgress?: HydrateOptions['onProgress'],
): Promise<void> {
  const entries = Object.entries(audio)
  if (entries.length === 0) return
  const total = entries.length
  // Restaurar de a lotes para no congelar el hilo principal
  const batch = 2
  for (let i = 0; i < entries.length; i += batch) {
    const slice = entries.slice(i, i + batch)
    const partial: Record<string, PersistedAudioBuffer> = {}
    for (const [k, v] of slice) partial[k] = v
    try {
      audioEngine.restoreAudioBuffersFromPersist(partial)
    } catch (err) {
      console.warn('[session-persist] audio restore batch failed', err)
    }
    const done = Math.min(total, i + batch)
    report(
      onProgress,
      'audio',
      'Restaurando audio…',
      0.55 + (done / total) * 0.4,
      `${done} / ${total} buffers`,
    )
    await yieldUi()
  }
}

export function applySessionSnapshot(tienda: TiendaDAW, snap: SessionSnapshot): void {
  applySessionProject(tienda, snap)
  if (snap.audio && Object.keys(snap.audio).length > 0) {
    try {
      audioEngine.restoreAudioBuffersFromPersist(snap.audio)
    } catch (err) {
      console.warn('[session-persist] audio restore failed', err)
    }
  }
}

export function attachSessionAutosave(tienda: TiendaDAW): () => void {
  const unsub = tienda.suscribir(() => {
    // No serializar IndexedDB mientras suena (freeze por buffers grandes)
    if (tienda.obtenerEstado().transport?.reproduciendo) return
    scheduleSessionSave(tienda)
  })

  const flush = () => {
    void saveSessionNow(tienda)
  }
  window.addEventListener('beforeunload', flush)
  window.addEventListener('pagehide', flush)
  const onVis = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  document.addEventListener('visibilitychange', onVis)

  return () => {
    unsub()
    window.removeEventListener('beforeunload', flush)
    window.removeEventListener('pagehide', flush)
    document.removeEventListener('visibilitychange', onVis)
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    flush()
  }
}

/**
 * Hidrata sesión con progreso. Por defecto aplica proyecto ya y audio en background
 * para que la UI arranque rápido.
 */
export async function hydrateSession(
  tienda: TiendaDAW,
  options: HydrateOptions = {},
): Promise<boolean> {
  const { onProgress, skipAudio = false, audioBackground = true } = options
  report(onProgress, 'db', 'Abriendo almacenamiento…', 0.05)
  await yieldUi()

  report(onProgress, 'snapshot', 'Leyendo sesión guardada…', 0.15)
  const snap = await loadSessionSnapshot()
  if (!snap) {
    report(onProgress, 'empty', 'Sin sesión previa', 1)
    return false
  }

  const audioCount = snap.audio ? Object.keys(snap.audio).length : 0
  report(
    onProgress,
    'project',
    'Restaurando proyecto…',
    0.4,
    `${snap.project?.tracks?.length ?? 0} pistas`,
  )
  await yieldUi()
  applySessionProject(tienda, snap)

  if (skipAudio || audioCount === 0) {
    report(onProgress, 'done', 'Listo', 1)
    return true
  }

  if (audioBackground) {
    report(onProgress, 'done', 'Interfaz lista · audio en segundo plano…', 0.92, `${audioCount} buffers`)
    void restoreAudioChunked(snap.audio, onProgress).then(() => {
      report(onProgress, 'done', 'Sesión completa', 1)
    })
    return true
  }

  report(onProgress, 'audio', 'Restaurando audio…', 0.55, `0 / ${audioCount}`)
  await restoreAudioChunked(snap.audio, onProgress)
  report(onProgress, 'done', 'Sesión restaurada', 1)
  return true
}
