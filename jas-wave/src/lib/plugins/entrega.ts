/**
 * Entrega bajo demanda de plugins JasWave (D1, V5 §4.5 y §6.2): al abrir un proyecto se detectan los
 * plugins JasWave que usa y no están instalados, se instalan en segundo plano (sin bloquear la
 * reproducción) y se cargan en caliente.
 */

import type { DAWState } from '../../../../shared/src/types/state'
import type { PluginInfo } from '../../../../shared/src/types/entidades'
import { cargarPluginsInstalados, pluginsActivos } from './registro-plugins'

export type EntradaCatalogoPlugin = { id: string; nombre: string; version: string; url: string; sha256: string; sizeBytes: number }
export type CatalogoPlugins = { generadoEn: string; paquetes: EntradaCatalogoPlugin[] }
export type ProgresoPlugin = {
  id: string
  fase: 'descargando' | 'verificando' | 'instalando' | 'listo' | 'error' | string
  recibidos?: number
  total?: number
  mensaje?: string
}

/** Nombres con los que un proyecto puede referirse a cada plugin (incluidos los de JasWaveFx). */
const NOMBRES_HEREDADOS: ReadonlyArray<[RegExp, string]> = [
  [/^jaswave\s*eq$/i, 'com.jaswave.plugin.param-eq'],
  [/^jaswave\s*compresor$/i, 'com.jaswave.plugin.bus-compressor'],
  [/^jaswave\s*limitador$/i, 'com.jaswave.plugin.truepeak-limiter'],
  [/^jaswave\s*utility$/i, 'com.jaswave.plugin.utility-tool'],
  [/^jaswave\s*de-?esser$/i, 'com.jaswave.plugin.smart-deesser'],
  [/^jaswave\s*piano/i, 'com.jaswave.plugin.piano-synth'],
  [/^jaswave\s*roles$/i, 'com.jaswave.plugin.roles-vst'],
]

/** Id del plugin JasWave al que corresponde una instancia del proyecto (o null si no es JasWave). */
export function idPluginDeInstancia(p: Pick<PluginInfo, 'nombre'>, catalogo: CatalogoPlugins): string | null {
  const nombre = (p.nombre ?? '').trim()
  if (!nombre) return null
  const porCatalogo = catalogo.paquetes.find((e) => e.nombre.toLowerCase() === nombre.toLowerCase())
  if (porCatalogo) return porCatalogo.id
  return NOMBRES_HEREDADOS.find(([re]) => re.test(nombre))?.[1] ?? null
}

/** Paquetes del catálogo que el proyecto necesita y que no están instalados con binario disponible. */
export function pluginsFaltantes(estado: Pick<DAWState, 'project'>, catalogo: CatalogoPlugins): EntradaCatalogoPlugin[] {
  const instalados = new Set(pluginsActivos().filter((p) => p.rutaDsp).map((p) => p.manifiesto.id))
  const instancias = [
    ...(estado.project.tracks ?? []).flatMap((t) => t.plugins ?? []),
    ...(estado.project.master?.plugins ?? []),
  ]
  const necesarios = new Set<string>()
  for (const inst of instancias) {
    const id = idPluginDeInstancia(inst, catalogo)
    if (id && !instalados.has(id)) necesarios.add(id)
  }
  return catalogo.paquetes.filter((e) => necesarios.has(e.id))
}

/** Hay actualización si el catálogo trae una versión distinta a la instalada. */
export function versionInstalada(id: string): string | null {
  return pluginsActivos().find((p) => p.manifiesto.id === id)?.manifiesto.version ?? null
}

export type PuertoEntrega = {
  instalar: (id: string) => Promise<{ ok: boolean; version?: string; error?: string }>
  /** Recarga paquetes y vuelve a intentar cargar los VST del proyecto (en caliente). */
  recargar: () => Promise<void>
}

/** Instala en serie (un paquete a la vez, ancho de banda y disco moderados) y recarga al final. */
export async function instalarPlugins(ids: string[], puerto: PuertoEntrega): Promise<Record<string, { ok: boolean; error?: string }>> {
  const resultado: Record<string, { ok: boolean; error?: string }> = {}
  for (const id of ids) {
    const r = await puerto.instalar(id).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    resultado[id] = r.ok ? { ok: true } : { ok: false, ...(r.error ? { error: r.error } : {}) }
  }
  if (Object.values(resultado).some((r) => r.ok)) await puerto.recargar()
  return resultado
}

/** Puerto de escritorio: instala por IPC y recarga paquetes + VST del proyecto. */
export function puertoEntregaEscritorio(apiBase: string, recargarProyecto: () => Promise<void>): PuertoEntrega | null {
  const e = typeof window !== 'undefined' ? window.electron : undefined
  if (!e?.pluginsInstalar) return null
  return {
    instalar: (id) => e.pluginsInstalar!(apiBase, id),
    recargar: async () => {
      await cargarPluginsInstalados()
      await recargarProyecto()
    },
  }
}
