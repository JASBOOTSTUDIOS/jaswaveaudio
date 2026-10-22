/**
 * mix.eq / mix.compress / mix.limit sobre FX JasWave (A7d).
 *
 * Resuelve (o inserta) el procesador JasWave correspondiente en una pista y
 * traduce valores reales (dB, Hz, ms, :1) a parámetros normalizados del VST3
 * usando processor-profiles.json (SSOT de rangos/ids). Salvo que el usuario
 * pida un plugin concreto, se prefiere el FX JasWave.
 */

import type { TiendaDAW } from '../../../../shared/src/state/tienda'
import type { DAWState } from '../../../../shared/src/types/state'
import type { PluginDescriptor } from './types'
import { pluginRegistry } from './registry'
import {
  ensureJasWaveFxRegistered,
  JASWAVE_FX_EQ,
} from './bundled-plugins'
import { setSlotParameter, ensureTrackVstPlugin, slotIdForTrackPlugin } from './track-vst-runtime'
import { descriptorToPluginInfo } from './plugin-info-adapter'
import profiles from './processor-profiles.json'

export type FxKind = 'eq' | 'comp' | 'limiter' | 'utility' | 'deesser'

const FX_NAME_BY_KIND: Record<FxKind, string> = {
  eq: 'JasWave EQ',
  comp: 'JasWave Compresor',
  limiter: 'JasWave Limitador',
  utility: 'JasWave Utility',
  deesser: 'JasWave De-esser',
}

export function fxDescriptorName(kind: FxKind): string {
  return FX_NAME_BY_KIND[kind]
}

type ProfileParam = {
  id: number
  name: string
  unit: string
  kind: 'bool' | 'enum' | 'float'
  min: number
  max: number
  default: number
  step?: number
  scale?: 'log' | 'linear'
  enumValues?: string[]
  readOnly?: boolean
}

type ProfilePlugin = {
  name: string
  parameterCount: number
  parameters: ProfileParam[]
}

type Profiles = { plugin: Record<string, ProfilePlugin> }

const PROFILES = profiles as unknown as Profiles

function profileFor(kind: FxKind): ProfilePlugin | undefined {
  return PROFILES.plugin[FX_NAME_BY_KIND[kind]]
}

function profileParam(kind: FxKind, nameOrId: string | number): ProfileParam | undefined {
  const prof = profileFor(kind)
  if (!prof) return undefined
  return prof.parameters.find((p) =>
    typeof nameOrId === 'number' ? p.id === nameOrId : p.name === nameOrId,
  )
}

/** Valor plano → normalizado (0..1) según el perfil. */
export function normalizedFor(
  kind: FxKind,
  nameOrId: string | number,
  plainValue: unknown,
): number | undefined {
  const p = profileParam(kind, nameOrId)
  if (!p) return undefined
  if (p.kind === 'bool') {
    const v = typeof plainValue === 'number' ? plainValue : Number(plainValue)
    if (!Number.isFinite(v)) return undefined
    return v !== 0 ? 1 : 0
  }
  if (p.kind === 'enum') {
    const idx = (p.enumValues ?? []).indexOf(String(plainValue))
    if (idx < 0) return undefined
    return p.enumValues!.length <= 1 ? 0 : idx / (p.enumValues!.length - 1)
  }
  // float
  const v = typeof plainValue === 'number' ? plainValue : Number(plainValue)
  if (!Number.isFinite(v)) return undefined
  let n: number
  if (p.scale === 'log') {
    const lo = Math.max(1e-9, p.min)
    const hi = Math.max(1e-9, p.max)
    n = (Math.log(Math.max(lo, v)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
  } else {
    n = (v - p.min) / (p.max - p.min)
  }
  return Math.max(0, Math.min(1, n))
}

/** Descriptor JasWave FX del tipo indicado (registra si falta). */
export function findJasWaveFxDescriptor(kind: FxKind): PluginDescriptor | undefined {
  const name = FX_NAME_BY_KIND[kind]
  let hit = pluginRegistry.findByName(name).find((d) => d.hostReady && !!d.path)
  if (!hit) {
    const r = ensureJasWaveFxRegistered()
    hit = r ? r.descriptor : undefined
  }
  return hit
}

/** Ids de parámetro de una banda del EQ (1-based). */
export function eqBandParamIds(band1: number): {
  type: number
  freq: number
  gain: number
  q: number
  on: number
} {
  const b = Math.max(1, Math.min(8, band1))
  const base = JASWAVE_FX_EQ.bandBase + (b - 1) * JASWAVE_FX_EQ.bandStride
  return {
    type: base + JASWAVE_FX_EQ.bandType,
    freq: base + JASWAVE_FX_EQ.bandFreq,
    gain: base + JASWAVE_FX_EQ.bandGain,
    q: base + JASWAVE_FX_EQ.bandQ,
    on: base + JASWAVE_FX_EQ.bandOn,
  }
}

/**
 * Inserta (o reutiliza) el FX JasWave en la pista y devuelve el slotId del host.
 * No establece parámetros; para eso usar applyMixParams / setMixParam.
 */
export async function ensureJasWaveFxOnTrack(
  tienda: TiendaDAW,
  trackId: string,
  kind: FxKind,
): Promise<{ slotId: string; descriptor: PluginDescriptor } | null> {
  const descriptor = findJasWaveFxDescriptor(kind)
  if (!descriptor) return null
  const r = await tienda.executor.execute('plugin.insert', {
    trackId,
    plugin: descriptorToPluginInfo(descriptor),
  })
  if (!r.success) return null
  const st = tienda.obtenerEstado() as DAWState
  const isMaster = trackId === 'master' || trackId === '__master__'
  const plugins = isMaster
    ? (st.project.master.plugins ?? [])
    : (st.project.tracks.find((t) => t.id === trackId)?.plugins ?? [])
  const inserted =
    plugins.find((p) => p.nombre === descriptor.name) ?? plugins[plugins.length - 1]
  if (!inserted) return null
  void ensureTrackVstPlugin(isMaster ? 'master' : trackId, {
    ...inserted,
    descripcion: inserted.descripcion ?? '',
  })
  return {
    slotId: slotIdForTrackPlugin(isMaster ? 'master' : trackId, inserted.id),
    descriptor,
  }
}

/** Seta varios parámetros del slot (normalizados). */
export async function setMixParams(
  slotId: string,
  params: Record<number | string, number>,
): Promise<Record<number, boolean>> {
  const out: Record<number, boolean> = {}
  for (const [rawId, value] of Object.entries(params)) {
    const id = Number(rawId)
    if (!Number.isFinite(id)) continue
    out[id] = await setSlotParameter(slotId, id, Math.max(0, Math.min(1, value)))
  }
  return out
}

/** Inserta el FX JasWave si falta y aplica valores planos (nombre→normalizado). */
export async function applyMixOnTrack(
  tienda: TiendaDAW,
  trackId: string,
  kind: FxKind,
  values: Record<string | number, unknown>,
): Promise<{ slotId: string; applied: Record<number, boolean>; skipped: string[] }> {
  const ensured = await ensureJasWaveFxOnTrack(tienda, trackId, kind)
  if (!ensured) return { slotId: '', applied: {}, skipped: Object.keys(values).map(String) }
  const applied: Record<number, boolean> = {}
  const skipped: string[] = []
  for (const [rawId, value] of Object.entries(values)) {
    const id = Number(rawId)
    if (!Number.isFinite(id)) { skipped.push(String(rawId)); continue }
    const n = normalizedFor(kind, id, value)
    if (n === undefined) { skipped.push(String(rawId)); continue }
    applied[id] = await setSlotParameter(ensured.slotId, id, n)
  }
  return { slotId: ensured.slotId, applied, skipped }
}

