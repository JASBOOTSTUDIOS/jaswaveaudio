/**
 * Catálogo global de StyleProfile — {userData}/library/styles.json
 */

import type { StyleCatalogFile, StyleProfile, StyleRole } from './types'

let cachedPath: string | null = null
let memoryCache: StyleProfile[] | null = null

async function globalStylesPath(): Promise<string | null> {
  if (cachedPath) return cachedPath
  if (typeof window === 'undefined' || !window.electron?.userDataPath) return null
  try {
    const base = await window.electron.userDataPath()
    if (!base) return null
    cachedPath = `${base.replace(/[/\\]+$/, '')}/library/styles.json`
    return cachedPath
  } catch {
    return null
  }
}

async function readDisk(): Promise<StyleProfile[]> {
  const path = await globalStylesPath()
  if (!path || !window.electron?.fileRead) return []
  try {
    const raw = await window.electron.fileRead(path)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StyleCatalogFile | StyleProfile[]
    if (Array.isArray(parsed)) return parsed.map((p) => ({ ...p, scope: 'global' as const }))
    if (parsed?.profiles && Array.isArray(parsed.profiles)) {
      return parsed.profiles.map((p) => ({ ...p, scope: 'global' as const }))
    }
    return []
  } catch {
    return []
  }
}

async function writeDisk(profiles: StyleProfile[]): Promise<void> {
  const path = await globalStylesPath()
  if (!path || !window.electron?.fileSave) {
    throw new Error('No se puede escribir estilos globales (sin userData/fileSave)')
  }
  const payload: StyleCatalogFile = { version: 1, profiles }
  const result = (await window.electron.fileSave(path, JSON.stringify(payload, null, 2))) as
    | { success?: boolean; error?: string }
    | undefined
  if (result && result.success === false) {
    throw new Error(result.error || `Fallo al guardar ${path}`)
  }
  memoryCache = profiles
}

async function ensureLoaded(): Promise<StyleProfile[]> {
  if (memoryCache) return memoryCache
  memoryCache = await readDisk()
  return memoryCache
}

export function invalidateGlobalStyleCache(): void {
  memoryCache = null
}

export async function listGlobalStyleProfiles(): Promise<StyleProfile[]> {
  const list = await ensureLoaded()
  return list.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getGlobalStyleProfile(id: string): Promise<StyleProfile | undefined> {
  const list = await ensureLoaded()
  return list.find((p) => p.id === id)
}

export async function searchGlobalStyleProfiles(opts?: {
  query?: string
  rol?: StyleRole | string
  tag?: string
}): Promise<StyleProfile[]> {
  const q = (opts?.query ?? '').toLowerCase().trim()
  const rol = (opts?.rol ?? '').toLowerCase().trim()
  const tag = (opts?.tag ?? '').toLowerCase().trim()
  return (await listGlobalStyleProfiles()).filter((p) => {
    if (rol && p.rol.toLowerCase() !== rol) return false
    if (tag && !p.tags.some((t) => t.toLowerCase().includes(tag))) return false
    if (!q) return true
    const hay = `${p.nombre} ${p.rol} ${p.feel} ${p.summaryText} ${p.tags.join(' ')}`.toLowerCase()
    return hay.includes(q)
  })
}

export async function saveGlobalStyleProfile(profile: StyleProfile): Promise<StyleProfile> {
  const list = await ensureLoaded()
  const now = Date.now()
  const next: StyleProfile = {
    ...profile,
    scope: 'global',
    updatedAt: now,
    createdAt: profile.createdAt || now,
    version: 1,
  }
  const idx = list.findIndex((p) => p.id === next.id)
  const profiles = idx >= 0 ? list.map((p, i) => (i === idx ? next : p)) : [...list, next]
  await writeDisk(profiles)
  return next
}

export async function ensureMesiasSeed(seed: StyleProfile): Promise<StyleProfile> {
  const existing = await getGlobalStyleProfile(seed.id)
  if (existing) return existing
  return saveGlobalStyleProfile(seed)
}
