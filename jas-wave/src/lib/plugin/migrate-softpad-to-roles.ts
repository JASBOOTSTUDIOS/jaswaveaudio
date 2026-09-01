/**
 * Migración Soft Pad (builtin Web Audio) → JasWave Roles VST3.
 */

import type { PluginInfo } from '../../../../shared/src/types/entidades'
import type { ProjectState } from '../../../../shared/src/types/proyecto'
import type { PluginDescriptor } from './types'
import { descriptorToPluginInfo } from './plugin-info-adapter'
import {
  findJasWaveRolesDescriptor,
  jasWaveRolesPluginInfo,
} from './jaswave-roles'

export type SoftPadMigrationResult = {
  migrated: number
  removed: number
}

/** Soft Pad legacy: licencia interno + nombre Soft Pad, o id `plugin-softpad-*`. */
export function isLegacySoftPadPlugin(
  p: Pick<PluginInfo, 'id' | 'nombre' | 'licencia'>,
): boolean {
  if (/^plugin-softpad-/i.test(String(p.id ?? ''))) return true
  const licencia = String(p.licencia ?? '').toLowerCase()
  const nombre = String(p.nombre ?? '')
  if (licencia === 'interno' && /soft\s*pad/i.test(nombre)) return true
  return false
}

function resolveRolesPluginInfo(catalog?: PluginDescriptor[]): PluginInfo | null {
  if (catalog) {
    const d = findJasWaveRolesDescriptor(catalog)
    if (!d) return null
    return jasWaveRolesPluginInfo() ?? descriptorToPluginInfo(d)
  }
  return jasWaveRolesPluginInfo()
}

function migratePluginList(
  plugins: PluginInfo[] | undefined,
  rolesInfo: PluginInfo | null,
): SoftPadMigrationResult {
  if (!plugins?.length) return { migrated: 0, removed: 0 }
  let migrated = 0
  let removed = 0
  const next: PluginInfo[] = []
  for (const p of plugins) {
    if (!isLegacySoftPadPlugin(p)) {
      next.push(p)
      continue
    }
    if (rolesInfo) {
      next.push({
        ...rolesInfo,
        id: p.id,
        bypass: p.bypass,
      })
      migrated += 1
    } else {
      removed += 1
    }
  }
  plugins.length = 0
  plugins.push(...next)
  return { migrated, removed }
}

/**
 * Reemplaza inserts Soft Pad por JasWave Roles si hay Roles.vst3 en catálogo;
 * si no, elimina Soft Pad. Mutates `project` in place.
 */
export function migrateSoftPadPluginsInProject(
  project: ProjectState,
  catalog?: PluginDescriptor[],
): SoftPadMigrationResult {
  const rolesInfo = resolveRolesPluginInfo(catalog)
  let migrated = 0
  let removed = 0

  for (const track of project.tracks ?? []) {
    if (!track.plugins) continue
    const r = migratePluginList(track.plugins, rolesInfo)
    migrated += r.migrated
    removed += r.removed
  }

  if (project.master?.plugins) {
    const r = migratePluginList(project.master.plugins, rolesInfo)
    migrated += r.migrated
    removed += r.removed
  }

  return { migrated, removed }
}
