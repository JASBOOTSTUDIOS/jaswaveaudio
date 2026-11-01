/**
 * Revelar un elemento dentro de su scroller en un solo eje: al seleccionar una pista en el Arrange o una
 * tira en el Mixer, su contraparte del otro panel se desplaza lo mínimo para quedar a la vista.
 * A diferencia de `scrollIntoView`, no mueve contenedores ancestros (el layout del workspace).
 */

/**
 * Nueva posición de scroll para que [inicio, inicio+tamano) (coordenadas de contenido) quede dentro de la
 * vista [scroll, scroll+vista), o `null` si ya se ve entero. Si no cabe, se alinea su inicio.
 */
export function scrollParaRevelar(
  scroll: number,
  vista: number,
  inicio: number,
  tamano: number,
  margen = 8,
): number | null {
  if (vista <= 0) return null
  const fin = inicio + tamano
  if (inicio >= scroll && fin <= scroll + vista) return null
  if (tamano + margen * 2 >= vista || inicio < scroll) return Math.max(0, inicio - margen)
  return Math.max(0, fin - vista + margen)
}

/** Desplaza `scroller` en el eje indicado para revelar `el` (descendiente suyo). */
export function revelarEnScroller(
  scroller: HTMLElement | null | undefined,
  el: HTMLElement | null | undefined,
  eje: 'x' | 'y',
): void {
  if (!scroller || !el) return
  const s = scroller.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  if (eje === 'y') {
    const inicio = r.top - s.top + scroller.scrollTop
    const nuevo = scrollParaRevelar(scroller.scrollTop, scroller.clientHeight, inicio, r.height)
    if (nuevo != null) scroller.scrollTo({ top: nuevo, behavior: 'smooth' })
    return
  }
  const inicio = r.left - s.left + scroller.scrollLeft
  const nuevo = scrollParaRevelar(scroller.scrollLeft, scroller.clientWidth, inicio, r.width)
  if (nuevo != null) scroller.scrollTo({ left: nuevo, behavior: 'smooth' })
}
