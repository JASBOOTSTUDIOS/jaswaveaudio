/**
 * Catálogo de StyleProfile — proyecto (localStorage + disco) y helpers de búsqueda.
 */

import type { StyleCatalogFile, StyleProfile, StyleRole, StyleScope } from './types'

function storageKey(projectId: string): string {
  return `jaswave.styleProfiles.v1.${projectId || 'default'}`
}

function readLocal(projectId: string): StyleProfile[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(projectId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as StyleCatalogFile | StyleProfile[]
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.profiles)) return parsed.profiles
    return []
  } catch {
    return []
  }
}

function writeLocal(projectId: string, profiles: StyleProfile[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload: StyleCatalogFile = { version: 1, profiles }
    localStorage.setItem(storageKey(projectId), JSON.stringify(payload))
  } catch {
    /* quota */
  }
}

async function syncToDisk(projectRuta: string | undefined, profiles: StyleProfile[]): Promise<void> {
  if (!projectRuta || typeof window === 'undefined' || !window.electron?.fileSave) return
  try {
    const dir = projectRuta.replace(/[/\\][^/\\]+$/, '')
    const path = `${dir}/library/styles.json`
    await window.electron.fileSave(path, JSON.stringify({ version: 1, profiles }, null, 2))
  } catch {
    /* optional */
  }
}

export function listStyleProfiles(projectId: string): StyleProfile[] {
  return readLocal(projectId).slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getStyleProfile(projectId: string, id: string): StyleProfile | undefined {
  return readLocal(projectId).find((p) => p.id === id)
}

export function searchStyleProfiles(
  projectId: string,
  opts?: { query?: string; rol?: StyleRole | string; tag?: string },
): StyleProfile[] {
  const q = (opts?.query ?? '').toLowerCase().trim()
  const rol = (opts?.rol ?? '').toLowerCase().trim()
  const tag = (opts?.tag ?? '').toLowerCase().trim()
  return listStyleProfiles(projectId).filter((p) => {
    if (rol && p.rol.toLowerCase() !== rol) return false
    if (tag && !p.tags.some((t) => t.toLowerCase().includes(tag))) return false
    if (!q) return true
    const hay = `${p.nombre} ${p.rol} ${p.feel} ${p.summaryText} ${p.tags.join(' ')}`.toLowerCase()
    return hay.includes(q)
  })
}

export async function saveStyleProfile(
  projectId: string,
  profile: StyleProfile,
  projectRuta?: string,
): Promise<StyleProfile> {
  const list = readLocal(projectId)
  const now = Date.now()
  const next: StyleProfile = {
    ...profile,
    scope: 'project' as StyleScope,
    updatedAt: now,
    createdAt: profile.createdAt || now,
    version: 1,
  }
  const idx = list.findIndex((p) => p.id === next.id)
  const profiles = idx >= 0 ? list.map((p, i) => (i === idx ? next : p)) : [...list, next]
  writeLocal(projectId, profiles)
  await syncToDisk(projectRuta, profiles)
  return next
}

export function deleteStyleProfile(projectId: string, id: string, projectRuta?: string): boolean {
  const list = readLocal(projectId)
  const next = list.filter((p) => p.id !== id)
  if (next.length === list.length) return false
  writeLocal(projectId, next)
  void syncToDisk(projectRuta, next)
  return true
}

export async function loadStylesFromDisk(projectId: string, projectRuta?: string): Promise<number> {
  if (!projectRuta || typeof window === 'undefined' || !window.electron?.fileRead) return 0
  try {
    const dir = projectRuta.replace(/[/\\][^/\\]+$/, '')
    const path = `${dir}/library/styles.json`
    const raw = await window.electron.fileRead(path)
    if (!raw) return 0
    const parsed = JSON.parse(raw) as StyleCatalogFile
    if (!parsed?.profiles?.length) return 0
    writeLocal(projectId, parsed.profiles)
    return parsed.profiles.length
  } catch {
    return 0
  }
}

export function formatStyleProfilesForContext(profiles: StyleProfile[], limit = 8): string {
  const slice = profiles.slice(0, limit)
  if (!slice.length) return '(sin perfiles de estilo guardados)'
  return slice
    .map(
      (p, i) =>
        `${i + 1}. [${p.id}] ${p.nombre} · ${p.rol} · ${p.feel} · ${p.bpm} BPM · tags=${p.tags.join(',')}\n   ${p.summaryText}`,
    )
    .join('\n')
}
