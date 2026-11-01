/**
 * Abrir pantallas por id (U-maestra F4). Solo cambia la interfaz; nunca el proyecto.
 * Tabla del plan §1: T = requestOpenTool, M = jaswave-menu-action, E = evento propio.
 * Las vías M/E de la tabla son exclusivamente de abrir diálogos (nada de guardar/cerrar/borrar).
 */
import { requestOpenTool } from '../workspace/types'

export type ViaApertura =
  | { via: 'T'; toolId: string }
  | { via: 'M'; menuId: string }
  | { via: 'E'; evento: string }

const HERRAMIENTAS = [
  'arrange', 'mixer', 'library', 'track-detail', 'meters', 'routing', 'instruments', 'fx-chain', 'automation',
  'plugin-editor', 'midi-map', 'midi-zones', 'grooves', 'piano-roll', 'terminal', 'settings', 'project-files',
  'cuenta', 'modulos', 'coproducer', 'progress', 'banda-virtual', 'docs', 'docs-explorer', 'midi-md', 'score-editor',
] as const

const DIALOGOS: Record<string, ViaApertura> = {
  'dlg.nuevo-proyecto': { via: 'E', evento: 'jaswave-nuevo-proyecto' },
  'dlg.abrir-proyecto': { via: 'M', menuId: 'proyecto.abrir' },
  'dlg.exportar-bounce': { via: 'M', menuId: 'archivo.exportarBounce' },
  'dlg.atajos': { via: 'E', evento: 'open-shortcuts-dialog' },
  'dlg.paleta': { via: 'M', menuId: 'ventana.paletaComandos' },
  'dlg.ajustes-proyecto': { via: 'E', evento: 'open-project-settings' },
  'dlg.midi-map': { via: 'M', menuId: 'ventana.midiMap' },
  'dlg.exportar-partituras': { via: 'M', menuId: 'archivo.exportarPartituras' },
}

export function resolverPantalla(idEntrada: unknown): ViaApertura | null {
  if (typeof idEntrada !== 'string') return null
  const id = idEntrada.startsWith('panel:') ? idEntrada.slice(6) : idEntrada
  if ((HERRAMIENTAS as readonly string[]).includes(id)) return { via: 'T', toolId: id }
  return Object.prototype.hasOwnProperty.call(DIALOGOS, id) ? DIALOGOS[id] : null
}

export function listarPantallasAbribles(): string[] {
  return [...HERRAMIENTAS, ...Object.keys(DIALOGOS)]
}

export interface EfectosApertura {
  abrirHerramienta: (toolId: string) => void
  despachar: (nombre: string, detalle?: unknown) => void
}

function efectosReales(): EfectosApertura {
  return {
    abrirHerramienta: (t) => requestOpenTool(t),
    despachar: (n, d) => window.dispatchEvent(d === undefined ? new Event(n) : new CustomEvent(n, { detail: d })),
  }
}

export interface ResultadoAbrir {
  abierto: boolean
  motivo: string
}

export function abrirPantalla(id: unknown, efectos?: EfectosApertura): ResultadoAbrir {
  const v = resolverPantalla(id)
  if (!v) {
    return { abierto: false, motivo: 'No puedo abrir esa pantalla por código; indica dónde está en el menú y ofrece resaltarla.' }
  }
  const ef = efectos ?? efectosReales()
  if (v.via === 'T') ef.abrirHerramienta(v.toolId)
  else if (v.via === 'M') ef.despachar('jaswave-menu-action', { id: v.menuId })
  else ef.despachar(v.evento)
  return { abierto: true, motivo: 'ok' }
}
