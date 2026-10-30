/**
 * Disposición responsiva de la réplica (V3 §4.5):
 *   ≥ 1024 px  completo   — el editor entero en 16:9, como en escritorio;
 *   640–1023   compacto   — el editor entero, escalado (áreas táctiles ampliadas);
 *   < 640 px   pestañas   — ESPECTRO · CONTROLES · MEDICIÓN, cada zona a todo el ancho.
 * Todo se calcula en unidades de diseño (1100×620) y se escala al tamaño CSS del lienzo.
 */

import { PESTANAS_FX } from './fxrack'
import type { ModoEditor, Rect4, UiLayout, WidgetLayout } from './tipos'

export type Modo = 'completo' | 'compacto' | 'pestanas'
export type Pestana = 'espectro' | 'controles' | 'medicion'

export const PESTANAS: { id: Pestana; titulo: string }[] = [
  { id: 'espectro', titulo: 'ESPECTRO' },
  { id: 'controles', titulo: 'CONTROLES' },
  { id: 'medicion', titulo: 'MEDICIÓN' },
]

export const modoPorAncho = (anchoCss: number): Modo => (anchoCss >= 1024 ? 'completo' : anchoCss >= 640 ? 'compacto' : 'pestanas')

const margen = (r: Rect4, m: number): Rect4 => [r[0] - m, r[1] - m, r[2] + m, r[3] + m]

/** Región del diseño que se ve en cada modo / pestaña. `pagina` 1 = MIX / FX (pestañas EQ · DINÁMICA · EFECTOS). */
export function vistaDe(layout: UiLayout, modo: Modo, pestana: Pestana = 'espectro', pagina = 0): Rect4 {
  if (modo !== 'pestanas') return [0, 0, layout.base.ancho, layout.base.alto]
  if (pagina === 1) return margen(PESTANAS_FX.find((p) => p.id === pestana)!.zona, 8)
  const z = layout.zonas
  if (pagina === 2) return margen([z.visualizador[0], z.visualizador[1], z.salida[2], z.salida[3]], 8)
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

/**
 * ¿Se dibuja el widget en la página activa? RESET y el selector BÁSICO | AVANZADO están en todas; cada botón de página,
 * en el editor y en su propia página (las dos páginas extra no coexisten, como en el VST nativo).
 */
export const visibleEnPagina = (w: WidgetLayout, pagina: number): boolean => {
  if (w.tipo === 'reset' || w.tipo === 'modo') return true
  if (w.tipo === 'pagina') return pagina === 0 || pagina === (w.paginaDestino ?? 1)
  return (w.pagina ?? 0) === pagina
}

/** Sitio del botón de PARÁMETROS mientras su página está abierta: la cabecera (la sección de controles queda tapada). */
const RECT_BOTON_PARAMETROS_ABIERTO: [number, number] = [484, 51]

const cacheVistas = new WeakMap<UiLayout, Map<string, UiLayout>>()

/**
 * Layout tal como se ve en un modo y una página: en Básico solo quedan los widgets esenciales (`basico` ≠ false), en su
 * `rectBasico` si el reflujo los recoloca, y desaparecen las páginas extra; con la página PARÁMETROS abierta su botón
 * pasa a la cabecera. El resultado se cachea (el layout es inmutable).
 */
export function layoutParaVista(layout: UiLayout, modo: ModoEditor, pagina = 0): UiLayout {
  const clave = `${modo}:${pagina}`
  let porLayout = cacheVistas.get(layout)
  if (!porLayout) cacheVistas.set(layout, (porLayout = new Map()))
  const hecho = porLayout.get(clave)
  if (hecho) return hecho
  const basico = modo === 'basico'
  const widgets: WidgetLayout[] = []
  for (const w of layout.widgets) {
    if (basico && (w.basico === false || (w.pagina ?? 0) > 0 || w.tipo === 'pagina')) continue
    let rect = basico && w.rectBasico ? w.rectBasico : w.rect
    if (w.tipo === 'pagina' && w.paginaDestino === 2 && pagina === 2) {
      const [x, y] = RECT_BOTON_PARAMETROS_ABIERTO
      rect = [x, y, x + (w.rect[2] - w.rect[0]), y + (w.rect[3] - w.rect[1])]
    }
    widgets.push(rect === w.rect ? w : { ...w, rect })
  }
  const vista: UiLayout = { ...layout, widgets }
  porLayout.set(clave, vista)
  return vista
}

/** Modo con el que abre el editor (el del layout; Avanzado si el layout es anterior al selector). */
export const modoInicial = (layout: UiLayout): ModoEditor => layout.modos?.defecto ?? 'avanzado'

/** Mitad del selector BÁSICO | AVANZADO bajo la x dada. */
export const modoEnSelector = (w: WidgetLayout, x: number): ModoEditor => (x < (w.corte ?? (w.rect[0] + w.rect[2]) / 2) ? 'basico' : 'avanzado')

/** Área sensible de un widget: la píldora en las secciones, el rectángulo en el resto (medidores no). */
export function areaSensible(w: WidgetLayout): Rect4 | null {
  if (w.tipo === 'section') return w.param !== undefined ? margen(pildora(w), 6) : null
  if (w.tipo === 'reset' || w.tipo === 'pagina' || w.tipo === 'reset-fx' || w.tipo === 'button' || w.tipo === 'modo') return w.rect // botones: no tienen parámetro
  if (w.tipo === 'mixfx-eq') return margen(w.rect, 10) // los nodos de los extremos sobresalen de la gráfica
  if (w.tipo === 'meter' || w.tipo === 'mixfx-gr' || w.param === undefined) return null
  return w.rect
}

/**
 * Widget bajo el puntero. Con `minimoTactil` (px de diseño), un toque cerca de un control pequeño
 * lo alcanza aunque caiga fuera de su rectángulo (44 px mínimos, V3 §4.5).
 */
export function widgetEn(layout: UiLayout, x: number, y: number, minimoTactil = 0, pagina = 0): WidgetLayout | null {
  for (let i = layout.widgets.length - 1; i >= 0; i--) {
    const w = layout.widgets[i]!
    if (!visibleEnPagina(w, pagina)) continue
    const a = areaSensible(w)
    if (a && contiene(a, x, y)) return w
  }
  if (minimoTactil <= 0) return null
  let mejor: WidgetLayout | null = null
  let dMejor = Infinity
  for (const w of layout.widgets) {
    if (!visibleEnPagina(w, pagina)) continue
    const a = areaSensible(w)
    if (!a || w.tipo === 'mixfx-eq') continue
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
