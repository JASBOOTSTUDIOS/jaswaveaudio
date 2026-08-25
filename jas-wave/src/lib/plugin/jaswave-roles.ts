/**
 * JasWave Roles VST3 — mapa Role ↔ parámetro normalizado (id 0).
 * Debe coincidir con native/jaswave-roles-vst/src/roles_map.h
 */

import type { PluginDescriptor } from './types'
import { pluginRegistry } from './registry'
import { descriptorToPluginInfo } from './plugin-info-adapter'
import { ensureTrackVstInstrument, setSlotParameter, slotIdForTrackPlugin } from './track-vst-runtime'
import type { PluginInfo } from '../../../../shared/src/types/entidades'

export const JASWAVE_ROLES_PARAM_ID = 0
export const JASWAVE_ROLES_NAME = 'JasWave Roles'
export const JASWAVE_ROLES_VENDOR = 'JasWave'

export type JasWaveRole =
  | 'drums'
  | 'bass'
  | 'guitar'
  | 'piano'
  | 'keys'
  | 'pad'
  | 'strings'
  | 'choir'
  | 'lead'
  | 'brass'
  | 'synth'
  | 'percussion'
  | 'default'

const ROLE_ORDER: JasWaveRole[] = [
  'drums',
  'bass',
  'guitar',
  'piano',
  'keys',
  'pad',
  'strings',
  'choir',
  'lead',
  'brass',
  'synth',
  'percussion',
  'default',
]

export function normalizeJasWaveRole(rol: string | undefined | null): JasWaveRole {
  const r = String(rol ?? '')
    .toLowerCase()
    .trim()
  if (!r) return 'default'
  if (r === 'drums' || r === 'drum' || r === 'batería' || r === 'bateria' || r === 'percussion' || /bater|drum|kit/.test(r))
    return 'drums'
  if (r === 'bass' || r === 'bajo' || /bajo|bass/.test(r)) return 'bass'
  if (r === 'guitar' || r === 'guitarra' || /guitar/.test(r)) return 'guitar'
  if (r === 'piano' || /piano/.test(r)) return 'piano'
  if (r === 'keys' || r === 'keys_pad' || r === 'organ' || r === 'keys_fx' || /keys|teclado|organ/.test(r))
    return 'keys'
  if (r === 'pad' || r === 'ambient' || /\bpad\b|ambient/.test(r)) return 'pad'
  if (r === 'strings' || r === 'cuerdas' || /string|cuerda/.test(r)) return 'strings'
  if (r === 'choir' || r === 'coro' || r === 'vocal' || /choir|coro/.test(r)) return 'choir'
  if (r === 'lead' || r === 'melody' || r === 'solo' || /lead|melody/.test(r)) return 'lead'
  if (r === 'brass' || r === 'metales' || /brass|metal/.test(r)) return 'brass'
  if (r === 'synth' || r === 'fx' || /synth|sintet/.test(r)) return 'synth'
  return 'default'
}

export function roleToNormalized(role: JasWaveRole): number {
  const idx = ROLE_ORDER.indexOf(role)
  const i = idx >= 0 ? idx : ROLE_ORDER.length - 1
  return i / (ROLE_ORDER.length - 1)
}

export function isJasWaveRolesDescriptor(d: PluginDescriptor): boolean {
  const blob = `${d.name} ${d.vendor} ${d.path ?? ''} ${d.pluginId}`.toLowerCase()
  return /jaswave\s*roles|jaswaveroles/.test(blob) || (d.vendor === 'JasWave' && /roles/.test(blob))
}

/** Ruta instalada por post-build de native/jaswave-roles-vst. */
export function defaultJasWaveRolesPath(): string {
  if (typeof process !== 'undefined' && process.env?.LOCALAPPDATA) {
    return `${process.env.LOCALAPPDATA}\\Programs\\Common\\VST3\\JasWave\\JasWaveRoles.vst3`
  }
  // Renderer Electron (sin process.env): heurística vía userData no disponible; el host descubre por carpeta VST3.
  return ''
}

/** Registra descriptor Roles en catálogo si falta (path conocido o el pasado). */
export function ensureJasWaveRolesRegistered(explicitPath?: string): PluginDescriptor | undefined {
  const existing = findJasWaveRolesDescriptor()
  if (existing?.path) return existing
  const path = (explicitPath || defaultJasWaveRolesPath()).trim()
  if (!path) return undefined
  let hash = 0
  for (let i = 0; i < path.length; i++) hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0
  const d: PluginDescriptor = {
    pluginId: `vst3.${(hash >>> 0).toString(16)}`,
    format: 'vst3',
    vendor: JASWAVE_ROLES_VENDOR,
    name: JASWAVE_ROLES_NAME,
    version: '1.0.0',
    path,
    category: 'instrumento',
    isInstrument: true,
    isEffect: false,
    supportsMidiInput: true,
    supportsMidiOutput: false,
    supportsAudioInput: false,
    supportsAudioOutput: true,
    supportsSidechain: false,
    supportsEditor: true,
    parameterCount: 7,
    scanStatus: 'ok',
    hostReady: true,
    isolation: 'out-of-process',
  }
  pluginRegistry.register(d)
  return d
}

export function findJasWaveRolesDescriptor(
  catalog: PluginDescriptor[] = pluginRegistry.list(),
): PluginDescriptor | undefined {
  return catalog.find((d) => isJasWaveRolesDescriptor(d) && d.hostReady && !!d.path)
}

export function jasWaveRolesPluginInfo(): PluginInfo | null {
  const d = ensureJasWaveRolesRegistered() ?? findJasWaveRolesDescriptor()
  if (!d) return null
  return descriptorToPluginInfo(d)
}

export function inferRoleFromTrack(t: {
  nombre?: string
  tags?: string[]
}): JasWaveRole {
  const tag = (t.tags ?? []).find((x) => /^role:/i.test(x))
  if (tag) return normalizeJasWaveRole(tag.replace(/^role:/i, ''))
  const hit = (t.tags ?? []).find((x) =>
    /^(drums|bass|guitar|piano|keys|pad|strings|choir|lead|brass|synth|percussion)$/i.test(x),
  )
  if (hit) return normalizeJasWaveRole(hit)
  return normalizeJasWaveRole(t.nombre)
}

/** Tras insert+load: fija parámetro Role (id 0). */
export async function applyJasWaveRolesParameter(
  trackId: string,
  plugin: PluginInfo,
  role: string | JasWaveRole,
): Promise<void> {
  const slotId = slotIdForTrackPlugin(trackId, plugin.id)
  await setSlotParameter(slotId, JASWAVE_ROLES_PARAM_ID, roleToNormalized(normalizeJasWaveRole(role)))
}

export async function insertJasWaveRolesOnTrack(
  executeInsert: (plugin: PluginInfo) => Promise<unknown>,
  trackId: string,
  role: string | JasWaveRole,
): Promise<PluginInfo | null> {
  const info = jasWaveRolesPluginInfo()
  if (!info) return null
  await executeInsert(info)
  try {
    await ensureTrackVstInstrument(trackId, info)
    await applyJasWaveRolesParameter(trackId, info, role)
  } catch {
    /* host opcional */
  }
  return info
}
