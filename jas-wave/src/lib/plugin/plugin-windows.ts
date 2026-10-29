/**
 * Ventanas de editor de plugin (varias a la vez).
 *
 * Cada plugin se abre en su propia ventana nativa del host (misma instancia que el audio), con el nombre del
 * plugin y la pista en el título y colocada en cascada. La lista se sincroniza con el host cada segundo: si
 * el usuario cierra una ventana con la X, desaparece también de la barra. El panel acoplable `plugin-editor`
 * sigue existiendo para quien quiera un editor dentro del workspace.
 */

import type { PluginInfo } from '../../../../shared/src/types/entidades'
import type { TiendaDAW } from '../../../../shared/src/state/tienda'
import { ensureTrackVstInstrument, getLastVstLoadError, olvidarFalloVst, resolveHostPluginPath, slotIdForTrackPlugin, snapshotTrackPluginIntoProject } from './track-vst-runtime'

export type PluginWindow = {
  slotId: string
  trackId: string
  pluginId: string
  name: string
  trackName: string
  openedAt: number
}

type Listener = () => void
let windows: PluginWindow[] = []
const listeners = new Set<Listener>()
let timer: ReturnType<typeof setInterval> | null = null
let snapshot: readonly PluginWindow[] = []

function emit() {
  snapshot = windows.slice()
  for (const l of listeners) l()
}

export function getPluginWindows(): readonly PluginWindow[] {
  return snapshot
}

export function subscribePluginWindows(l: Listener): () => void {
  listeners.add(l)
  startSync()
  return () => {
    listeners.delete(l)
    if (listeners.size === 0) stopSync()
  }
}

function send(cmd: Record<string, unknown>): Promise<unknown> {
  const api = typeof window !== 'undefined' ? window.electron : undefined
  if (!api?.pluginHostSend) return Promise.resolve(null)
  return api.pluginHostSend(cmd).catch(() => null)
}

async function syncWithHost() {
  if (windows.length === 0) return
  const r = (await send({ type: 'getOpenEditors' })) as { ok?: boolean; editors?: Array<{ slot: string }> } | null
  if (!r || r.ok === false || !Array.isArray(r.editors)) return
  const open = new Set(r.editors.map((e) => e.slot))
  const now = Date.now()
  const keep = windows.filter((w) => open.has(w.slotId) || now - w.openedAt < 4000)
  if (keep.length !== windows.length) {
    // El usuario cerró la ventana con la X del propio editor (no con la barra del DAW): el slot sigue
    // cargado en el host con el estado vivo; se captura ahora para no depender del siguiente autoguardado.
    const cerradas = windows.filter((w) => !keep.includes(w))
    windows = keep
    emit()
    for (const w of cerradas) void alCerrarEditor?.(w)
  }
}

let alCerrarEditor: ((w: PluginWindow) => Promise<unknown> | void) | null = null

/** Registra la captura de estado al cerrarse un editor (la tienda la aporta el autoguardado de VST). */
export function registrarCapturaAlCerrarEditor(fn: ((w: PluginWindow) => Promise<unknown> | void) | null): void {
  alCerrarEditor = fn
}

function startSync() {
  if (timer || typeof window === 'undefined') return
  timer = setInterval(() => void syncWithHost(), 1000)
}
function stopSync() {
  if (timer) clearInterval(timer)
  timer = null
}

export type OpenWindowResult = { ok: true } | { ok: false; message: string }

/** Abre (o trae al frente) la ventana del editor de un plugin sin cerrar las demás. */
export async function openPluginWindow(args: {
  trackId: string
  plugin: PluginInfo
  trackName?: string
}): Promise<OpenWindowResult> {
  const { trackId, plugin } = args
  const path = resolveHostPluginPath(plugin)
  if (!path) return { ok: false, message: 'Este plugin no tiene ruta .vst3/.dll. Vuelve a insertarlo desde el catálogo.' }
  const slotId = slotIdForTrackPlugin(trackId, plugin.id)
  // Abrirlo es una orden explícita del usuario: un fallo reciente (o una cuarentena ya levantada) no la bloquea.
  olvidarFalloVst(path)
  const loaded = await ensureTrackVstInstrument(trackId, { ...plugin, descripcion: path })
  if (!loaded) return { ok: false, message: getLastVstLoadError() || 'No se pudo cargar el plugin en el host.' }
  const trackName = args.trackName ?? ''
  const title = trackName ? `${plugin.nombre} · ${trackName}` : plugin.nombre
  const reply = (await send({ type: 'openEditor', path, slotId, pluginId: plugin.id, title })) as { ok?: boolean; message?: string } | null
  if (!reply || reply.ok === false) return { ok: false, message: reply?.message || 'No se pudo abrir el editor del plugin.' }
  if (!windows.some((w) => w.slotId === slotId)) {
    windows = [...windows, { slotId, trackId, pluginId: plugin.id, name: plugin.nombre, trackName, openedAt: Date.now() }]
  } else {
    windows = windows.map((w) => (w.slotId === slotId ? { ...w, openedAt: Date.now() } : w))
  }
  emit()
  return { ok: true }
}

/** Cierra la ventana de un plugin (guardando antes su estado en el proyecto si se pasa la tienda). */
export async function closePluginWindow(slotId: string, tienda?: TiendaDAW): Promise<void> {
  const w = windows.find((x) => x.slotId === slotId)
  if (w && tienda) {
    try {
      await snapshotTrackPluginIntoProject(tienda, w.trackId, w.pluginId)
    } catch {
      /* el cierre no debe depender del guardado */
    }
  }
  await send({ type: 'closeEditor', slotId })
  windows = windows.filter((x) => x.slotId !== slotId)
  emit()
}

export async function closeAllPluginWindows(tienda?: TiendaDAW): Promise<void> {
  for (const w of windows.slice()) await closePluginWindow(w.slotId, tienda)
}
