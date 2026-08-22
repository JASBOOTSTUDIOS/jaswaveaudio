/**
 * Plugin editor activo (panel workspace `plugin-editor`).
 * Persiste + BroadcastChannel para ventanas flotantes (undock).
 */

export type PluginEditorFocus = {
  trackId: string
  pluginId: string
  pluginName: string
  openedAt: number
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

/** Abre / enfoca el editor de un plugin en el workspace. */
export function openPluginEditor(args: {
  trackId: string
  pluginId: string
  pluginName: string
  zone?: 'left' | 'right' | 'bottom' | 'center'
}): void {
  setPluginEditorFocus({
    trackId: args.trackId,
    pluginId: args.pluginId,
    pluginName: args.pluginName,
    openedAt: Date.now(),
  })
  window.dispatchEvent(
    new CustomEvent('jaswave-open-tool', {
      detail: { toolId: 'plugin-editor', zone: args.zone ?? 'right' },
    }),
  )
}
