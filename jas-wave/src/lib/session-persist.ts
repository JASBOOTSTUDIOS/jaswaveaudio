/**
 * Autosave de sesión: meta (proyecto/UI) y audio en claves IndexedDB separadas
 * para que el arranque no se congele leyendo buffers grandes.
 */

import type { DAWState } from '../../../shared/src/types/state'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { audioEngine } from '@/lib/audio-engine'
import { markProjectBuffersNotNeeded, reportProjectBuffersSettled } from '@/src/lib/project-ready'
import { migrateSoftPadPluginsInProject } from '@/src/lib/plugin/migrate-softpad-to-roles'

const DB_NAME = 'jaswave-session-v1'
const STORE = 'snapshots'
const KEY_LEGACY = 'current'
const KEY_META = 'current-meta'
const KEY_AUDIO = 'current-audio'
const VERSION = 1

/** Tiempo máx. para leer meta / legacy antes de abandonar y arrancar vacío. */
const LOAD_META_TIMEOUT_MS = 6_000
const LOAD_AUDIO_TIMEOUT_MS = 45_000

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

type SessionMeta = Omit<SessionSnapshot, 'audio'>

type SessionAudioBlob = {
  version: typeof VERSION
  savedAt: number
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
  skipAudio?: boolean
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), ms)
    promise
      .then((v) => {
        clearTimeout(t)
        resolve(v)
      })
      .catch(() => {
        clearTimeout(t)
        resolve('timeout')
      })
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

async function idbPutKey(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'))
    })
  } finally {
    db.close()
  }
}

async function idbGetKey<T>(key: string): Promise<T | null> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'))
    })
  } finally {
    db.close()
  }
}

async function idbDeleteKeys(keys: string[]): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const k of keys) store.delete(k)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
    })
  } finally {
    db.close()
  }
}

function toMeta(snap: SessionSnapshot | SessionMeta): SessionMeta {
  return {
    version: VERSION,
    savedAt: snap.savedAt,
    project: snap.project,
    transport: snap.transport,
    ui: snap.ui,
    selection: snap.selection,
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
let pendingForcePluginSnapshot = false
/** Evita martillar getPluginState en cada mute/fader; el flush de salida fuerza. */
let lastVstSnapshotAt = 0
const VST_SNAPSHOT_MIN_MS = 12_000

export async function saveSessionNow(
  tienda: TiendaDAW,
  opts?: { forcePluginSnapshot?: boolean },
): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  if (opts?.forcePluginSnapshot) pendingForcePluginSnapshot = true
  if (saving) {
    pending = true
    return
  }
  saving = true
  try {
    const force = pendingForcePluginSnapshot
    pendingForcePluginSnapshot = false
    const now = Date.now()
    if (force || now - lastVstSnapshotAt >= VST_SNAPSHOT_MIN_MS) {
      try {
        const { snapshotLoadedPluginsIntoProject } = await import('./plugin/track-vst-runtime')
        await snapshotLoadedPluginsIntoProject(tienda)
        lastVstSnapshotAt = Date.now()
      } catch (err) {
        console.warn('[session-persist] VST snapshot skipped', err)
      }
    }
    const snap = buildSnapshot(tienda.obtenerEstado())
    const meta = toMeta(snap)
    // Meta primero (arranque rápido); audio después
    await idbPutKey(KEY_META, meta)
    try {
      await idbPutKey(KEY_AUDIO, {
        version: VERSION,
        savedAt: snap.savedAt,
        audio: snap.audio,
      } satisfies SessionAudioBlob)
    } catch (audioErr) {
      console.warn('[session-persist] audio snapshot skipped', audioErr)
    }
    // Limpiar blob monolítico legacy si existía
    await idbDeleteKeys([KEY_LEGACY])
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

async function idbHasKey(key: string): Promise<boolean> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      // getKey evita deserializar el valor (crítico con blobs de audio enormes)
      if (typeof store.getKey === 'function') {
        const req = store.getKey(key)
        req.onsuccess = () => resolve(req.result !== undefined)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB getKey failed'))
      } else {
        const req = store.openKeyCursor(IDBKeyRange.only(key))
        req.onsuccess = () => resolve(!!req.result)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB cursor failed'))
      }
    })
  } finally {
    db.close()
  }
}

async function loadSessionMeta(): Promise<SessionMeta | null> {
  if (typeof indexedDB === 'undefined') return null

  const metaResult = await withTimeout(idbGetKey<SessionMeta>(KEY_META), LOAD_META_TIMEOUT_MS)
  if (metaResult !== 'timeout' && metaResult && metaResult.version === VERSION && metaResult.project) {
    return metaResult
  }

  // Nunca leer KEY_LEGACY en el arranque: el blob monolítico (proyecto+audio)
  // bloquea el hilo principal al deserializar y la UI se queda en 15%.
  try {
    if (await idbHasKey(KEY_LEGACY)) {
      console.warn(
        '[session-persist] Sesión legacy monolítica detectada; se elimina sin leerla para no congelar el arranque. El próximo guardado usará meta/audio separados.',
      )
      await idbDeleteKeys([KEY_LEGACY])
    }
  } catch (err) {
    console.warn('[session-persist] no se pudo limpiar legacy', err)
  }
  return null
}

async function loadSessionAudio(): Promise<Record<string, PersistedAudioBuffer>> {
  const audioResult = await withTimeout(
    idbGetKey<SessionAudioBlob>(KEY_AUDIO),
    LOAD_AUDIO_TIMEOUT_MS,
  )
  if (audioResult === 'timeout') {
    console.warn('[session-persist] audio timeout; UI sigue sin buffers')
    return {}
  }
  if (audioResult?.version === VERSION && audioResult.audio) return audioResult.audio
  return {}
}

/** Carga meta+audio (compat). Preferir hydrateSession para arranque. */
export async function loadSessionSnapshot(): Promise<SessionSnapshot | null> {
  try {
    const meta = await loadSessionMeta()
    if (!meta) return null
    const audio = await loadSessionAudio()
    return { ...meta, audio }
  } catch (err) {
    console.warn('[session-persist] load failed', err)
    return null
  }
}

export async function clearSessionSnapshot(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    await idbDeleteKeys([KEY_LEGACY, KEY_META, KEY_AUDIO])
  } catch (err) {
    console.warn('[session-persist] clear failed', err)
  }
}

export function applySessionProject(tienda: TiendaDAW, snap: SessionMeta | SessionSnapshot): void {
  const project = snap.project
  try {
    migrateSoftPadPluginsInProject(project)
  } catch (err) {
    console.warn('[session-persist] softpad→roles migrate skipped', err)
  }
  tienda.establecerEstado((s) => ({
    ...s,
    project,
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
  const batch = 1
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
    // Ceder al event loop entre buffers grandes
    await new Promise((r) => setTimeout(r, 0))
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
    if (tienda.obtenerEstado().transport?.reproduciendo) return
    scheduleSessionSave(tienda)
  })

  const flush = () => {
    void saveSessionNow(tienda, { forcePluginSnapshot: true })
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
 * Hidrata sesión: meta primero (UI lista), audio en background.
 * Si la sesión legacy es enorme, timeout → arranque vacío (no se queda en 15%).
 */
export async function hydrateSession(
  tienda: TiendaDAW,
  options: HydrateOptions = {},
): Promise<boolean> {
  const { onProgress, skipAudio = false, audioBackground = true } = options
  report(onProgress, 'db', 'Abriendo almacenamiento…', 0.05)
  await yieldUi()

  report(onProgress, 'snapshot', 'Leyendo sesión guardada…', 0.15)
  await yieldUi()

  let meta: SessionMeta | null = null
  try {
    meta = await loadSessionMeta()
  } catch (err) {
    console.warn('[session-persist] meta load failed', err)
  }

  if (!meta) {
    report(onProgress, 'empty', 'Sin sesión previa', 1)
    return false
  }

  report(
    onProgress,
    'project',
    'Restaurando proyecto…',
    0.45,
    `${meta.project?.tracks?.length ?? 0} pistas`,
  )
  await yieldUi()
  applySessionProject(tienda, meta)

  if (skipAudio) {
    report(onProgress, 'done', 'Listo', 1)
    markProjectBuffersNotNeeded()
    return true
  }

  // UI puede mostrarse ya; audio no bloquea ready
  if (audioBackground) {
    report(onProgress, 'done', 'Interfaz lista · audio en segundo plano…', 0.85)
    void (async () => {
      try {
        report(onProgress, 'audio', 'Cargando audio guardado…', 0.55)
        const audio = await loadSessionAudio()
        const n = Object.keys(audio).length
        if (n === 0) {
          report(onProgress, 'done', 'Sesión lista', 1)
          markProjectBuffersNotNeeded()
          return
        }
        await restoreAudioChunked(audio, onProgress)
        report(onProgress, 'done', 'Sesión completa', 1)
        reportProjectBuffersSettled(true, 'Sesión audio restaurada')
      } catch (err) {
        console.warn('[session-persist] background audio failed', err)
        report(onProgress, 'done', 'Interfaz lista (audio incompleto)', 1)
        reportProjectBuffersSettled(false, 'Audio de sesión incompleto')
      }
    })()
    return true
  }

  report(onProgress, 'audio', 'Cargando audio guardado…', 0.55)
  const audio = await loadSessionAudio()
  await restoreAudioChunked(audio, onProgress)
  report(onProgress, 'done', 'Sesión restaurada', 1)
  reportProjectBuffersSettled(true, 'Sesión audio restaurada')
  return true
}
