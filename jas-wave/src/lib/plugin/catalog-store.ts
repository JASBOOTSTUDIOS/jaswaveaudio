/**
 * Catálogo de plugins descubiertos (persistido) — distinto del load VST3.
 */

import { pluginRegistry } from './registry'
import type { PluginDescriptor } from './types'

const STORAGE_KEY = 'jaswave.pluginCatalog.v1'

function read(): PluginDescriptor[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p): p is PluginDescriptor =>
        !!p && typeof p === 'object' && typeof (p as PluginDescriptor).pluginId === 'string',
    )
  } catch {
    return []
  }
}

export function persistPluginCatalog(extra?: PluginDescriptor[]): void {
  if (typeof localStorage === 'undefined') return
  const fromRegistry = pluginRegistry
    .list()
    .filter((p) => p.format === 'vst3' || p.format === 'clap' || p.format === 'au' || p.format === 'lv2')
  const merged = new Map<string, PluginDescriptor>()
  for (const p of [...fromRegistry, ...(extra ?? [])]) merged.set(p.pluginId, p)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...merged.values()]))
  } catch {
    /* quota */
  }
}

/** Restaura VST descubiertos previamente en el registry. */
export function hydratePluginCatalog(): PluginDescriptor[] {
  const list = read()
  for (const p of list) pluginRegistry.register(p)
  return list
}

export function clearPluginCatalog(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}
