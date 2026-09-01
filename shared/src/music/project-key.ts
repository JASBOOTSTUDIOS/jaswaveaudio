/**
 * Tonalidad del proyecto (opcional) y regiones con cambio de tono.
 * Persistido en project.metadata.customData.
 */

import type { ProjectMetadata } from '../types/metadata'

export type ProjectKeyMode = 'major' | 'minor'

export type ProjectKeyConfig = {
  enabled: boolean
  label: string
  root: number
  mode: ProjectKeyMode
}

export type ProjectKeyRegion = {
  id: string
  inicioBeats: number
  finBeats: number
  label: string
  root: number
  mode: ProjectKeyMode
}

const KEY_DATA = 'jaswave.tonalidad'
const REGIONS_DATA = 'jaswave.tonalidadRegiones'

export function getProjectKey(metadata: ProjectMetadata | undefined): ProjectKeyConfig | null {
  const raw = metadata?.customData?.[KEY_DATA]
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!o.enabled) return null
  return {
    enabled: true,
    label: String(o.label ?? 'C mayor'),
    root: Number(o.root ?? 60),
    mode: o.mode === 'minor' ? 'minor' : 'major',
  }
}

export function getProjectKeyRegions(metadata: ProjectMetadata | undefined): ProjectKeyRegion[] {
  const raw = metadata?.customData?.[REGIONS_DATA]
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const o = item as Record<string, unknown>
      const id = String(o.id ?? '')
      if (!id) return null
      return {
        id,
        inicioBeats: Number(o.inicioBeats ?? 0),
        finBeats: Number(o.finBeats ?? 0),
        label: String(o.label ?? ''),
        root: Number(o.root ?? 60),
        mode: o.mode === 'minor' ? 'minor' : ('major' as const),
      }
    })
    .filter((r): r is ProjectKeyRegion => r != null)
}

export function resolveKeyAtBeat(
  metadata: ProjectMetadata | undefined,
  beat: number,
): ProjectKeyConfig | null {
  const regions = getProjectKeyRegions(metadata)
  for (const r of regions) {
    if (beat >= r.inicioBeats && beat < r.finBeats) {
      return {
        enabled: true,
        label: r.label,
        root: r.root,
        mode: r.mode,
      }
    }
  }
  return getProjectKey(metadata)
}

export function mergeProjectKeyIntoMetadata(
  metadata: ProjectMetadata,
  tonalidad: ProjectKeyConfig | null | undefined,
  tonalidadRegiones?: ProjectKeyRegion[],
): ProjectMetadata {
  const customData = { ...metadata.customData }
  if (tonalidad === null) {
    delete customData[KEY_DATA]
  } else if (tonalidad !== undefined) {
    customData[KEY_DATA] = tonalidad
  }
  if (tonalidadRegiones !== undefined) {
    customData[REGIONS_DATA] = tonalidadRegiones
  }
  return {
    ...metadata,
    customData,
    fechaModificacion: Date.now(),
  }
}

export const PROJECT_KEY_ROOTS = [
  { root: 60, label: 'C' },
  { root: 61, label: 'C#' },
  { root: 62, label: 'D' },
  { root: 63, label: 'D#' },
  { root: 64, label: 'E' },
  { root: 65, label: 'F' },
  { root: 66, label: 'F#' },
  { root: 67, label: 'G' },
  { root: 68, label: 'G#' },
  { root: 69, label: 'A' },
  { root: 70, label: 'A#' },
  { root: 71, label: 'B' },
] as const

export function formatKeyLabel(root: number, mode: ProjectKeyMode): string {
  const name = PROJECT_KEY_ROOTS.find((k) => k.root === root)?.label ?? 'C'
  return mode === 'minor' ? `${name} menor` : `${name} mayor`
}
