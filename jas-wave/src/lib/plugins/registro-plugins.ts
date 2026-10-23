/**
 * Plugins JasWave activos en el renderer (P1/P2).
 *
 * Recibe los paquetes que encontró el proceso main (o el catálogo web), valida cada manifiesto con
 * el esquema V5 de @jaswave/shared, descarta los alterados y registra sus herramientas de IA en el
 * registro dinámico de @jaswave/ai-harness. También traduce las llamadas `plugin.<alias>.*` del
 * agente a comandos del DAW, que luego pasan por la misma puerta de seguridad que cualquier acción.
 */

import { registroHerramientasPlugins } from '@jaswave/ai-harness'
import {
  aliasPlugin,
  describirPlugin,
  herramientasDesdeManifiesto,
  traducirAjuste,
  validarManifiesto,
  type ManifiestoPlugin,
} from '@jaswave/shared'
import { pluginRegistry } from '../plugin/registry'
import type { PluginDescriptor } from '../plugin/types'

export type PaqueteRecibido = {
  dir: string
  manifiesto: unknown
  integridad: 'verificada' | 'alterada' | 'sin-registro'
  discrepancias?: string[]
  errores?: string[]
  /** Ruta del binario VST3 resuelta por el proceso main (paquete o carpeta VST3). */
  rutaDsp?: string
}

export type PluginActivo = {
  manifiesto: ManifiestoPlugin
  dir: string
  integridad: 'verificada' | 'sin-registro'
  rutaDsp?: string
}

/** Id del catálogo del DAW para un plugin JasWave (estable: deriva del id del manifiesto). */
export function idCatalogo(m: Pick<ManifiestoPlugin, 'id'>): string {
  return `jaswave:${m.id}`
}

/** Descriptor del catálogo del DAW construido a partir del manifiesto (K1: sin nombres fijos en el núcleo). */
export function descriptorDesdeManifiesto(m: ManifiestoPlugin, rutaDsp: string): PluginDescriptor {
  const instrumento = m.category === 'instrument' || m.category === 'instrument-bundle'
  return {
    pluginId: idCatalogo(m),
    format: 'vst3',
    vendor: m.vendor,
    name: m.name,
    version: m.version,
    ...(m.vst3?.classId ? { uniqueId: m.vst3.classId } : {}),
    path: rutaDsp,
    architecture: 'x64',
    category: instrumento ? 'instrumento' : 'efecto',
    isInstrument: instrumento,
    isEffect: !instrumento,
    supportsMidiInput: instrumento,
    supportsMidiOutput: false,
    supportsAudioInput: !instrumento,
    supportsAudioOutput: true,
    supportsSidechain: /sidechain|sc-?hpf|filtro-sc/i.test(JSON.stringify(m.ai?.parameters ?? [])),
    supportsEditor: true,
    parameterCount: m.ai?.parameters.length ?? 0,
    scanStatus: 'ok',
    hostReady: true,
    isolation: 'out-of-process',
  }
}

export type PluginRechazado = { dir: string; motivo: string }

const activos = new Map<string, PluginActivo>()
const porAlias = new Map<string, string>()

/**
 * Acciones de licencia concedidas por producto (las aporta la sesión de licencias, L3).
 * `undefined` = sin información de licencia: no se filtra (el propio VST aplica su licencia).
 */
let accionesConcedidas: (productId: string) => readonly string[] | undefined = () => undefined

export function configurarLicenciasPlugins(fn: (productId: string) => readonly string[] | undefined): void {
  accionesConcedidas = fn
}

/** Sustituye el conjunto de plugins activos y re-registra sus herramientas. */
export function activarPaquetes(paquetes: PaqueteRecibido[]): { activos: PluginActivo[]; rechazados: PluginRechazado[] } {
  const rechazados: PluginRechazado[] = []
  const nuevos = new Map<string, PluginActivo>()
  for (const p of paquetes) {
    if (p.errores?.length) {
      rechazados.push({ dir: p.dir, motivo: p.errores.join('; ') })
      continue
    }
    if (p.integridad === 'alterada') {
      rechazados.push({ dir: p.dir, motivo: `integridad alterada: ${(p.discrepancias ?? []).join(', ') || 'registro inválido'}` })
      continue
    }
    const r = validarManifiesto(p.manifiesto)
    if (!r.ok) {
      rechazados.push({ dir: p.dir, motivo: `manifiesto inválido: ${r.errores.slice(0, 3).join(' · ')}` })
      continue
    }
    if (nuevos.has(r.manifiesto.id)) {
      rechazados.push({ dir: p.dir, motivo: `id duplicado: ${r.manifiesto.id}` })
      continue
    }
    nuevos.set(r.manifiesto.id, { manifiesto: r.manifiesto, dir: p.dir, integridad: p.integridad, ...(p.rutaDsp ? { rutaDsp: p.rutaDsp } : {}) })
  }

  for (const [id, previo] of activos) {
    if (nuevos.has(id)) continue
    registroHerramientasPlugins.quitar(id)
    pluginRegistry.unregister(idCatalogo(previo.manifiesto))
  }
  activos.clear()
  porAlias.clear()
  for (const [id, plugin] of nuevos) {
    const m = plugin.manifiesto
    try {
      registroHerramientasPlugins.registrar({
        pluginId: m.id,
        alias: aliasPlugin(m),
        permisos: { fileSystem: m.permissions.fileSystem, network: m.permissions.network },
        rolesAllowed: m.rolesAllowed,
        herramientas: herramientasDesdeManifiesto(m),
      })
    } catch (e) {
      rechazados.push({ dir: plugin.dir, motivo: e instanceof Error ? e.message : String(e) })
      continue
    }
    activos.set(id, plugin)
    porAlias.set(aliasPlugin(m), id)
    if (plugin.rutaDsp && m.entrypoints.dspDesktop) {
      // Las entradas heredadas (registro manual de Roles/Piano) se sustituyen por la del manifiesto.
      for (const previo of pluginRegistry.findByName(m.name)) {
        if (previo.pluginId !== idCatalogo(m)) pluginRegistry.unregister(previo.pluginId)
      }
      pluginRegistry.register(descriptorDesdeManifiesto(m, plugin.rutaDsp))
    }
  }
  return { activos: [...activos.values()], rechazados }
}

/** Da de baja un plugin (cuarentena o desinstalación): sus herramientas desaparecen del agente. */
export function desactivarPlugin(pluginId: string): void {
  if (!activos.has(pluginId)) return
  registroHerramientasPlugins.quitar(pluginId)
  pluginRegistry.unregister(idCatalogo(activos.get(pluginId)!.manifiesto))
  const alias = aliasPlugin(activos.get(pluginId)!.manifiesto)
  porAlias.delete(alias)
  activos.delete(pluginId)
}

export function pluginsActivos(): PluginActivo[] {
  return [...activos.values()]
}

/** Plugin JasWave activo cuyo binario está en `ruta` (comparación sin distinguir mayúsculas ni barras). */
export function pluginPorRuta(ruta: string): PluginActivo | undefined {
  const norm = (r: string) => r.replace(/\\/g, '/').toLowerCase()
  return [...activos.values()].find((p) => p.rutaDsp && norm(p.rutaDsp) === norm(ruta))
}

/** Descriptor del catálogo de un plugin JasWave activo (si su binario está disponible). */
export function descriptorDePlugin(pluginId: string): PluginDescriptor | undefined {
  const p = activos.get(pluginId)
  return p ? pluginRegistry.findById(idCatalogo(p.manifiesto)) : undefined
}

export function esHerramientaDePlugin(nombre: string): boolean {
  return registroHerramientasPlugins.obtener(nombre) !== undefined
}

/** Plan de ejecución de una llamada del agente a una herramienta de plugin. */
export type PlanHerramientaPlugin =
  | { tipo: 'respuesta'; data: unknown }
  | { tipo: 'comandos'; llamadas: { tool: string; arguments: Record<string, unknown> }[] }

/** Traduce una llamada `plugin.<alias>.<accion>`; lanza si no es válida (el host la devuelve como error). */
export function planificarHerramientaPlugin(nombre: string, args: Record<string, unknown>): PlanHerramientaPlugin {
  const [, alias, accion] = nombre.split('.')
  const id = alias ? porAlias.get(alias) : undefined
  const plugin = id ? activos.get(id) : undefined
  if (!plugin || !esHerramientaDePlugin(nombre)) throw new Error(`herramienta de plugin no disponible: ${nombre}`)
  const m = plugin.manifiesto
  const concedidas = accionesConcedidas(m.license?.productId ?? m.id)
  if (accion === 'describir') return { tipo: 'respuesta', data: describirPlugin(m, concedidas) }
  if (accion === 'ajustar') {
    const valores = args.valores
    if (typeof args.trackId !== 'string' || typeof args.pluginInstanceId !== 'string' || !valores || typeof valores !== 'object') {
      throw new Error('ajustar requiere trackId, pluginInstanceId y valores')
    }
    const comandos = traducirAjuste(
      m,
      { trackId: args.trackId, pluginInstanceId: args.pluginInstanceId, valores: valores as Record<string, number> },
      concedidas,
    )
    return { tipo: 'comandos', llamadas: comandos.map((c) => ({ tool: c.type, arguments: c.payload })) }
  }
  throw new Error(`acción desconocida: ${nombre}`)
}

/** Solo para pruebas: vacía el estado del módulo. */
export function _reiniciarPluginsParaPruebas(): void {
  for (const [id, p] of activos) {
    registroHerramientasPlugins.quitar(id)
    pluginRegistry.unregister(idCatalogo(p.manifiesto))
  }
  activos.clear()
  porAlias.clear()
  accionesConcedidas = () => undefined
}

/** Pide al proceso main los paquetes instalados y los activa (se llama al arrancar y tras instalar). */
export async function cargarPluginsInstalados(
  listar: (() => Promise<PaqueteRecibido[]>) | undefined = typeof window !== 'undefined' ? window.electron?.pluginsListar : undefined,
): Promise<{ activos: PluginActivo[]; rechazados: PluginRechazado[] }> {
  if (!listar) return { activos: [], rechazados: [] }
  const resultado = activarPaquetes(await listar())
  for (const r of resultado.rechazados) console.warn(`[plugins] paquete rechazado (${r.dir}): ${r.motivo}`)
  return resultado
}
