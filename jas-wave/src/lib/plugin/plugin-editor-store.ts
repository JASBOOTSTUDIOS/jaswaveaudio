/**
 * Plugin editor activo (panel workspace `plugin-editor`).
 * Persiste + BroadcastChannel para ventanas flotantes (undock).
 */

import type { PluginInfo } from '../../../../shared/src/types/entidades'

export type PluginEditorFocus = {
  trackId: string
  pluginId: string
  pluginName: string
  openedAt: number
  /** Si la pista no está en el proyecto (preview chat), usar este snapshot. */
  pluginSnapshot?: PluginInfo
}

type Listener = () => void

const STORAGE_KEY = 'jaswave.pluginEditorFocus.v1'
const CHANNEL = 'jaswave-plugin-editor-focus-v1'

function readStored(): PluginEditorFocus | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PluginEditorFocus
    if (!parsed?.trackId || !parsed?.pluginId) return null
    return parsed
  } catch {
    return null
  }
}

let focus: PluginEditorFocus | null = readStored()
const listeners = new Set<Listener>()

function persist(next: PluginEditorFocus | null) {
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.postMessage({ type: 'focus', focus: next })
    ch.close()
  } catch {
    /* ignore */
  }
}

function emit() {
  for (const l of listeners) l()
}

export function getPluginEditorFocus(): PluginEditorFocus | null {
  return focus
}

export function setPluginEditorFocus(next: PluginEditorFocus | null): void {
  focus = next
  persist(next)
  emit()
}

export function subscribePluginEditorFocus(listener: Listener): () => void {
  listeners.add(listener)
  let ch: BroadcastChannel | null = null
  try {
    ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = (ev) => {
      const data = ev.data as { type?: string; focus?: PluginEditorFocus | null }
      if (data?.type !== 'focus') return
      focus = data.focus ?? null
      listener()
    }
  } catch {
    /* ignore */
  }
  return () => {
    listeners.delete(listener)
    ch?.close()
  }
}

/**
 * Abre el editor de un plugin. Por defecto en su propia ventana (se pueden tener varios abiertos a la vez);
 * con `docked: true` usa el panel acoplable `plugin-editor` (un solo plugin, dentro del workspace).
 */
export function openPluginEditor(args: {
  trackId: string
  pluginId: string
  pluginName: string
  pluginSnapshot?: PluginInfo
  zone?: 'left' | 'right' | 'bottom' | 'center'
  docked?: boolean
}): void {
  if (!args.docked) {
    void abrirEnVentana(args)
    return
  }
  setPluginEditorFocus({
    trackId: args.trackId,
    pluginId: args.pluginId,
    pluginName: args.pluginName,
    pluginSnapshot: args.pluginSnapshot,
    openedAt: Date.now(),
  })
  window.dispatchEvent(
    new CustomEvent('jaswave-open-tool', {
      detail: { toolId: 'plugin-editor', zone: args.zone ?? 'right' },
    }),
  )
}

async function abrirEnVentana(args: { trackId: string; pluginId: string; pluginName: string; pluginSnapshot?: PluginInfo }): Promise<void> {
  const { openPluginWindow } = await import('./plugin-windows')
  const snap = args.pluginSnapshot ?? (await buscarPlugin(args.trackId, args.pluginId))
  if (!snap) return
  const r = await openPluginWindow({ trackId: args.trackId, plugin: snap, trackName: await nombrePista(args.trackId) })
  if (!r.ok) console.warn('[plugin-editor] no se pudo abrir la ventana:', r.message)
}

type EstadoMin = { project?: { tracks?: Array<{ id: string; nombre?: string; plugins?: PluginInfo[] }> } }
let obtenerEstado: (() => EstadoMin) | null = null
/** El árbol de React registra cómo leer el proyecto (para resolver el plugin y la pista al abrir su ventana). */
export function registrarLectorProyecto(fn: (() => EstadoMin) | null): void {
  obtenerEstado = fn
}
async function buscarPlugin(trackId: string, pluginId: string): Promise<PluginInfo | null> {
  const t = obtenerEstado?.().project?.tracks?.find((x) => x.id === trackId)
  return t?.plugins?.find((p) => p.id === pluginId) ?? null
}
async function nombrePista(trackId: string): Promise<string> {
  return obtenerEstado?.().project?.tracks?.find((x) => x.id === trackId)?.nombre ?? ''
}
