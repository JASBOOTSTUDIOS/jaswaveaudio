/**
 * Disposición responsiva de la réplica (V3 §4.5):
 *   ≥ 1024 px  completo   — el editor entero en 16:9, como en escritorio;
 *   640–1023   compacto   — el editor entero, escalado (áreas táctiles ampliadas);
 *   < 640 px   pestañas   — ESPECTRO · CONTROLES · MEDICIÓN, cada zona a todo el ancho.
 * Todo se calcula en unidades de diseño (1100×620) y se escala al tamaño CSS del lienzo.
 */

import type { Rect4, UiLayout, WidgetLayout } from './tipos'

export type Modo = 'completo' | 'compacto' | 'pestanas'
export type Pestana = 'espectro' | 'controles' | 'medicion'

export const PESTANAS: { id: Pestana; titulo: string }[] = [
  { id: 'espectro', titulo: 'ESPECTRO' },
  { id: 'controles', titulo: 'CONTROLES' },
  { id: 'medicion', titulo: 'MEDICIÓN' },
]

export const modoPorAncho = (anchoCss: number): Modo => (anchoCss >= 1024 ? 'completo' : anchoCss >= 640 ? 'compacto' : 'pestanas')

const margen = (r: Rect4, m: number): Rect4 => [r[0] - m, r[1] - m, r[2] + m, r[3] + m]

/** Región del diseño que se ve en cada modo / pestaña. */
export function vistaDe(layout: UiLayout, modo: Modo, pestana: Pestana = 'espectro'): Rect4 {
  if (modo !== 'pestanas') return [0, 0, layout.base.ancho, layout.base.alto]
  const z = layout.zonas
  if (pestana === 'controles') return margen([z.controles[0], z.controles[1], z.salida[2], z.salida[3]], 8)
  if (pestana === 'medicion') return margen(z.miniPanel, 8)
  return margen(z.visualizador, 8)
}

export const anchoDe = (r: Rect4) => r[2] - r[0]
export const altoDe = (r: Rect4) => r[3] - r[1]
export const contiene = (r: Rect4, x: number, y: number, m = 0) => x >= r[0] - m && x <= r[2] + m && y >= r[1] - m && y <= r[3] + m

/** Escala de diseño → CSS para que la vista ocupe el ancho disponible (y quepa en el alto, si se da). */
export function escalaPara(vista: Rect4, anchoCss: number, altoCss?: number): number {
  const s = anchoCss / anchoDe(vista)
  return altoCss ? Math.min(s, altoCss / altoDe(vista)) : s
}

/** Píldora de una sección (como Section::pillRect en shared-ui). */
export const pildora = (w: WidgetLayout): Rect4 => [w.rect[2] - 36, w.rect[1] + 9, w.rect[2] - 12, w.rect[1] + 17]

/** Área sensible de un widget: la píldora en las secciones, el rectángulo en el resto (medidores no). */
export function areaSensible(w: WidgetLayout): Rect4 | null {
  if (w.tipo === 'section') return w.param !== undefined ? margen(pildora(w), 6) : null
  if (w.tipo === 'meter' || w.param === undefined) return null
  return w.rect
}

/**
 * Widget bajo el puntero. Con `minimoTactil` (px de diseño), un toque cerca de un control pequeño
 * lo alcanza aunque caiga fuera de su rectángulo (44 px mínimos, V3 §4.5).
 */
export function widgetEn(layout: UiLayout, x: number, y: number, minimoTactil = 0): WidgetLayout | null {
  for (let i = layout.widgets.length - 1; i >= 0; i--) {
    const w = layout.widgets[i]!
    const a = areaSensible(w)
    if (a && contiene(a, x, y)) return w
  }
  if (minimoTactil <= 0) return null
  let mejor: WidgetLayout | null = null
  let dMejor = Infinity
  for (const w of layout.widgets) {
    const a = areaSensible(w)
    if (!a) continue
    const mx = Math.max(0, (minimoTactil - anchoDe(a)) / 2)
    const my = Math.max(0, (minimoTactil - altoDe(a)) / 2)
    if (x < a[0] - mx || x > a[2] + mx || y < a[1] - my || y > a[3] + my) continue
    const d = Math.abs((a[0] + a[2]) / 2 - x) + Math.abs((a[1] + a[3]) / 2 - y)
    if (d < dMejor) {
      dMejor = d
      mejor = w
    }
  }
  return mejor
}
