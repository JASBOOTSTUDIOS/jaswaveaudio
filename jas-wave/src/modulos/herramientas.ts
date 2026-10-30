import { TOOL_CATALOG, type ToolId } from '../workspace/types'

/** Herramientas que se pueden listar en menús: núcleo + las de módulos activos y cargados. */
export function herramientasDisponibles(): ToolId[] {
  return Object.keys(TOOL_CATALOG) as ToolId[]
}
