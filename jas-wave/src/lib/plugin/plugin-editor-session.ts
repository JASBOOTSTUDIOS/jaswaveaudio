/**
 * Sesión del panel Editor de plugin (qué instancia está abierta).
 */

import { requestOpenTool, type DockZone } from '@/src/workspace/types'

export type PluginEditorTarget = {
  trackId: string
  pluginId: string
}

const STORAGE_KEY = 'jaswave.pluginEditor.v1'
const CHANNEL = 'jaswave-plugin-editor-v1'

let target: PluginEditorTarget | null = readStored()
const listeners = new Set<() => void>()

function readStored(): PluginEditorTarget | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PluginEditorTarget
    if (!parsed?.trackId || !parsed?.pluginId) return null
    return parsed
  } catch {
    return null
  }
}

function notify() {
  for (const l of listeners) l()
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.postMessage({ type: 'target', target })
    ch.close()
  } catch {
    /* ignore */
  }
}

export function getPluginEditorTarget(): PluginEditorTarget | null {
  return target
}

export function setPluginEditorTarget(next: PluginEditorTarget | null): void {
  target = next
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  notify()
}

export function subscribePluginEditor(listener: () => void): () => void {
  listeners.add(listener)
  let ch: BroadcastChannel | null = null
  try {
    ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = (ev) => {
      const data = ev.data as { type?: string; target?: PluginEditorTarget | null }
      if (data?.type !== 'target') return
      target = data.target ?? null
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

/** Abre / enfoca el tab Editor de plugin para una instancia en pista. */
export function openPluginEditor(
  trackId: string,
  pluginId: string,
  options?: { zone?: DockZone },
): void {
  setPluginEditorTarget({ trackId, pluginId })
  requestOpenTool('plugin-editor', { zone: options?.zone ?? 'right' })
}
