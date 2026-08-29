/**
 * Biblioteca de presets VST del proyecto (estado real + metadatos).
 * Persistencia: localStorage por projectId; opcional sync a disco junto al .jaswave.
 * Presets globales viven en userData vía global-preset-catalog.ts.
 */

import type { PluginInfo } from '../../../../shared/src/types/entidades'

export type LibraryPresetScope = 'global' | 'project'
export type LibraryPresetType = 'plugin' | 'fxChain'

export type LibraryPreset = {
  id: string
  pluginId: string
  pluginNombre: string
  pluginPath?: string
  nombre: string
  rol?: string
  generoTags: string[]
  notas?: string
  estadoPluginBase64?: string
  parametros?: Array<{ id: string; nombre: string; valor: number }>
  /** Cadena FX serializada (type === 'fxChain'). */
  fxChainPlugins?: PluginInfo[]
  scope?: LibraryPresetScope
  type?: LibraryPresetType
  probedAt?: number
  probeOk?: boolean
  createdAt: number
  updatedAt: number
}

type CatalogFile = {
  version: 1
  presets: LibraryPreset[]
}

function storageKey(projectId: string): string {
  return `jaswave.projectLibrary.v1.${projectId || 'default'}`
}

function readLocal(projectId: string): LibraryPreset[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(projectId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as CatalogFile | LibraryPreset[]
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.presets)) return parsed.presets
    return []
  } catch {
    return []
  }
}

function writeLocal(projectId: string, presets: LibraryPreset[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload: CatalogFile = { version: 1, presets }
    localStorage.setItem(storageKey(projectId), JSON.stringify(payload))
  } catch {
    /* quota */
  }
}

async function syncToDisk(projectRuta: string | undefined, presets: LibraryPreset[]): Promise<void> {
  if (!projectRuta || typeof window === 'undefined' || !window.electron?.fileSave) return
  try {
    const dir = projectRuta.replace(/[/\\][^/\\]+$/, '')
    const path = `${dir}/library/instruments.json`
    await window.electron.fileSave(path, JSON.stringify({ version: 1, presets }, null, 2))
  } catch {
    /* optional */
  }
}

export function listLibraryPresets(projectId: string): LibraryPreset[] {
  return readLocal(projectId).slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getLibraryPreset(projectId: string, presetId: string): LibraryPreset | undefined {
  return readLocal(projectId).find((p) => p.id === presetId)
}

export function searchLibraryPresets(
  projectId: string,
  opts?: { query?: string; rol?: string; genero?: string },
): LibraryPreset[] {
  const q = (opts?.query ?? '').toLowerCase().trim()
  const rol = (opts?.rol ?? '').toLowerCase().trim()
  const genero = (opts?.genero ?? '').toLowerCase().trim()
  return listLibraryPresets(projectId).filter((p) => {
    if (rol && (p.rol ?? '').toLowerCase() !== rol) return false
    if (genero && !p.generoTags.some((t) => t.toLowerCase().includes(genero))) return false
    if (!q) return true
    const hay = `${p.nombre} ${p.pluginNombre} ${p.rol ?? ''} ${p.notas ?? ''} ${p.generoTags.join(' ')}`.toLowerCase()
    return hay.includes(q)
  })
}

export async function saveLibraryPreset(
  projectId: string,
  preset: Omit<LibraryPreset, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  projectRuta?: string,
): Promise<LibraryPreset> {
  const now = Date.now()
  const list = readLocal(projectId)
  const id = preset.id ?? `preset-${now.toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`
  const existing = list.findIndex((p) => p.id === id)
  const next: LibraryPreset = {
    id,
    pluginId: preset.pluginId,
    pluginNombre: preset.pluginNombre,
    pluginPath: preset.pluginPath,
    nombre: preset.nombre,
    rol: preset.rol,
    generoTags: preset.generoTags ?? [],
    notas: preset.notas,
    estadoPluginBase64: preset.estadoPluginBase64,
    parametros: preset.parametros,
    fxChainPlugins: preset.fxChainPlugins,
    scope: preset.scope ?? 'project',
    type: preset.type ?? 'plugin',
    probedAt: preset.probedAt,
    probeOk: preset.probeOk,
    createdAt: existing >= 0 ? list[existing]!.createdAt : now,
    updatedAt: now,
  }
  if (existing >= 0) list[existing] = next
  else list.push(next)
  writeLocal(projectId, list)
  await syncToDisk(projectRuta, list)
  return next
}

export async function updateLibraryPresetMeta(
  projectId: string,
  presetId: string,
  patch: Partial<Pick<LibraryPreset, 'nombre' | 'rol' | 'generoTags' | 'notas' | 'probeOk' | 'probedAt'>>,
  projectRuta?: string,
): Promise<LibraryPreset | null> {
  const list = readLocal(projectId)
  const i = list.findIndex((p) => p.id === presetId)
  if (i < 0) return null
  const next = { ...list[i]!, ...patch, updatedAt: Date.now() }
  list[i] = next
  writeLocal(projectId, list)
  await syncToDisk(projectRuta, list)
  return next
}

export async function deleteLibraryPreset(
  projectId: string,
  presetId: string,
  projectRuta?: string,
): Promise<boolean> {
  const before = readLocal(projectId)
  const list = before.filter((p) => p.id !== presetId)
  const changed = list.length !== before.length
  writeLocal(projectId, list)
  if (changed) await syncToDisk(projectRuta, list)
  return changed
}

function projectLibraryPath(projectRuta: string): string {
  const dir = projectRuta.replace(/[/\\][^/\\]+$/, '')
  return `${dir}/library/instruments.json`
}

/** Carga presets del disco al abrir un .jaswave (merge por id, disco gana si más reciente). */
export async function loadLibraryFromDisk(
  projectId: string,
  projectRuta: string | undefined,
): Promise<{ loaded: number; merged: number }> {
  if (!projectRuta || typeof window === 'undefined' || !window.electron?.fileRead) {
    return { loaded: 0, merged: 0 }
  }
  try {
    const path = projectLibraryPath(projectRuta)
    const raw = await window.electron.fileRead(path)
    if (!raw) return { loaded: 0, merged: 0 }
    const parsed = JSON.parse(raw) as CatalogFile | LibraryPreset[]
    const fromDisk: LibraryPreset[] = Array.isArray(parsed)
      ? parsed
      : parsed?.presets && Array.isArray(parsed.presets)
        ? parsed.presets
        : []
    if (!fromDisk.length) return { loaded: 0, merged: 0 }

    const local = readLocal(projectId)
    const byId = new Map(local.map((p) => [p.id, p]))
    let merged = 0
    for (const p of fromDisk) {
      const prev = byId.get(p.id)
      const next: LibraryPreset = { ...p, scope: p.scope ?? 'project', type: p.type ?? 'plugin' }
      if (!prev || (prev.updatedAt ?? 0) < (next.updatedAt ?? 0)) {
        byId.set(p.id, next)
        merged += 1
      }
    }
    const list = [...byId.values()]
    writeLocal(projectId, list)
    return { loaded: fromDisk.length, merged }
  } catch {
    return { loaded: 0, merged: 0 }
  }
}

/** Reemplaza la biblioteca del proyecto desde disco (sin merge). */
export function importProjectLibraryPresets(projectId: string, presets: LibraryPreset[]): void {
  writeLocal(
    projectId,
    presets.map((p) => ({ ...p, scope: p.scope ?? 'project', type: p.type ?? 'plugin' })),
  )
}
