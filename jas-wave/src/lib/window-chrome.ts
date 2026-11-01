/**
 * Lógica pura del marco de ventana del renderer (barra de título + botones de ventana). Ver
 * components/window-title-bar.tsx y electron/window-chrome.ts.
 */

/** Alto de la barra de título en px CSS. Fijo (no escala con el zoom de UI) para casar con los botones nativos. */
export const ALTO_BARRA_TITULO = 44
/** Ancho de cada botón propio (minimizar / maximizar / cerrar), igual que los de Windows. */
export const ANCHO_BOTON_VENTANA = 46
export const ANCHO_CONTROLES_PROPIOS = ANCHO_BOTON_VENTANA * 3

/**
 * Quién dibuja minimizar · maximizar/restaurar · cerrar:
 *  - 'nativos': Windows/Linux con Window Controls Overlay; la UI solo reserva el hueco.
 *  - 'propios': ventana Electron sin overlay (p. ej. pantalla completa o plataforma sin soporte); los dibuja la UI.
 *  - 'ninguno': navegador (PWA web) o ventana con marco nativo.
 */
export type ModoControlesVentana = 'nativos' | 'propios' | 'ninguno'

export function modoControlesVentana(opts: { esElectron: boolean; overlayVisible: boolean; marcoNativo?: boolean }): ModoControlesVentana {
  if (!opts.esElectron || opts.marcoNativo) return 'ninguno'
  return opts.overlayVisible ? 'nativos' : 'propios'
}

export function etiquetaMaximizar(maximizada: boolean): 'Restaurar' | 'Maximizar' {
  return maximizada ? 'Restaurar' : 'Maximizar'
}

/**
 * Qué cabe en la barra según el ancho libre (sin contar los botones de ventana, que nunca se recortan).
 * Lo primero que cede es la versión, después las acciones (pasan al menú «…») y por último el nombre del
 * proyecto se trunca con elipsis.
 */
export function planBarraTitulo(anchoLibre: number): { mostrarVersion: boolean; accionesEnMenu: boolean } {
  // 0 = aún sin medir: disposición completa (es lo habitual con la ventana de ≥ 1000 px)
  if (anchoLibre <= 0) return { mostrarVersion: true, accionesEnMenu: false }
  return {
    mostrarVersion: anchoLibre >= 620,
    accionesEnMenu: anchoLibre < 480,
  }
}
