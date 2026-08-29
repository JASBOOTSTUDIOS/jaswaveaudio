/**
 * Gate de recursos del proyecto: host, device, VSTs y buffers de audio.
 * Evita Play / acciones de agente mientras aún se cargan recursos.
 */

export type ProjectReadyPhase =
  | 'booting'
  | 'host'
  | 'device'
  | 'plugins'
  | 'buffers'
  | 'ready'
  | 'degraded'

export type ProjectReadySnapshot = {
  generation: number
  phase: ProjectReadyPhase
  /** true = se puede interactuar (ready o degraded) */
  ready: boolean
  /** true = bloquear Play / mutaciones fuertes */
  blocking: boolean
  hostOk: boolean
  deviceArmed: boolean
  pluginsSettled: boolean
  buffersSettled: boolean
  /** 0–1 progreso real (host/device/plugins/buffers). */
  progress: number
  pluginDone: number
  pluginTotal: number
  label: string
  detail?: string
  errors: string[]
  startedAt: number
  settledAt?: number
}

type Listener = (snap: ProjectReadySnapshot) => void

const FAILSAFE_MS = 22_000

let generation = 0
let hostOk = false
let deviceArmed = false
let pluginsSettled = false
let buffersSettled = false
let pluginDone = 0
let pluginTotal = 0
let errors: string[] = []
let label = 'Preparando proyecto…'
let detail: string | undefined
let startedAt = Date.now()
let settledAt: number | undefined
let failsafeTimer: ReturnType<typeof setTimeout> | null = null
let forcedDegraded = false

const listeners = new Set<Listener>()

function phaseOf(): ProjectReadyPhase {
  if (forcedDegraded) return 'degraded'
  if (hostOk && deviceArmed && pluginsSettled && buffersSettled) return 'ready'
  if (!hostOk) return 'host'
  if (!deviceArmed) return 'device'
  if (!pluginsSettled) return 'plugins'
  if (!buffersSettled) return 'buffers'
  return 'booting'
}

function labelOf(phase: ProjectReadyPhase): string {
  switch (phase) {
    case 'host':
      return 'Arrancando Plugin Host…'
    case 'device':
      return 'Armando salida de audio…'
    case 'plugins':
      return pluginTotal > 0
        ? `Cargando plugins ${pluginDone}/${pluginTotal}…`
        : 'Cargando instrumentos / FX…'
    case 'buffers':
      return 'Cargando buffers de audio…'
    case 'ready':
      return 'Proyecto listo'
    case 'degraded':
      return 'Listo con advertencias'
    default:
      return 'Preparando proyecto…'
  }
}

function progressOf(phase: ProjectReadyPhase): number {
  if (phase === 'ready' || phase === 'degraded') return 1
  let p = 0
  if (hostOk) p += 0.15
  if (deviceArmed) p += 0.15
  if (pluginsSettled) {
    p += 0.5
  } else if (pluginTotal > 0) {
    p += 0.5 * Math.min(1, pluginDone / pluginTotal)
  }
  if (buffersSettled) p += 0.2
  return Math.min(0.99, Math.max(0, p))
}

function snapshot(): ProjectReadySnapshot {
  const phase = phaseOf()
  const fullyReady = phase === 'ready'
  const degraded = phase === 'degraded'
  return {
    generation,
    phase,
    ready: fullyReady || degraded,
    blocking: !fullyReady && !degraded,
    hostOk,
    deviceArmed,
    pluginsSettled,
    buffersSettled,
    progress: progressOf(phase),
    pluginDone,
    pluginTotal,
    label: label || labelOf(phase),
    detail,
    errors: [...errors],
    startedAt,
    settledAt,
  }
}

function emit() {
  const snap = snapshot()
  for (const fn of listeners) {
    try {
      fn(snap)
    } catch {
      /* ignore */
    }
  }
}

function clearFailsafe() {
  if (failsafeTimer) {
    clearTimeout(failsafeTimer)
    failsafeTimer = null
  }
}

function armFailsafe() {
  clearFailsafe()
  failsafeTimer = setTimeout(() => {
    if (snapshot().blocking) {
      forcedDegraded = true
      if (!pluginsSettled) pluginsSettled = true
      if (!buffersSettled) buffersSettled = true
      pluginDone = Math.max(pluginDone, pluginTotal)
      if (!errors.includes('timeout')) {
        errors.push('Timeout cargando recursos — se permite uso en modo degradado')
      }
      label = 'Listo con advertencias'
      detail = 'Algunos recursos no terminaron a tiempo'
      settledAt = Date.now()
      emit()
    }
  }, FAILSAFE_MS)
}

function recompute() {
  const phase = phaseOf()
  label = labelOf(phase)
  if (phase === 'ready' || phase === 'degraded') {
    if (!settledAt) settledAt = Date.now()
    clearFailsafe()
  }
  emit()
}

/**
 * Nuevo ciclo (project.new / load).
 * Si host+device ya están OK (cambio de proyecto), no los reinicia —
 * bootstrap solo reporta una vez al montar.
 */
export function beginProjectResourceLoad(reason = 'project'): number {
  generation += 1
  const keepHost = hostOk && deviceArmed
  if (!keepHost) {
    hostOk = false
    deviceArmed = false
  }
  pluginsSettled = false
  buffersSettled = false
  pluginDone = 0
  pluginTotal = 0
  errors = []
  forcedDegraded = false
  settledAt = undefined
  startedAt = Date.now()
  label = 'Preparando proyecto…'
  detail = reason
  armFailsafe()
  emit()
  return generation
}

export function reportProjectHost(ok: boolean, message?: string, gen?: number) {
  if (gen != null && gen !== generation) return
  hostOk = ok
  if (!ok && message) errors.push(message)
  if (ok) detail = message || 'Plugin Host listo'
  // Sin host Electron: web-only
  if (!ok && message === 'no-electron') {
    hostOk = true
    deviceArmed = true
  }
  recompute()
}

export function reportProjectDevice(armed: boolean, message?: string, gen?: number) {
  if (gen != null && gen !== generation) return
  deviceArmed = armed
  if (!armed && message) errors.push(message)
  if (armed) detail = message || 'Audio armado'
  recompute()
}

/** Progreso real de carga VST (done/total) — se llama por cada plugin. */
export function reportProjectPluginProgress(
  done: number,
  total: number,
  currentName?: string,
  gen?: number,
) {
  if (gen != null && gen !== generation) return
  pluginTotal = Math.max(0, total)
  pluginDone = Math.max(0, Math.min(done, pluginTotal || done))
  pluginsSettled = false
  settledAt = undefined
  label = labelOf('plugins')
  detail = currentName
    ? `${currentName} (${pluginDone}/${Math.max(pluginTotal, 1)})`
    : pluginTotal > 0
      ? `${pluginDone}/${pluginTotal}`
      : undefined
  emit()
}

export function reportProjectPluginsSettled(ok: boolean, message?: string, gen?: number) {
  if (gen != null && gen !== generation) return
  pluginsSettled = true
  if (pluginTotal > 0) pluginDone = pluginTotal
  if (!ok && message) errors.push(message)
  if (ok) detail = message || 'Plugins listos'
  recompute()
}

export function reportProjectBuffersSettled(ok = true, message?: string, gen?: number) {
  if (gen != null && gen !== generation) return
  buffersSettled = true
  if (!ok && message) errors.push(message)
  if (ok) detail = message || 'Buffers listos'
  recompute()
}

/** Proyecto vacío / solo Soft Pad sin WAV: no hay buffers que esperar. */
export function markProjectBuffersNotNeeded(gen?: number) {
  reportProjectBuffersSettled(true, 'Sin clips de audio que cargar', gen)
}

/** Sin VSTs que cargar. */
export function markProjectPluginsNotNeeded(gen?: number) {
  pluginDone = 0
  pluginTotal = 0
  reportProjectPluginsSettled(true, 'Sin VST que cargar', gen)
}

/** Reabrir fase plugins (insert VST / musicBuild). */
export function invalidateProjectPlugins(reason = 'plugins-changed') {
  pluginsSettled = false
  pluginDone = 0
  pluginTotal = 0
  settledAt = undefined
  if (forcedDegraded) forcedDegraded = false
  label = 'Cargando instrumentos / FX…'
  detail = reason
  armFailsafe()
  emit()
}

/** Reabrir fase buffers (import audio). */
export function invalidateProjectBuffers(reason = 'buffers-changed') {
  buffersSettled = false
  settledAt = undefined
  if (forcedDegraded) forcedDegraded = false
  label = 'Cargando buffers de audio…'
  detail = reason
  armFailsafe()
  emit()
}

export function getProjectReadySnapshot(): ProjectReadySnapshot {
  return snapshot()
}

export function subscribeProjectReady(fn: Listener): () => void {
  listeners.add(fn)
  fn(snapshot())
  return () => listeners.delete(fn)
}

export function getProjectReadyGeneration(): number {
  return generation
}

/**
 * Espera a que el proyecto deje de bloquear.
 * allowDegraded: true → acepta modo degradado / timeout.
 */
export async function waitUntilProjectReady(opts?: {
  timeoutMs?: number
  allowDegraded?: boolean
  signal?: AbortSignal
}): Promise<ProjectReadySnapshot> {
  const timeoutMs = opts?.timeoutMs ?? 18_000
  const allowDegraded = opts?.allowDegraded !== false
  const t0 = Date.now()

  const okNow = () => {
    const s = snapshot()
    if (s.phase === 'ready') return true
    if (allowDegraded && s.phase === 'degraded') return true
    if (!s.blocking) return true
    return false
  }

  if (okNow()) return snapshot()

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (s: ProjectReadySnapshot) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsub()
      opts?.signal?.removeEventListener('abort', onAbort)
      resolve(s)
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsub()
      reject(new Error('waitUntilProjectReady aborted'))
    }
    const unsub = subscribeProjectReady((s) => {
      if (okNow()) finish(s)
    })
    const timer = setTimeout(() => {
      // Forzar degradado local para no colgar Play/CLI
      if (snapshot().blocking) {
        forcedDegraded = true
        pluginsSettled = true
        buffersSettled = true
        errors.push('waitUntilProjectReady timeout')
        recompute()
      }
      finish(snapshot())
    }, timeoutMs)
    opts?.signal?.addEventListener('abort', onAbort)
    void t0
  })
}

/** Acciones de agente que requieren recursos cargados. */
export function actionRequiresProjectReady(type: string): boolean {
  if (type.startsWith('analysis.')) return false
  if (type === 'audio.listDevices' || type === 'audio.getDevice') return false
  if (type === 'project.new' || type === 'project.load') return false
  if (type.startsWith('transport.')) return true
  if (type.startsWith('daw.')) return true
  if (type.startsWith('plugin.')) return true
  if (type.startsWith('midi.')) return true
  if (type.startsWith('clip.') || type.startsWith('track.')) return true
  if (type === 'audio.armNative' || type === 'audio.ensureBest' || type === 'audio.setDevice') {
    return false // ellas mismas preparan el device
  }
  return false
}
