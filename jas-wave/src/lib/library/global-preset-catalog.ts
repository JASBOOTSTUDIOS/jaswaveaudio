/**
 * Biblioteca global de presets VST / FX chain — cross-proyecto en userData.
 * Ruta: {userData}/library/presets.json
 */

import type { PluginInfo } from '../../../../shared/src/types/entidades'
import type { LibraryPreset, LibraryPresetType } from './preset-catalog'

type GlobalCatalogFile = {
  version: 1
  presets: LibraryPreset[]
}

let cachedPath: string | null = null
let memoryCache: LibraryPreset[] | null = null

async function globalPresetsPath(): Promise<string | null> {
  if (cachedPath) return cachedPath
  if (typeof window === 'undefined' || !window.electron?.userDataPath) return null
  try {
    const base = await window.electron.userDataPath()
    if (!base) return null
    cachedPath = `${base.replace(/[/\\]+$/, '')}/library/presets.json`
    return cachedPath
  } catch {
    return null
  }
}

async function readDisk(): Promise<LibraryPreset[]> {
  const path = await globalPresetsPath()
  if (!path || !window.electron?.fileRead) return []
  try {
    const raw = await window.electron.fileRead(path)
    if (!raw) return []
    const parsed = JSON.parse(raw) as GlobalCatalogFile | LibraryPreset[]
    if (Array.isArray(parsed)) return parsed.map(normalizeGlobal)
    if (parsed?.presets && Array.isArray(parsed.presets)) return parsed.presets.map(normalizeGlobal)
    return []
  } catch {
    return []
  }
}

async function writeDisk(presets: LibraryPreset[]): Promise<void> {
  const path = await globalPresetsPath()
  if (!path || !window.electron?.fileSave) return
  const payload: GlobalCatalogFile = { version: 1, presets }
  await window.electron.fileSave(path, JSON.stringify(payload, null, 2))
  memoryCache = presets
}

function normalizeGlobal(p: LibraryPreset): LibraryPreset {
  return { ...p, scope: 'global', type: p.type ?? 'plugin' }
}

async function ensureLoaded(): Promise<LibraryPreset[]> {
  if (memoryCache) return memoryCache
  memoryCache = await readDisk()
  return memoryCache
}

export function invalidateGlobalPresetCache(): void {
  memoryCache = null
}

export async function listGlobalPresets(): Promise<LibraryPreset[]> {
  const list = await ensureLoaded()
  return list.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getGlobalPreset(presetId: string): Promise<LibraryPreset | undefined> {
  const list = await ensureLoaded()
  return list.find((p) => p.id === presetId)
}

export async function searchGlobalPresets(opts?: {
  query?: string
  rol?: string
  genero?: string
  type?: LibraryPresetType
}): Promise<LibraryPreset[]> {
  const q = (opts?.query ?? '').toLowerCase().trim()
  const rol = (opts?.rol ?? '').toLowerCase().trim()
  const genero = (opts?.genero ?? '').toLowerCase().trim()
  const type = opts?.type
  return (await listGlobalPresets()).filter((p) => {
    if (type && (p.type ?? 'plugin') !== type) return false
    if (rol && (p.rol ?? '').toLowerCase() !== rol) return false
    if (genero && !p.generoTags.some((t) => t.toLowerCase().includes(genero))) return false
    if (!q) return true
    const hay = `${p.nombre} ${p.pluginNombre} ${p.rol ?? ''} ${p.notas ?? ''} ${p.generoTags.join(' ')}`.toLowerCase()
    return hay.includes(q)
  })
}

export async function saveGlobalPreset(
  preset: Omit<LibraryPreset, 'id' | 'createdAt' | 'updatedAt' | 'scope'> & { id?: string },
): Promise<LibraryPreset> {
  const now = Date.now()
  const list = await ensureLoaded()
  const id = preset.id ?? `gpreset-${now.toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`
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
    type: preset.type ?? 'plugin',
    scope: 'global',
    probedAt: preset.probedAt,
    probeOk: preset.probeOk,
    createdAt: existing >= 0 ? list[existing]!.createdAt : now,
    updatedAt: now,
  }
  if (existing >= 0) list[existing] = next
  else list.push(next)
  await writeDisk(list)
  return next
}

export async function deleteGlobalPreset(presetId: string): Promise<boolean> {
  const list = await ensureLoaded()
  const next = list.filter((p) => p.id !== presetId)
  const changed = next.length !== list.length
  if (changed) await writeDisk(next)
  return changed
}

export async function updateGlobalPresetMeta(
  presetId: string,
  patch: Partial<Pick<LibraryPreset, 'nombre' | 'rol' | 'generoTags' | 'notas' | 'probeOk' | 'probedAt'>>,
): Promise<LibraryPreset | null> {
  const list = await ensureLoaded()
  const i = list.findIndex((p) => p.id === presetId)
  if (i < 0) return null
  const next = { ...list[i]!, ...patch, updatedAt: Date.now(), scope: 'global' as const }
  list[i] = next
  await writeDisk(list)
  return next
}

export async function exportGlobalPreset(presetId: string): Promise<string | null> {
  const p = await getGlobalPreset(presetId)
  if (!p) return null
  return JSON.stringify(p, null, 2)
}

export async function importGlobalPreset(json: string): Promise<{ ok: boolean; preset?: LibraryPreset; message: string }> {
  try {
    const parsed = JSON.parse(json) as LibraryPreset
    if (!parsed.nombre || !parsed.pluginId) {
      return { ok: false, message: 'JSON inválido: falta nombre o pluginId' }
    }
    const saved = await saveGlobalPreset({
      ...parsed,
      id: parsed.id?.startsWith('gpreset-') ? parsed.id : undefined,
      generoTags: parsed.generoTags ?? [],
      type: parsed.type ?? 'plugin',
    })
    return { ok: true, preset: saved, message: `Importado «${saved.nombre}»` }
  } catch {
    return { ok: false, message: 'JSON de preset inválido' }
  }
}

/** Promueve un preset de proyecto a biblioteca global (copia completa). */
export async function promoteProjectPresetToGlobal(preset: LibraryPreset): Promise<LibraryPreset> {
  return saveGlobalPreset({
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
    type: preset.type ?? 'plugin',
    probedAt: preset.probedAt,
    probeOk: preset.probeOk,
  })
}

export async function saveGlobalFxChainPreset(opts: {
  nombre: string
  trackHint?: string
  plugins: PluginInfo[]
  rol?: string
  generoTags?: string[]
}): Promise<LibraryPreset> {
  const pluginNombre =
    opts.plugins.length === 1
      ? opts.plugins[0]!.nombre
      : `FX Chain (${opts.plugins.length})`
  return saveGlobalPreset({
    pluginId: `fxchain:${opts.plugins.map((p) => p.id).join(',')}`,
    pluginNombre,
    nombre: opts.nombre,
    rol: opts.rol ?? 'fx',
    generoTags: opts.generoTags ?? [],
    notas: opts.trackHint ? `Origen: ${opts.trackHint}` : undefined,
    type: 'fxChain',
    fxChainPlugins: opts.plugins.map((p) => structuredClone(p)),
  })
}
