/**
 * Marco de ventana normalizado (minimizar · maximizar/restaurar · cerrar) para TODAS las ventanas del DAW.
 *
 * Ventanas sin marco (la principal y cualquier otra que use `opcionesVentanaSinMarco`): los tres botones
 * los dibuja Windows con la «Window Controls Overlay» (`titleBarOverlay`), encima del contenido web. Así
 * no dependen de React: siguen visibles con la pantalla de carga, el Portal, la pantalla de error, un
 * renderer colgado o un diálogo modal con fondo opaco, y Windows conserva sus atajos (Win+flechas, Snap,
 * doble clic en la zona de arrastre). La UI solo reserva ese hueco (ver components/window-title-bar.tsx).
 *
 * Además: ninguna ventana nace ni queda más grande que el área de trabajo del monitor ni con la barra de
 * título fuera de la pantalla (portátiles con escala 125–150 %, monitor desconectado…).
 *
 * Este módulo no importa `electron` para poder probarse con node:test; main.ts le pasa lo que necesita.
 */

/** Alto (px CSS) de la barra de título y de los botones nativos. Debe coincidir con la UI. */
export const ALTO_BARRA_TITULO = 44
/** Ancho aproximado de los tres botones de ventana de Windows (3 × 46 px). */
export const ANCHO_BOTONES_VENTANA = 138

/** Colores de la barra (hex). `--panel` y `--muted-foreground` de src/globals.css convertidos de oklch. */
export const COLOR_BARRA_TITULO = '#0a0d23'
export const COLOR_SIMBOLOS_BARRA = '#c9cde6'

export type Rect = { x: number; y: number; width: number; height: number }

export type OpcionesOverlay = { color: string; symbolColor: string; height: number }

/** Opciones de BrowserWindow para una ventana sin marco con botones nativos siempre visibles. */
export function opcionesVentanaSinMarco(plataforma: NodeJS.Platform = process.platform): {
  titleBarStyle: 'hidden'
  titleBarOverlay?: OpcionesOverlay
} {
  // macOS: 'hidden' conserva los semáforos nativos; Windows/Linux: overlay con los tres botones.
  if (plataforma === 'darwin') return { titleBarStyle: 'hidden' }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: COLOR_BARRA_TITULO, symbolColor: COLOR_SIMBOLOS_BARRA, height: ALTO_BARRA_TITULO },
  }
}

const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i

/** Valida lo que pide el renderer para recolorear los botones nativos (solo hex; alto acotado). */
export function normalizarOverlay(entrada: unknown): Partial<OpcionesOverlay> | null {
  if (!entrada || typeof entrada !== 'object') return null
  const e = entrada as Record<string, unknown>
  const out: Partial<OpcionesOverlay> = {}
  if (typeof e.color === 'string' && HEX.test(e.color)) out.color = e.color
  if (typeof e.symbolColor === 'string' && HEX.test(e.symbolColor)) out.symbolColor = e.symbolColor
  if (typeof e.height === 'number' && Number.isFinite(e.height)) out.height = Math.round(Math.min(64, Math.max(28, e.height)))
  return Object.keys(out).length ? out : null
}

/**
 * Tamaño inicial y mínimos que caben en el área de trabajo (DIP). Con 1366×768 al 150 % el área es de
 * ~911×512: un mínimo fijo de 1000×600 dejaría los botones de la derecha o la barra fuera de la pantalla.
 */
export function medidasQueCaben(
  areaTrabajo: Rect,
  deseado: { width: number; height: number; minWidth: number; minHeight: number },
): Rect & { minWidth: number; minHeight: number } {
  const width = Math.max(1, Math.min(deseado.width, areaTrabajo.width))
  const height = Math.max(1, Math.min(deseado.height, areaTrabajo.height))
  return {
    x: Math.round(areaTrabajo.x + (areaTrabajo.width - width) / 2),
    y: Math.round(areaTrabajo.y + (areaTrabajo.height - height) / 2),
    width,
    height,
    minWidth: Math.min(deseado.minWidth, width),
    minHeight: Math.min(deseado.minHeight, height),
  }
}

function interseccion(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * Devuelve límites corregidos si la barra de título (franja superior de `altoBarra`) no está completa y
 * visible en ningún área de trabajo; `null` si ya lo está. Se lleva al monitor con más superficie de la
 * ventana (o al principal), se encoge si no cabe y se mete dentro de su área de trabajo.
 */
export function corregirParaBarraVisible(
  limites: Rect,
  areas: Rect[],
  altoBarra = ALTO_BARRA_TITULO,
  principal: Rect | undefined = areas[0],
): Rect | null {
  if (!areas.length || !principal) return null
  // Lo que no puede perderse: la esquina superior derecha con los tres botones, completa dentro de UN área
  // de trabajo (una ventana repartida entre dos monitores es válida mientras los botones se vean).
  const anchoBotones = Math.min(limites.width, ANCHO_BOTONES_VENTANA)
  const botones: Rect = {
    x: limites.x + limites.width - anchoBotones,
    y: limites.y,
    width: anchoBotones,
    height: Math.min(altoBarra, limites.height),
  }
  const visible = areas.some(
    (a) =>
      botones.x >= a.x &&
      botones.y >= a.y &&
      botones.x + botones.width <= a.x + a.width &&
      botones.y + botones.height <= a.y + a.height,
  )
  if (visible) return null
  let destino = principal
  let mejor = 0
  for (const a of areas) {
    const s = interseccion(limites, a)
    if (s > mejor) {
      mejor = s
      destino = a
    }
  }
  const width = Math.min(limites.width, destino.width)
  const height = Math.min(limites.height, destino.height)
  const x = Math.min(Math.max(limites.x, destino.x), destino.x + destino.width - width)
  const y = Math.min(Math.max(limites.y, destino.y), destino.y + destino.height - height)
  return { x, y, width, height }
}

/** Lo mínimo de BrowserWindow que usan los ayudantes (evita importar electron aquí). */
export type VentanaMarco = {
  isDestroyed(): boolean
  isMaximized(): boolean
  isMinimized(): boolean
  isFullScreen(): boolean
  getBounds(): Rect
  setBounds(r: Rect): void
  on(evento: string, fn: () => void): unknown
  webContents: { send(canal: string, ...args: unknown[]): void; isDestroyed(): boolean }
}

export type PantallaMarco = {
  getAllDisplays(): Array<{ workArea: Rect }>
  getPrimaryDisplay(): { workArea: Rect }
  on(evento: string, fn: () => void): unknown
  removeListener(evento: string, fn: () => void): unknown
}

/** Estado que recibe el renderer en 'window-maximized-changed' (boolean, por compatibilidad). */
export function conectarEstadoVentana(win: VentanaMarco): void {
  const emitir = () => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send('window-maximized-changed', win.isMaximized())
  }
  for (const ev of ['maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) win.on(ev, emitir)
}

/** Si la barra de título quedó fuera de toda pantalla, la devuelve a una visible. */
export function asegurarBarraVisible(win: VentanaMarco, pantalla: PantallaMarco): boolean {
  if (win.isDestroyed() || win.isMaximized() || win.isMinimized() || win.isFullScreen()) return false
  const areas = pantalla.getAllDisplays().map((d) => d.workArea)
  const corregido = corregirParaBarraVisible(win.getBounds(), areas, ALTO_BARRA_TITULO, pantalla.getPrimaryDisplay().workArea)
  if (!corregido) return false
  win.setBounds(corregido)
  return true
}

/** Vigila monitores desconectados o cambios de escala y recoloca la ventana si hace falta. */
export function vigilarBarraVisible(win: VentanaMarco, pantalla: PantallaMarco): void {
  const revisar = () => {
    // Windows recoloca las ventanas tras quitar un monitor un instante después: se revisa al final.
    setTimeout(() => asegurarBarraVisible(win, pantalla), 300)
  }
  // Solo ante cambios de pantalla o al mostrarse: si el usuario arrastra la ventana a medias fuera, se respeta.
  pantalla.on('display-removed', revisar)
  pantalla.on('display-metrics-changed', revisar)
  win.on('ready-to-show', revisar)
  win.on('show', revisar)
  win.on('closed', () => {
    pantalla.removeListener('display-removed', revisar)
    pantalla.removeListener('display-metrics-changed', revisar)
  })
}
