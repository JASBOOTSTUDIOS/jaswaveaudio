import { TOOL_CATALOG, type ToolId } from '../workspace/types'
import { herramientaDisponible } from './registro-modulos'

/** Herramientas que se pueden listar en menús: núcleo + las de módulos activos. */
export function herramientasDisponibles(): ToolId[] {
  return (Object.keys(TOOL_CATALOG) as ToolId[]).filter(herramientaDisponible)
}
