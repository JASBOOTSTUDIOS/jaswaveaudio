/**
 * Discovery de candidatos VST3 (filesystem / host process).
 * Discovery ≠ Load (ADR-0011).
 */

import { persistPluginCatalog } from './catalog-store'
import { isolationForFormat } from './isolation-policy'
import { guessIsInstrument, VST2_NOT_HOSTED_MSG } from './plugin-info-adapter'
import { pluginRegistry } from './registry'
import { expandPluginSearchPath, pluginSearchPaths } from './search-paths'
import { bundleJasWave, esRutaJasWave, nombreBase, normalizarRuta, prioridadDeRutaJasWave } from './rutas-jaswave'
export { prioridadDeRutaJasWave } from './rutas-jaswave'
import type { PluginDescriptor, PluginHostDiscoveredPlugin } from './types'

function hashId(pathStr: string, format: PluginDescriptor['format'] = 'vst3'): string {
  let h = 2166136261
  for (let i = 0; i < pathStr.length; i++) {
    h ^= pathStr.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `${format}.${(h >>> 0).toString(16)}`
}

function discoveredFormat(item: PluginHostDiscoveredPlugin): PluginDescriptor['format'] {
  const raw = (item.format || '').toLowerCase()
  if (raw === 'vst2') return 'vst2'
  if (raw === 'vst3') return 'vst3'
  const p = item.path || ''
  if (/\.dll$/i.test(p)) return 'vst2'
  return 'vst3'
}

export function catalogPluginInsertable(d: Pick<PluginDescriptor, 'format' | 'hostReady'>): boolean {
  return d.format === 'vst3' && Boolean(d.hostReady)
}

export function descriptorFromDiscovered(
  item: PluginHostDiscoveredPlugin,
  vendor = '—',
): PluginDescriptor {
  const pluginPath = item.path
  const format = discoveredFormat(item)
  const isVst2 = format === 'vst2' || /\.dll$/i.test(pluginPath)
  const propio = bundleJasWave(pluginPath)
  // En los propios manda el nombre comercial: el host devuelve el del archivo («JasWaveGrandPiano»).
  const name =
    propio?.nombre ||
    item.name ||
    pluginPath.replace(/^.*[/\\]/, '').replace(/\.(vst3|dll)$/i, '')
  const isInstrument = propio ? propio.instrumento : guessIsInstrument(name, pluginPath)
  // VST2 está descontinuado: nunca se marca hostReady para prevenir inestabilidad de audio/proceso.
  const hostReady = !isVst2 && item.hostReady === true
  return {
    pluginId: hashId(pluginPath, format),
    format,
    vendor,
    name,
    version: 'unknown',
    path: pluginPath,
    category: isInstrument ? 'instrumento' : 'efecto',
    isInstrument,
    isEffect: !isInstrument,
    supportsMidiInput: isInstrument,
    supportsMidiOutput: false,
    supportsAudioInput: !isInstrument,
    supportsAudioOutput: true,
    supportsSidechain: false,
    supportsEditor: hostReady && item.editorReady !== false,
    parameterCount: 0,
    scanStatus: isVst2 ? 'blacklisted' : 'ok',
    hostReady,
    isolation: isolationForFormat(format),
    scanError: isVst2
      ? VST2_NOT_HOSTED_MSG
      : hostReady
        ? undefined
        : 'En catálogo (disco). Audio pendiente; UI nativa si editorhost está compilado.',
  }
}

/**
 * Deja una sola copia por ruta (sin distinguir mayúsculas ni tipo de barra) y, para los plugins `JasWave*`
 * repetidos en varias carpetas, la de mejor prioridad.
 */
export function elegirCopiasDelCatalogo(items: PluginHostDiscoveredPlugin[]): PluginHostDiscoveredPlugin[] {
  const vistas = new Set<string>()
  const unicas: PluginHostDiscoveredPlugin[] = []
  for (const it of items) {
    const k = normalizarRuta(it.path)
    if (vistas.has(k)) continue
    vistas.add(k)
    unicas.push(it)
  }
  const mejorPorNombre = new Map<string, PluginHostDiscoveredPlugin>()
  for (const it of unicas) {
    const base = nombreBase(normalizarRuta(it.path))
    if (!esRutaJasWave(it.path)) continue
    const prev = mejorPorNombre.get(base)
    if (!prev || prioridadDeRutaJasWave(it.path) < prioridadDeRutaJasWave(prev.path)) mejorPorNombre.set(base, it)
  }
  return unicas.filter((it) => {
    const base = nombreBase(normalizarRuta(it.path))
    if (!esRutaJasWave(it.path)) return true
    return mejorPorNombre.get(base) === it
  })
}

export type DiscoverResult = {
  discovered: PluginDescriptor[]
  registered: number
  backend?: string
  error?: string
}

/**
 * Usa el host process (via callback RPC) para listar .vst3 y .dll (VST2) en rutas habilitadas.
 */
export async function discoverVst3Plugins(
  rpc: (cmd: { type: 'discover'; path: string }) => Promise<{
    ok: boolean
    plugins?: PluginHostDiscoveredPlugin[]
    message?: string
    processId?: string
  }>,
  paths?: string[],
): Promise<DiscoverResult> {
  const roots = paths?.length
    ? paths.map(expandPluginSearchPath)
    : pluginSearchPaths.enabledExpandedPaths()

  const hallados: PluginHostDiscoveredPlugin[] = []
  let lastError: string | undefined

  for (const root of roots) {
    if (!root?.trim()) continue
    const reply = await rpc({ type: 'discover', path: root })
    if (!reply.ok) {
      lastError = reply.message
      continue
    }
    for (const item of reply.plugins ?? []) {
      if (item.path) hallados.push(item)
    }
  }

  const discovered: PluginDescriptor[] = []
  for (const item of elegirCopiasDelCatalogo(hallados)) {
    const desc = descriptorFromDiscovered(item)
    discovered.push(desc)
    // El mismo archivo ya registrado con otro id (manifiesto del plugin, Piano/Roles): no se duplica en el catálogo.
    const ruta = normalizarRuta(desc.path ?? '')
    const yaEsta = pluginRegistry.list().some((d) => d.pluginId !== desc.pluginId && !!d.path && normalizarRuta(d.path) === ruta)
    if (!yaEsta) pluginRegistry.register(desc)
  }
  // El catálogo se persiste y las copias antiguas (p. ej. la compilación de desarrollo ya superada por una
  // instalación nueva) seguían en él para siempre: se podan las de plugins propios que perdieron la elección.
  const elegidas = new Set(discovered.map((d) => normalizarRuta(d.path ?? '')))
  for (const d of pluginRegistry.list()) {
    if (d.path && esRutaJasWave(d.path) && !elegidas.has(normalizarRuta(d.path))) pluginRegistry.unregister(d.pluginId)
  }

  persistPluginCatalog(discovered)

  return {
    discovered,
    registered: discovered.length,
    error: discovered.length === 0 ? lastError : undefined,
  }
}
