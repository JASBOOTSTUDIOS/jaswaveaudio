/**
 * Biblioteca de presets VST del proyecto (estado real + metadatos).
 * Persistencia: localStorage por projectId; opcional sync a disco junto al .jaswave.
 */

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
