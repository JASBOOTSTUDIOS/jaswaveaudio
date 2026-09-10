/**
 * Preferencias de instrumentos para la IA:
 * - activar/desactivar plugins del catálogo usable por el agente
 * - plugin y/o preset (estado VST) por defecto por rol
 */

import type { PluginDescriptor } from './types'
import type { InstrumentRole } from '../plugin-knowledge'

const STORAGE_KEY = 'jaswave.instrumentAiPrefs.v1'

export type RoleDefaultRef = {
  pluginId: string
  pluginNombre: string
  /** Config guardada en biblioteca (estado DecentSampler / Kontakt / etc.). */
  presetId?: string
  presetNombre?: string
}

export type InstrumentAiPrefs = {
  /** Plugins que la IA no debe usar ni listar. */
  aiDisabledIds: string[]
  /** Preferido por rol musical cuando la IA pide ese instrumento. */
  roleDefaults: Partial<Record<InstrumentRole, RoleDefaultRef>>
}

export const INSTRUMENT_ROLE_LABELS: Record<InstrumentRole, string> = {
  drums: 'Batería',
  percussion: 'Percusión',
  bass: 'Bajo',
  guitar: 'Guitarra',
  piano: 'Piano',
  keys: 'Teclas',
  pad: 'Pad',
  lead: 'Lead',
  strings: 'Cuerdas',
  brass: 'Metales',
  woodwind: 'Vientos',
  choir: 'Coro',
  synth: 'Synth',
  fx: 'FX',
  unknown: 'Otros',
}

/** Roles que el usuario puede asignar como “por defecto”. */
export const ASSIGNABLE_INSTRUMENT_ROLES: InstrumentRole[] = [
  'drums',
  'percussion',
  'bass',
  'guitar',
  'piano',
  'keys',
  'pad',
  'lead',
  'strings',
  'brass',
  'woodwind',
  'choir',
  'synth',
]

const EMPTY: InstrumentAiPrefs = {
  aiDisabledIds: [],
  roleDefaults: {},
}

let cache: InstrumentAiPrefs | null = null
const listeners = new Set<() => void>()

function clonePrefs(p: InstrumentAiPrefs): InstrumentAiPrefs {
  return {
    aiDisabledIds: [...p.aiDisabledIds],
    roleDefaults: { ...p.roleDefaults },
  }
}

function normalizeRef(raw: unknown): RoleDefaultRef | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const pluginId = typeof o.pluginId === 'string' ? o.pluginId : ''
  const pluginNombre = typeof o.pluginNombre === 'string' ? o.pluginNombre : ''
  if (!pluginId || !pluginNombre) return null
  const ref: RoleDefaultRef = { pluginId, pluginNombre }
  if (typeof o.presetId === 'string' && o.presetId) {
    ref.presetId = o.presetId
    if (typeof o.presetNombre === 'string' && o.presetNombre) ref.presetNombre = o.presetNombre
  }
  return ref
}

function read(): InstrumentAiPrefs {
  if (cache) return cache
  if (typeof localStorage === 'undefined') {
    cache = clonePrefs(EMPTY)
    return cache
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      cache = clonePrefs(EMPTY)
      return cache
    }
    const parsed = JSON.parse(raw) as Partial<InstrumentAiPrefs>
    const disabled = Array.isArray(parsed.aiDisabledIds)
      ? parsed.aiDisabledIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
    const roleDefaults: InstrumentAiPrefs['roleDefaults'] = {}
    if (parsed.roleDefaults && typeof parsed.roleDefaults === 'object') {
      for (const [role, refRaw] of Object.entries(parsed.roleDefaults)) {
        const ref = normalizeRef(refRaw)
        if (ref) roleDefaults[role as InstrumentRole] = ref
      }
    }
    cache = { aiDisabledIds: disabled, roleDefaults }
    return cache
  } catch {
    cache = clonePrefs(EMPTY)
    return cache
  }
}

function write(next: InstrumentAiPrefs): void {
  cache = next
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* quota */
    }
  }
  for (const l of listeners) l()
}

export function subscribeInstrumentAiPrefs(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getInstrumentAiPrefs(): InstrumentAiPrefs {
  return clonePrefs(read())
}

/** Snapshot estable para useSyncExternalStore. */
let snap: InstrumentAiPrefs = clonePrefs(EMPTY)
let snapKey = ''

function prefsKey(p: InstrumentAiPrefs): string {
  const roles = Object.entries(p.roleDefaults)
    .map(([r, v]) => `${r}=${v?.pluginId ?? ''}:${v?.presetId ?? ''}`)
    .sort()
    .join('|')
  return `${[...p.aiDisabledIds].sort().join(',')}\0${roles}`
}

export function getInstrumentAiPrefsSnapshot(): InstrumentAiPrefs {
  const cur = read()
  const key = prefsKey(cur)
  if (key === snapKey) return snap
  snapKey = key
  snap = clonePrefs(cur)
  return snap
}

export function isPluginAiEnabled(pluginId: string): boolean {
  return !read().aiDisabledIds.includes(pluginId)
}

export function setPluginAiEnabled(pluginId: string, enabled: boolean): void {
  const cur = read()
  const set = new Set(cur.aiDisabledIds)
  if (enabled) set.delete(pluginId)
  else set.add(pluginId)
  write({ ...cur, aiDisabledIds: [...set] })
}

export function getRoleDefault(role: InstrumentRole): RoleDefaultRef | null {
  return read().roleDefaults[role] ?? null
}

export function setRoleDefault(role: InstrumentRole, ref: RoleDefaultRef | null): void {
  const cur = read()
  const roleDefaults = { ...cur.roleDefaults }
  if (!ref) delete roleDefaults[role]
  else roleDefaults[role] = ref
  // Misma config exacta (plugin+preset) no debe ser default de dos roles.
  if (ref) {
    const presetKey = ref.presetId ?? ''
    for (const [r, v] of Object.entries(roleDefaults)) {
      if (r === role) continue
      if (v?.pluginId === ref.pluginId && (v?.presetId ?? '') === presetKey) {
        delete roleDefaults[r as InstrumentRole]
      }
    }
  }
  write({ ...cur, roleDefaults })
}

export function clearRoleDefaultForPlugin(pluginId: string): void {
  const cur = read()
  const roleDefaults = { ...cur.roleDefaults }
  let changed = false
  for (const [r, v] of Object.entries(roleDefaults)) {
    if (v?.pluginId === pluginId) {
      delete roleDefaults[r as InstrumentRole]
      changed = true
    }
  }
  if (changed) write({ ...cur, roleDefaults })
}

export function clearRoleDefaultForPreset(presetId: string): void {
  const cur = read()
  const roleDefaults = { ...cur.roleDefaults }
  let changed = false
  for (const [r, v] of Object.entries(roleDefaults)) {
    if (v?.presetId === presetId) {
      delete roleDefaults[r as InstrumentRole]
      changed = true
    }
  }
  if (changed) write({ ...cur, roleDefaults })
}

export function rolesWherePluginIsDefault(pluginId: string): InstrumentRole[] {
  const out: InstrumentRole[] = []
  for (const [r, v] of Object.entries(read().roleDefaults)) {
    if (v?.pluginId === pluginId) out.push(r as InstrumentRole)
  }
  return out
}

export function rolesWherePresetIsDefault(presetId: string): InstrumentRole[] {
  const out: InstrumentRole[] = []
  for (const [r, v] of Object.entries(read().roleDefaults)) {
    if (v?.presetId === presetId) out.push(r as InstrumentRole)
  }
  return out
}

export function filterCatalogForAi(catalog: PluginDescriptor[]): PluginDescriptor[] {
  return catalog.filter((d) => isPluginAiEnabled(d.pluginId))
}

/** Resuelve el default de usuario si está en el catálogo y habilitado para IA. */
export function resolveRoleDefaultFromCatalog(
  catalog: PluginDescriptor[],
  role: InstrumentRole,
): PluginDescriptor | undefined {
  const pref = getRoleDefault(role)
  if (!pref) return undefined
  const hit =
    catalog.find((d) => d.pluginId === pref.pluginId) ??
    catalog.find((d) => d.name.toLowerCase() === pref.pluginNombre.toLowerCase())
  if (!hit) return undefined
  if (!isPluginAiEnabled(hit.pluginId)) return undefined
  return hit
}

/** Bloque de texto para el prompt del agente. */
export function formatInstrumentAiPrefsForPrompt(): string {
  const prefs = read()
  const lines: string[] = []
  const defaults = Object.entries(prefs.roleDefaults)
  if (defaults.length) {
    lines.push(
      'Defaults por rol (usar estos salvo que el usuario pida otro). Si hay presetId, aplica library.preset.apply con ese id:',
    )
    for (const [role, ref] of defaults) {
      if (!ref) continue
      const label = INSTRUMENT_ROLE_LABELS[role as InstrumentRole] ?? role
      const presetPart = ref.presetId
        ? ` · config «${ref.presetNombre ?? ref.presetId}» presetId=${ref.presetId}`
        : ''
      lines.push(`  - ${label} (${role}): ${ref.pluginNombre} id=${ref.pluginId}${presetPart}`)
    }
  }
  if (prefs.aiDisabledIds.length) {
    lines.push(
      `Plugins desactivados para IA (${prefs.aiDisabledIds.length}): no los elijas ni los insertes.`,
    )
  }
  return lines.join('\n')
}
