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
import { descriptorDePlugin } from '../plugins/registro-plugins'
import { setSlotParameter, listSlotParameters, ensureTrackVstPlugin, slotIdForTrackPlugin } from './track-vst-runtime'
import {
  EQ_MAX_BANDAS,
  EQ_PRIMERA_BANDA_AVANZADA,
  eqAjustesABandas,
  eqBandasAAjustes,
  eqDiferencias,
  eqFrecuenciaLibre,
  eqNombreParametro,
  eqParamId,
  eqPerfilParametros,
  eqPrimerSlotLibre,
  eqResumenCambios,
  eqValorANormalizado,
  normalizarTipoEq,
  EQ_RANGOS,
  type BandaEq,
  type CambioEq,
} from '../../../../shared/src/audio/eq-dinamico'
import { EventosMezcla } from '../../../../shared/src/constants/nombres-eventos'
import { descriptorToPluginInfo } from './plugin-info-adapter'
import profiles from './processor-profiles.json'

export type FxKind = 'eq' | 'comp' | 'limiter' | 'utility' | 'deesser'

/** Plugin independiente (id de manifiesto) que implementa cada tipo de FX. */
export const FX_PLUGIN_ID: Record<FxKind, string> = {
  eq: 'com.jaswave.plugin.param-eq',
  comp: 'com.jaswave.plugin.bus-compressor',
  limiter: 'com.jaswave.plugin.truepeak-limiter',
  utility: 'com.jaswave.plugin.utility-tool',
  deesser: 'com.jaswave.plugin.smart-deesser',
}

/** Nombre del plugin cuando no está instalado (el real llega del manifiesto). */
const FX_NOMBRE_POR_DEFECTO: Record<FxKind, string> = {
  eq: 'JasWave EQ Parametric Pro',
  comp: 'JasWave Bus Compressor',
  limiter: 'JasWave True-Peak Limiter Pro',
  utility: 'JasWave Utility & Phase Tool',
  deesser: 'JasWave Smart De-Esser',
}

/** Clave de cada FX en processor-profiles.json (rangos e ids; los ParamID no cambiaron). */
const PERFIL_POR_TIPO: Record<FxKind, string> = {
  eq: 'JasWave EQ',
  comp: 'JasWave Compresor',
  limiter: 'JasWave Limitador',
  utility: 'JasWave Utility',
  deesser: 'JasWave De-esser',
}

export function fxDescriptorName(kind: FxKind): string {
  return descriptorDePlugin(FX_PLUGIN_ID[kind])?.name ?? FX_NOMBRE_POR_DEFECTO[kind]
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

/** Parámetros (id, rango, unidad) del FX según processor-profiles.json. */
export function perfilParametros(kind: FxKind): ProfileParam[] {
  return profileFor(kind)?.parameters ?? []
}

/** El perfil del EQ sale del contrato de shared/ (24 bandas + parámetros extra), no de processor-profiles.json. */
let perfilEq: ProfilePlugin | undefined
function profileFor(kind: FxKind): ProfilePlugin | undefined {
  if (kind === 'eq') {
    perfilEq ??= {
      name: 'JasWave EQ',
      parameterCount: eqPerfilParametros().length,
      parameters: eqPerfilParametros() as ProfileParam[],
    }
    return perfilEq
  }
  return PROFILES.plugin[PERFIL_POR_TIPO[kind]]
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

/** Descriptor del FX JasWave del tipo indicado (plugin instalado por manifiesto), o undefined si falta. */
export function findJasWaveFxDescriptor(kind: FxKind): PluginDescriptor | undefined {
  const d =
    descriptorDePlugin(FX_PLUGIN_ID[kind]) ??
    pluginRegistry.findByName(FX_NOMBRE_POR_DEFECTO[kind]).find((x) => !!x.path)
  return d?.hostReady && d.path ? d : undefined
}

/** Ids de parámetro de una banda del EQ (1-based). */
export function eqBandParamIds(band1: number): {
  type: number
  freq: number
  gain: number
  q: number
  on: number
} {
  const slot = Math.max(1, Math.min(EQ_MAX_BANDAS, Math.round(band1))) - 1
  return {
    type: eqParamId(slot, 'type'),
    freq: eqParamId(slot, 'freq'),
    gain: eqParamId(slot, 'gain'),
    q: eqParamId(slot, 'q'),
    on: eqParamId(slot, 'enabled'),
  }
}

/** Tope de espera a que el host cargue el FX antes de ajustarlo. */
const ESPERA_CARGA_FX_MS = 15_000

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
  const isMaster = trackId === 'master' || trackId === '__master__'
  const cadena = () => {
    const st = tienda.obtenerEstado() as DAWState
    return isMaster ? (st.project.master.plugins ?? []) : (st.project.tracks.find((t) => t.id === trackId)?.plugins ?? [])
  }
  // «Asegurar» = reutilizar el que ya está: antes cada llamada (leer estado, ajustar una banda…)
  // insertaba otro EQ/compresor y se apilaban en la pista.
  const existente = cadena().find((p) => p.nombre === descriptor.name && !p.bypass)
  if (!existente) {
    const r = await tienda.executor.execute('plugin.insert', {
      trackId,
      plugin: descriptorToPluginInfo(descriptor),
    })
    if (!r.success) return null
  }
  const plugins = cadena()
  const inserted =
    existente ?? plugins.filter((p) => p.nombre === descriptor.name).pop() ?? plugins[plugins.length - 1]
  if (!inserted) return null
  // Se espera a que el host cargue el slot: sin esto los setParameter de justo después llegaban a un
  // slot inexistente y la IA veía «El host rechazó algún parámetro» (y leía el EQ vacío).
  const carga = ensureTrackVstPlugin(isMaster ? 'master' : trackId, {
    ...inserted,
    descripcion: inserted.descripcion ?? '',
  }).catch(() => false)
  await Promise.race([carga, new Promise((ok) => setTimeout(ok, ESPERA_CARGA_FX_MS))])
  return {
    slotId: slotIdForTrackPlugin(isMaster ? 'master' : trackId, inserted.id),
    descriptor,
  }
}

/** Resuelve un nombre del perfil ("Banda 3 Freq") o un id numérico al id de parámetro del VST. */
export function resolveParamId(kind: FxKind, nameOrId: string | number): number | undefined {
  if (typeof nameOrId === 'number') return Number.isFinite(nameOrId) ? nameOrId : undefined
  const texto = String(nameOrId).trim()
  if (/^\d+$/.test(texto)) return Number(texto)
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ')
  const p = profileFor(kind)?.parameters.find((q) => norm(q.name) === norm(texto))
  return p?.id
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
    // Antes solo se aceptaban ids numéricos y toda clave por nombre ("Banda 1 Freq") se descartaba en silencio.
    const id = resolveParamId(kind, rawId)
    if (id === undefined) { skipped.push(String(rawId)); continue }
    const n = normalizedFor(kind, id, value)
    if (n === undefined) { skipped.push(String(rawId)); continue }
    applied[id] = await setSlotParameter(ensured.slotId, id, n)
  }
  return { slotId: ensured.slotId, applied, skipped }
}


// ── EQ dinámico: estado, alta y baja de bandas (slots del VST) con auditoría ──────────────────

/** Lee del host las bandas USADAS del EQ (y los slots usados). */
export async function leerBandasEq(slotId: string): Promise<{ bandas: BandaEq[]; usados: number[]; leido: boolean }> {
  const params = await listSlotParameters(slotId)
  if (params.length === 0) return { bandas: [], usados: [], leido: false }
  const valores = new Map<number, number>()
  for (const p of params) {
    const id = Number(p.parameterId)
    if (Number.isFinite(id)) valores.set(id, Number(p.normalizedValue))
  }
  const bandas = eqAjustesABandas((id) => valores.get(id))
  return { bandas, usados: bandas.map((b) => b.slot!), leido: true }
}

/** Registra en el bus de eventos el cambio de EQ (auditoría): quién, qué banda, qué parámetro, antes → después. */
export function auditarCambiosEq(
  tienda: TiendaDAW,
  trackId: string,
  cambios: CambioEq[],
  origen: 'ia' | 'usuario',
): string[] {
  const resumen = eqResumenCambios(cambios)
  if (cambios.length === 0) return resumen
  tienda.busEventos.emit(EventosMezcla.eqCambiado, {
    trackId,
    origen,
    cambios,
    resumen,
  } as never)
  return resumen
}

export type ResultadoBandaEq = {
  ok: boolean
  slotId?: string
  slot?: number
  mensaje: string
  cambios: CambioEq[]
  bandas: BandaEq[]
}

/** Ajustes reales (Hz/dB/Q…) que la IA puede pedir para una banda; todos opcionales salvo al agregar. */
export type CambiosBandaEq = Partial<Pick<BandaEq, 'freq' | 'gain' | 'q' | 'enabled' | 'slope' | 'mode' | 'solo'>> & { type?: string }

/**
 * Valores de la IA a números dentro del rango del VST («200 Hz», "-3"); si algo queda fuera, un mensaje que
 * dice qué corregir (antes el host lo rechazaba y la IA solo veía «rechazó algún parámetro»).
 */
export function validarCambiosEq(cambios: CambiosBandaEq): { cambios: CambiosBandaEq } | { error: string } {
  const out: CambiosBandaEq = { ...cambios }
  const errores: string[] = []
  for (const campo of ['freq', 'gain', 'q'] as const) {
    const v = cambios[campo] as unknown
    if (v === undefined) continue
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v.replace(',', '.')) : NaN
    const r = EQ_RANGOS[campo]
    if (!Number.isFinite(n)) errores.push(`${campo} debe ser un número (${r.min} a ${r.max})`)
    else if (n < r.min || n > r.max) errores.push(`${campo} ${n} fuera de rango (${r.min} a ${r.max})`)
    else out[campo] = n
  }
  return errores.length ? { error: `Valores no válidos: ${errores.join('; ')}.` } : { cambios: out }
}

async function aplicarAjustes(slotId: string, ajustes: ReturnType<typeof eqBandasAAjustes>): Promise<boolean> {
  let todos = true
  for (const a of ajustes) todos = (await setSlotParameter(slotId, a.paramId, a.normalizado)) && todos
  return todos
}

/** Agrega una banda al EQ JasWave de la pista (primer slot libre) y la audita. `slot` fuerza el slot. */
export async function agregarBandaEq(
  tienda: TiendaDAW,
  trackId: string,
  cambios: CambiosBandaEq,
  opts: { slot?: number; origen?: 'ia' | 'usuario'; bandasAvanzadas?: boolean } = {},
): Promise<ResultadoBandaEq> {
  const val = validarCambiosEq(cambios)
  if ('error' in val) return { ok: false, mensaje: val.error, cambios: [], bandas: [] }
  cambios = val.cambios
  const ensured = await ensureJasWaveFxOnTrack(tienda, trackId, 'eq')
  if (!ensured) return { ok: false, mensaje: 'No se pudo insertar/cargar JasWave EQ', cambios: [], bandas: [] }
  const antes = await leerBandasEq(ensured.slotId)
  const slot = opts.slot ?? eqPrimerSlotLibre(antes.usados, opts.bandasAvanzadas ?? true)
  if (slot === undefined) {
    return {
      ok: false,
      slotId: ensured.slotId,
      mensaje: `El EQ ya tiene ${antes.usados.length} bandas: no quedan slots libres${opts.bandasAvanzadas === false ? ` (sin la licencia de bandas avanzadas el máximo es ${EQ_PRIMERA_BANDA_AVANZADA})` : ''}`,
      cambios: [],
      bandas: antes.bandas,
    }
  }
  if (antes.usados.includes(slot)) {
    return { ok: false, slotId: ensured.slotId, mensaje: `La banda ${slot + 1} ya existe: usa editar`, cambios: [], bandas: antes.bandas }
  }
  const tipo = cambios.type === undefined ? 'bell' : normalizarTipoEq(cambios.type)
  if (!tipo) return { ok: false, slotId: ensured.slotId, mensaje: `Tipo "${String(cambios.type)}" desconocido (bell, lowShelf, highShelf, lowCut, highCut, notch, bandPass)`, cambios: [], bandas: antes.bandas }
  const banda: BandaEq = {
    slot,
    type: tipo,
    freq: cambios.freq ?? eqFrecuenciaLibre(antes.bandas),
    gain: cambios.gain ?? 0,
    q: cambios.q ?? 1,
    enabled: cambios.enabled ?? true,
    ...(cambios.slope ? { slope: cambios.slope } : {}),
    mode: cambios.mode ?? 'stereo',
    solo: cambios.solo ?? false,
  }
  const ajustes = eqBandasAAjustes([banda])
  const ok = await aplicarAjustes(ensured.slotId, ajustes)
  const despues = [...antes.bandas, banda].sort((a, b) => a.slot! - b.slot!)
  const registro = eqDiferencias(antes.bandas, despues)
  auditarCambiosEq(tienda, trackId, registro, opts.origen ?? 'ia')
  return {
    ok,
    slotId: ensured.slotId,
    slot,
    mensaje: ok ? `Banda ${slot + 1} agregada (${tipo} ${Math.round(banda.freq)} Hz, ${banda.gain} dB, Q ${banda.q})` : 'El host rechazó algún parámetro de la banda',
    cambios: registro,
    bandas: despues,
  }
}

/** Da de baja una banda (slot) del EQ JasWave de la pista y lo audita. */
export async function quitarBandaEq(
  tienda: TiendaDAW,
  trackId: string,
  banda1: number,
  opts: { origen?: 'ia' | 'usuario' } = {},
): Promise<ResultadoBandaEq> {
  const ensured = await ensureJasWaveFxOnTrack(tienda, trackId, 'eq')
  if (!ensured) return { ok: false, mensaje: 'No se pudo insertar/cargar JasWave EQ', cambios: [], bandas: [] }
  const slot = Math.round(banda1) - 1
  const antes = await leerBandasEq(ensured.slotId)
  if (!antes.usados.includes(slot)) {
    return { ok: false, slotId: ensured.slotId, slot, mensaje: `La banda ${banda1} no existe (en uso: ${antes.usados.map((x) => x + 1).join(', ') || 'ninguna'})`, cambios: [], bandas: antes.bandas }
  }
  const ok =
    (await setSlotParameter(ensured.slotId, eqParamId(slot, 'solo'), 0)) &&
    (await setSlotParameter(ensured.slotId, eqParamId(slot, 'used'), 0))
  const despues = antes.bandas.filter((b) => b.slot !== slot)
  const registro = eqDiferencias(antes.bandas, despues)
  auditarCambiosEq(tienda, trackId, registro, opts.origen ?? 'ia')
  return { ok, slotId: ensured.slotId, slot, mensaje: ok ? `Banda ${banda1} quitada` : 'El host rechazó el cambio', cambios: registro, bandas: despues }
}

/** Edita una banda existente (solo los campos dados), con auditoría antes → después. */
export async function editarBandaEq(
  tienda: TiendaDAW,
  trackId: string,
  banda1: number,
  cambios: CambiosBandaEq,
  opts: { origen?: 'ia' | 'usuario' } = {},
): Promise<ResultadoBandaEq> {
  const val = validarCambiosEq(cambios)
  if ('error' in val) return { ok: false, mensaje: val.error, cambios: [], bandas: [] }
  cambios = val.cambios
  const ensured = await ensureJasWaveFxOnTrack(tienda, trackId, 'eq')
  if (!ensured) return { ok: false, mensaje: 'No se pudo insertar/cargar JasWave EQ', cambios: [], bandas: [] }
  const slot = Math.round(banda1) - 1
  const antes = await leerBandasEq(ensured.slotId)
  const actual = antes.bandas.find((b) => b.slot === slot)
  if (!actual) {
    return { ok: false, slotId: ensured.slotId, slot, mensaje: `La banda ${banda1} no existe (en uso: ${antes.usados.map((x) => x + 1).join(', ') || 'ninguna'}); usa agregarBanda`, cambios: [], bandas: antes.bandas }
  }
  const tipo = cambios.type === undefined ? actual.type : normalizarTipoEq(cambios.type)
  if (!tipo) return { ok: false, slotId: ensured.slotId, slot, mensaje: `Tipo "${String(cambios.type)}" desconocido`, cambios: [], bandas: antes.bandas }
  const { type: _t, ...resto } = cambios
  const nueva: BandaEq = { ...actual, ...resto, type: tipo }
  if (cambios.slope === undefined && 'slope' in cambios) delete nueva.slope
  const ajustes = eqBandasAAjustes([nueva]).filter((a) => a.campo !== 'used')
  const ok = await aplicarAjustes(ensured.slotId, ajustes)
  const despues = antes.bandas.map((b) => (b.slot === slot ? nueva : b))
  const registro = eqDiferencias(antes.bandas, despues)
  auditarCambiosEq(tienda, trackId, registro, opts.origen ?? 'ia')
  return { ok, slotId: ensured.slotId, slot, mensaje: ok ? `Banda ${banda1} actualizada` : 'El host rechazó algún parámetro', cambios: registro, bandas: despues }
}

/** Estado actual del EQ para la IA: bandas en uso con valores reales. */
export async function estadoEq(
  tienda: TiendaDAW,
  trackId: string,
): Promise<{ ok: boolean; slotId?: string; bandas: BandaEq[]; mensaje: string }> {
  const ensured = await ensureJasWaveFxOnTrack(tienda, trackId, 'eq')
  if (!ensured) return { ok: false, bandas: [], mensaje: 'No se pudo insertar/cargar JasWave EQ' }
  const { bandas, leido } = await leerBandasEq(ensured.slotId)
  return {
    ok: leido,
    slotId: ensured.slotId,
    bandas,
    mensaje: leido ? `${bandas.length} banda(s) en uso de ${EQ_MAX_BANDAS}` : 'El host no devolvió los parámetros del EQ',
  }
}

export { eqNombreParametro, eqValorANormalizado }
