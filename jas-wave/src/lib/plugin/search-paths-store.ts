/**
 * Persistencia de carpetas de escaneo VST (localStorage).
 */

import {
  defaultVst3SearchPaths,
  pluginSearchPaths,
  type PluginSearchPath,
} from './search-paths'

const STORAGE_KEY = 'jaswave.pluginSearchPaths.v1'

function detectPlatform(): string {
  if (typeof process !== 'undefined' && process.platform) return process.platform
  if (typeof navigator !== 'undefined') {
    if (/Mac/i.test(navigator.userAgent)) return 'darwin'
    if (/Linux/i.test(navigator.userAgent)) return 'linux'
  }
  return 'win32'
}

function readStored(): PluginSearchPath[] | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter(
      (p): p is PluginSearchPath =>
        !!p &&
        typeof p === 'object' &&
        typeof (p as PluginSearchPath).id === 'string' &&
        typeof (p as PluginSearchPath).path === 'string',
    )
  } catch {
    return null
  }
}

/** Mezcla defaults + customs guardados y aplica al singleton. */
export function hydratePluginSearchPaths(): PluginSearchPath[] {
  const defaults = defaultVst3SearchPaths(detectPlatform())
  const stored = readStored()
  if (!stored?.length) {
    pluginSearchPaths.replaceAll(defaults)
    return pluginSearchPaths.list()
  }

  const customs = stored.filter((p) => p.kind === 'custom' && p.path.trim())
  const standards = defaults.map((d) => {
    const prev = stored.find((s) => s.id === d.id)
    return prev ? { ...d, enabled: prev.enabled !== false } : d
  })
  pluginSearchPaths.replaceAll([...standards, ...customs])
  return pluginSearchPaths.list()
}

export function persistPluginSearchPaths(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pluginSearchPaths.list()))
  } catch {
    /* quota / private mode */
  }
}

/** Añade carpeta custom y persiste. Devuelve null si ya existía. */
export function addCustomScanFolder(folderPath: string): PluginSearchPath | null {
  hydratePluginSearchPaths()
  const entry = pluginSearchPaths.addCustom(folderPath)
  if (!entry) return null
  persistPluginSearchPaths()
  return entry
}

export function removeCustomScanFolder(id: string): void {
  hydratePluginSearchPaths()
  pluginSearchPaths.remove(id)
  persistPluginSearchPaths()
}

export function setScanFolderEnabled(id: string, enabled: boolean): void {
  hydratePluginSearchPaths()
  pluginSearchPaths.setEnabled(id, enabled)
  persistPluginSearchPaths()
}

export function listScanFolders(): PluginSearchPath[] {
  hydratePluginSearchPaths()
  return pluginSearchPaths.list()
}

// Hydrate al cargar el módulo en el renderer
if (typeof window !== 'undefined') {
  hydratePluginSearchPaths()
}
