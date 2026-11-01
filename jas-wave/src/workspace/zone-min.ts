/**
 * Tamaño mínimo de las zonas acopladas: el divisor no deja una zona más pequeña que el mínimo de la herramienta
 * activa (p. ej. el mixer no baja de su fader fijo). Así el panel nunca necesita scroll interno.
 * `react-resizable-panels` trabaja en %, por eso se convierte de px al % del grupo.
 */
import { tamanoMinimoHerramienta, type ToolId } from './types'

/** Alto de la barra de pestañas de una zona (h-8) + bordes. */
export const ALTO_PESTANAS_ZONA = 34

/** Mínimo en px de una zona con `toolId` activo, en el eje del divisor. */
export function minimoZonaPx(toolId: ToolId | null | undefined, eje: 'w' | 'h'): number {
  if (!toolId) return 0
  const min = tamanoMinimoHerramienta(toolId)
  return eje === 'h' ? min.h + ALTO_PESTANAS_ZONA : min.w
}

/**
 * px → % del grupo, entre `base` (el mínimo de siempre) y `tope` (lo máximo que se puede reservar sin dejar
 * sin sitio a las demás zonas). Sin medida aún (grupo de 0 px) devuelve `base`.
 */
export function minimoPorcentaje(px: number, totalPx: number, base: number, tope: number): number {
  if (!(totalPx > 0) || !(px > 0)) return base
  const pct = (px / totalPx) * 100
  return Math.round(Math.min(Math.max(base, tope), Math.max(base, pct)) * 100) / 100
}
