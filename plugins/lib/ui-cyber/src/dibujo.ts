/**
 * Dibujo en Canvas 2D del editor cyber, en unidades de diseño (1100×620), con los mismos tokens y
 * geometría que plugins/shared-ui (jw_ui_widgets.cpp, jw_ui_plantilla.h): marco, cabecera, secciones,
 * perillas, fader, interruptores, desplegables, medidores y los visualizadores comunes.
 */

import { DB_MAX, DB_MIN, xDeFrecuencia, yDeDbfs } from './espectro'
import { layoutParaVista, pildora, visibleEnPagina } from './disposicion'
import { BANDAS, OFF, leerParamsEq, resolverWidget, respuestaDb, widgetEq } from './fxrack'
import type { ModoEditor, Rect4, UiLayout, WidgetLayout } from './tipos'
import { aPlano, defDe, formatear } from './valores'

/** Tokens de V3 §3.1 (idénticos a Pal en jw_ui.h). */
export const PAL = {
  metalAlto: '#3A3F5E',
  metalBajo: '#14152B',
  metalBrillo: '#6A70A6',
  metalSombra: '#08081A',
  pantallaCentro: '#0D0F2C',
  pantallaBorde: '#05060F',
  panelFondo: 'rgba(11,13,39,0.62)',
  panelBorde: '#2D3375',
  reticula: 'rgba(30,34,96,0.55)',
  cian: '#19D9FF',
  cianNucleo: '#C6F7FF',
  cianGlow: 'rgba(25,217,255,0.35)',
  // marca (logo): violeta → azul → cian y plata cromada
  violeta: '#8A4DFF',
  azul: '#3D5BFF',
  plata: '#D6D9EE',
  espectroIn: 'rgba(143,131,255,0.65)',
  textoTitulo: '#DCE0FA',
  textoEtiqueta: '#9AA3DA',
  textoValor: '#B6E8FF',
  textoTenue: '#5C6399',
  alerta: '#FF4FC3',
  bloqueado: '#5D6288',
  perillaCuerpo: '#0F1131',
  perillaPista: '#1D2152',
} as const

/** Degradado de marca violeta → azul → cian (t en 0..1), idéntico a gradienteMarca() de jw_ui.h. */
export function gradienteMarca(t: number): string {
  const u = Math.max(0, Math.min(1, t))
  const A = u < 0.5 ? [0x8A, 0x4D, 0xFF] : [0x3D, 0x5B, 0xFF]
  const B = u < 0.5 ? [0x3D, 0x5B, 0xFF] : [0x19, 0xD9, 0xFF]
  const k = u < 0.5 ? u * 2 : (u - 0.5) * 2
  return `rgb(${A.map((c, i) => Math.round(c + (B[i]! - c) * k)).join(',')})`
}

const SANS = 'Bahnschrift, "DIN Alternate", "Barlow Semi Condensed", "Segoe UI", system-ui, sans-serif'
const MONO = 'Consolas, "JetBrains Mono", "Cascadia Mono", ui-monospace, monospace'
const FUENTE = {
  titulo: `300 22px ${SANS}`,
  marca: `300 26px ${SANS}`,
  seccion: `600 13px ${SANS}`,
  etiqueta: `400 11px ${SANS}`,
  valor: `11.5px ${MONO}`,
  valorPeq: `10px ${MONO}`,
  cuerpo: `400 13px ${SANS}`,
} as const

const INICIO_PERILLA = (135 * Math.PI) / 180
const RECORRIDO_PERILLA = (270 * Math.PI) / 180

export type Medidor = { db: number; pico: number }

export type EstadoDibujo = {
  layout: UiLayout
  /** Valor normalizado (0..1) de un parámetro VST. */
  valor: (param: number) => number
  /** Widget en edición o bajo el puntero (muestra su valor, como en el VST). */
  activo?: WidgetLayout | null
  /** Muestra siempre el valor bajo las perillas (pantallas táctiles: no hay "hover"). */
  mostrarValores?: boolean
  /** Columnas del espectro en dBFS (ya con balística); null si no hay señal. */
  espectro?: { in?: ArrayLike<number> | null; out?: ArrayLike<number> | null }
  /** Nivel de los medidores estándar (IN L/R, OUT L/R) en dBFS. */
  medidores?: { in: [Medidor, Medidor]; out: [Medidor, Medidor] } | null
  /** Isotipo de JasWave (imagen ya cargada) para la cabecera. */
  logo?: CanvasImageSource | null
  /** Texto del mini-panel donde el VST pinta medición en vivo que la réplica no calcula. */
  avisoMedicion?: string
  /** Página visible: 0 = editor del plugin, 1 = MIX / FX, 2 = PARÁMETROS. */
  pagina?: number
  /** Modo del editor (Avanzado si se omite): en Básico solo se dibujan los controles esenciales. */
  modo?: ModoEditor
  /** Banda del ecualizador seleccionada en la página MIX / FX (0..5). */
  bandaSel?: number
  /** Reducción de ganancia del compresor integrado (dB); la web no procesa audio, así que normalmente no hay. */
  grDb?: number | null
  /** Tecla del teclado en pantalla pulsada con el ratón (se ilumina). */
  notaPulsada?: number | null
  /** Frecuencia de muestreo con la que se dibuja la curva del ecualizador. */
  sampleRate?: number
}

/** Banda del ecualizador seleccionada por defecto (la tercera: campana de 800 Hz), como en el editor nativo. */
export const BANDA_INICIAL = 2

type Ctx = CanvasRenderingContext2D

/** Tamaño en px de una fuente CSS ("400 11px Bahnschrift…" → 11). */
export const tamanoDe = (fuente: string) => Number(/(\d+(?:\.\d+)?)px/.exec(fuente)?.[1] ?? 11)

const conEspaciado = (ctx: Ctx, espaciado: boolean, tamano: number) => {
  if ('letterSpacing' in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = espaciado ? `${(tamano * 0.12).toFixed(2)}px` : '0px'
}

function texto(ctx: Ctx, s: string, x: number, y: number, fuente: string, color: string, alin: CanvasTextAlign = 'left', espaciado = false) {
  if (!s) return
  ctx.font = fuente
  conEspaciado(ctx, espaciado, tamanoDe(fuente))
  ctx.fillStyle = color
  ctx.textAlign = alin
  ctx.textBaseline = 'middle'
  ctx.fillText(s, x, y)
  conEspaciado(ctx, false, 11)
}

/** Ancho de un texto con la fuente de marca y el espaciado de las etiquetas (para pintar letra a letra). */
function anchoTexto(ctx: Ctx, s: string): number {
  ctx.font = FUENTE.marca
  conEspaciado(ctx, true, tamanoDe(FUENTE.marca))
  const w = ctx.measureText(s).width
  conEspaciado(ctx, false, 11)
  return w
}

function chaflan(ctx: Ctx, r: Rect4, ch: number) {
  const [l, t, rr, b] = r
  ch = Math.min(ch, 0.5 * Math.min(rr - l, b - t))
  ctx.beginPath()
  ctx.moveTo(l + ch, t)
  ctx.lineTo(rr - ch, t)
  ctx.lineTo(rr, t + ch)
  ctx.lineTo(rr, b - ch)
  ctx.lineTo(rr - ch, b)
  ctx.lineTo(l + ch, b)
  ctx.lineTo(l, b - ch)
  ctx.lineTo(l, t + ch)
  ctx.closePath()
}

function brillo(ctx: Ctx, color: string, blur: number, dibujar: () => void) {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = blur
  dibujar()
  ctx.restore()
}

function linea(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string, ancho = 1) {
  ctx.strokeStyle = color
  ctx.lineWidth = ancho
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
}

// ---------------------------------------------------------------------------------
//  Marco, pantalla y cabecera
// ---------------------------------------------------------------------------------
function fondo(ctx: Ctx, layout: UiLayout) {
  const W = layout.base.ancho, H = layout.base.alto
  ctx.fillStyle = '#05050F'
  ctx.fillRect(0, 0, W, H)
  const marco: Rect4 = [0, 10, W, H - 10]
  const g = ctx.createLinearGradient(0, marco[1], 0, marco[3])
  g.addColorStop(0, PAL.metalAlto)
  g.addColorStop(1, PAL.metalBajo)
  chaflan(ctx, marco, 26)
  ctx.fillStyle = g
  ctx.fill()
  linea(ctx, 26, 11, W - 26, 11, PAL.metalBrillo)
  linea(ctx, 26, H - 11, W - 26, H - 11, PAL.metalSombra)
  // LEDs laterales
  // violeta a la izquierda y cian a la derecha, como las ondas del logo
  for (const [x, color, nucleo] of [[15, PAL.violeta, 'rgba(220,203,255,0.85)'], [W - 15, PAL.cian, 'rgba(198,247,255,0.8)']] as const) brillo(ctx, color, 10, () => {
    ctx.fillStyle = nucleo
    ctx.fillRect(x - 0.8, H / 2 - 33, 1.6, 66)
  })
  brillo(ctx, PAL.azul, 10, () => {
    ctx.fillStyle = 'rgba(201,214,255,0.85)'
    ctx.fillRect(W / 2 - 28, H - 11.8, 56, 1.6)
  })
  // pantalla
  const p = layout.zonas.pantalla
  const rg = ctx.createRadialGradient((p[0] + p[2]) / 2, (p[1] + p[3]) / 2, 0, (p[0] + p[2]) / 2, (p[1] + p[3]) / 2, (p[2] - p[0]) * 0.62)
  rg.addColorStop(0, PAL.pantallaCentro)
  rg.addColorStop(1, PAL.pantallaBorde)
  chaflan(ctx, p, 14)
  ctx.fillStyle = rg
  ctx.fill()
  // galaxia: nebulosas violeta / cian / azul y campo de estrellas (determinista), recortado a la pantalla
  ctx.save()
  chaflan(ctx, p, 14)
  ctx.clip()
  const nebulosa = (cx: number, cy: number, r: number, rgb: string, a: number) => {
    const n = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    n.addColorStop(0, `rgba(${rgb},${a})`)
    n.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = n
    ctx.fillRect(p[0], p[1], p[2] - p[0], p[3] - p[1])
  }
  nebulosa(p[0] + 220, p[1] + 190, 380, '138,77,255', 0.34)
  nebulosa(p[2] - 220, p[3] - 200, 380, '25,217,255', 0.22)
  nebulosa((p[0] + p[2]) / 2, p[3] - 40, 330, '61,91,255', 0.24)
  nebulosa(p[2] - 260, p[1] + 20, 260, '194,75,255', 0.07)
  let semilla = 0xc0ffee
  const azar = () => ((semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < 170; i++) {
    const x = p[0] + 10 + azar() * (p[2] - p[0] - 20), y = p[1] + 10 + azar() * (p[3] - p[1] - 20)
    const m = azar()
    const rgb = m < 0.4 ? '201,184,255' : m < 0.7 ? '198,247,255' : '255,255,255'
    ctx.fillStyle = `rgba(${rgb},${0.15 + 0.5 * azar()})`
    ctx.beginPath()
    ctx.arc(x, y, 0.45 + 0.5 * azar(), 0, Math.PI * 2)
    ctx.fill()
    if (i % 17 === 0) {
      brillo(ctx, `rgb(${rgb})`, 6, () => ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6))
      linea(ctx, x - 4, y, x + 4, y, `rgba(${rgb},0.25)`, 0.8)
      linea(ctx, x, y - 4, x, y + 4, `rgba(${rgb},0.25)`, 0.8)
    }
  }
  ctx.restore()
  // retícula cada 44 px
  ctx.save()
  chaflan(ctx, p, 14)
  ctx.clip()
  ctx.strokeStyle = PAL.reticula
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = p[0] + 44; x < p[2]; x += 44) {
    ctx.moveTo(x, p[1])
    ctx.lineTo(x, p[3])
  }
  for (let y = p[1] + 44; y < p[3]; y += 44) {
    ctx.moveTo(p[0], y)
    ctx.lineTo(p[2], y)
  }
  ctx.stroke()
  ctx.restore()
  chaflan(ctx, p, 14)
  ctx.strokeStyle = 'rgba(61,91,255,0.28)'
  ctx.stroke()
  // borde superior/inferior con el degradado de marca
  for (let i = 0; i < 24; i++) {
    const x0 = p[0] + 14 + ((p[2] - p[0] - 28) * i) / 24, x1 = p[0] + 14 + ((p[2] - p[0] - 28) * (i + 1)) / 24
    linea(ctx, x0, p[1], x1, p[1], gradienteMarca(i / 23), 1.2)
    linea(ctx, x0, p[3], x1, p[3], gradienteMarca(i / 23), 1)
  }
}

function cabecera(ctx: Ctx, e: EstadoDibujo) {
  const L = e.layout
  if (e.logo) ctx.drawImage(e.logo, 52, 42, 28, 28)
  brillo(ctx, 'rgba(61,91,255,0.45)', 6, () => texto(ctx, L.titulo, 90, 58, FUENTE.titulo, PAL.textoTitulo, 'left', true))
  texto(ctx, L.subtitulo, 90, 78, FUENTE.etiqueta, PAL.textoTenue, 'left', true)
  ctx.fillStyle = L.acento
  ctx.globalAlpha = 0.85
  ctx.fillRect(90, 87, 48, 1.5)
  ctx.globalAlpha = 1
  brillo(ctx, PAL.cian, 8, () => {
    ctx.fillStyle = PAL.cian
    ctx.beginPath()
    ctx.arc(600, 58, 3.6, 0, Math.PI * 2)
    ctx.fill()
  })
  // "JAS" en plata cromada y "WAVE" con el degradado del logo
  {
    ctx.font = FUENTE.marca
    const palabra = 'JASWAVE'
    const total = anchoTexto(ctx, palabra)
    const x0 = 1046 - total
    const col = [PAL.plata, PAL.plata, '#B8BBD6', '#8A4DFF', '#5A55FF', '#2F7BFF', '#19D9FF']
    for (let i = 0; i < palabra.length; i++) {
      const xi = x0 + (i ? anchoTexto(ctx, palabra.slice(0, i)) : 0)
      if (i >= 3) brillo(ctx, col[i]!, 8, () => texto(ctx, palabra[i]!, xi, 56, FUENTE.marca, col[i]!, 'left', true))
      else texto(ctx, palabra[i]!, xi, 56, FUENTE.marca, col[i]!, 'left', true)
    }
  }
  for (let i = 0; i < 32; i++) linea(ctx, 918 + (128 * i) / 32, 74, 918 + (128 * (i + 1)) / 32, 74, gradienteMarca(i / 31), 1.2)
  texto(ctx, `jaswave · ${L.productId}`, 1046, 571, FUENTE.valorPeq, PAL.textoTenue, 'right')
}

// ---------------------------------------------------------------------------------
//  Widgets
// ---------------------------------------------------------------------------------
function textoValor(w: WidgetLayout, n: number): string {
  const d = defDe(w)
  return d ? formatear(d, aPlano(d, n)) : ''
}

function seccion(ctx: Ctx, w: WidgetLayout, e: EstadoDibujo) {
  chaflan(ctx, w.rect, 6)
  ctx.fillStyle = PAL.panelFondo
  ctx.fill()
  ctx.strokeStyle = PAL.panelBorde
  ctx.lineWidth = 1
  ctx.stroke()
  linea(ctx, w.rect[0] + 8, w.rect[1] + 26, w.rect[2] - 8, w.rect[1] + 26, 'rgba(45,51,117,0.6)')
  texto(ctx, w.etiqueta, w.rect[0] + 10, w.rect[1] + 14, FUENTE.seccion, PAL.textoTitulo, 'left', true)
  if (w.param === undefined) return
  // la píldora del bypass está encendida cuando el plugin procesa (bypass = 0)
  const on = (e.valor(w.param) >= 0.5) !== Boolean(w.bypass)
  pildoraOn(ctx, pildora(w), on)
}

function pildoraOn(ctx: Ctx, p: Rect4, on: boolean) {
  const r = 4
  ctx.beginPath()
  ctx.roundRect(p[0], p[1], p[2] - p[0], p[3] - p[1], r)
  if (on) {
    brillo(ctx, PAL.cian, 8, () => {
      ctx.fillStyle = PAL.cian
      ctx.fill()
    })
  } else {
    ctx.strokeStyle = 'rgba(25,217,255,0.45)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

function perilla(ctx: Ctx, w: WidgetLayout, e: EstadoDibujo) {
  const r = (w.tamano ?? 44) / 2
  const cx = (w.rect[0] + w.rect[2]) / 2
  const cy = w.rect[1] + 4 + r
  const n = w.param !== undefined ? e.valor(w.param) : 0
  ctx.fillStyle = PAL.perillaCuerpo
  ctx.beginPath()
  ctx.arc(cx, cy, r - 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(106,112,166,0.75)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  const tw = r >= 30 ? 3.5 : 3
  ctx.lineCap = 'round'
  ctx.strokeStyle = PAL.perillaPista
  ctx.lineWidth = tw
  ctx.beginPath()
  ctx.arc(cx, cy, r - 1.5, INICIO_PERILLA, INICIO_PERILLA + RECORRIDO_PERILLA)
  ctx.stroke()
  const aVal = INICIO_PERILLA + RECORRIDO_PERILLA * n
  const aDesde = w.bipolar ? INICIO_PERILLA + RECORRIDO_PERILLA / 2 : INICIO_PERILLA
  if (Math.abs(aVal - aDesde) > 0.002) {
    brillo(ctx, PAL.cian, 7, () => {
      ctx.strokeStyle = PAL.cian
      ctx.lineWidth = tw
      ctx.beginPath()
      ctx.arc(cx, cy, r - 1.5, Math.min(aDesde, aVal), Math.max(aDesde, aVal))
      ctx.stroke()
    })
  }
  ctx.lineCap = 'butt'
  brillo(ctx, PAL.cianNucleo, 6, () => {
    ctx.fillStyle = PAL.cianNucleo
    ctx.beginPath()
    ctx.arc(cx + (r - 1.5) * Math.cos(aVal), cy + (r - 1.5) * Math.sin(aVal), 2.2, 0, Math.PI * 2)
    ctx.fill()
  })
  linea(ctx, cx + (r - 14) * Math.cos(aVal), cy + (r - 14) * Math.sin(aVal), cx + (r - 8) * Math.cos(aVal), cy + (r - 8) * Math.sin(aVal), PAL.textoValor, 1.4)
  const yEt = cy + r + 10
  if (e.activo === w) texto(ctx, textoValor(w, n), cx, yEt, FUENTE.valor, PAL.textoValor, 'center')
  else {
    texto(ctx, w.etiqueta, cx, yEt, FUENTE.etiqueta, PAL.textoEtiqueta, 'center', true)
    // en táctil no hay «hover»: valor fijo bajo las perillas grandes (las pequeñas lo muestran al tocarlas)
    if (e.mostrarValores && (w.tamano ?? 44) >= 44) texto(ctx, textoValor(w, n), cx, yEt + 13, FUENTE.valorPeq, PAL.textoTenue, 'center')
  }
}

function fader(ctx: Ctx, w: WidgetLayout, e: EstadoDibujo) {
  const cx = (w.rect[0] + w.rect[2]) / 2
  const s: Rect4 = [cx - 3, w.rect[1] + 8, cx + 3, w.rect[3] - 36]
  const n = w.param !== undefined ? e.valor(w.param) : 0
  const capY = s[3] - n * (s[3] - s[1])
  for (let i = 0; i <= 10; i++) {
    const y = s[1] + ((s[3] - s[1]) * i) / 10
    linea(ctx, s[0] - (i % 5 === 0 ? 9 : 6), y, s[0] - 3, y, 'rgba(92,99,153,0.7)')
  }
  ctx.fillStyle = '#020208'
  ctx.fillRect(s[0] - 1, s[1] - 1, s[2] - s[0] + 2, s[3] - s[1] + 2)
  ctx.strokeStyle = PAL.panelBorde
  ctx.strokeRect(s[0], s[1], s[2] - s[0], s[3] - s[1])
  ctx.fillStyle = 'rgba(25,217,255,0.32)'
  ctx.fillRect(s[0] + 1, capY, s[2] - s[0] - 2, s[3] - capY - 0.5)
  const g = ctx.createLinearGradient(0, capY - 5, 0, capY + 5)
  g.addColorStop(0, '#7479AE')
  g.addColorStop(1, '#2B2E52')
  ctx.fillStyle = g
  ctx.fillRect(cx - 11, capY - 5, 22, 10)
  ctx.strokeStyle = PAL.metalSombra
  ctx.strokeRect(cx - 11, capY - 5, 22, 10)
  brillo(ctx, PAL.cian, 6, () => linea(ctx, cx - 9, capY, cx + 9, capY, PAL.cian, 1.4))
  texto(ctx, textoValor(w, n), cx, w.rect[3] - 25, FUENTE.valorPeq, PAL.textoValor, 'center')
  texto(ctx, w.etiqueta, cx, w.rect[3] - 9.5, FUENTE.etiqueta, PAL.textoEtiqueta, 'center', true)
}

function interruptor(ctx: Ctx, w: WidgetLayout, e: EstadoDibujo) {
  const on = w.param !== undefined && (e.valor(w.param) >= 0.5) !== Boolean(w.bypass)
  const r = w.rect
  if (on) brillo(ctx, PAL.cianGlow, 8, () => {
    chaflan(ctx, r, 4)
    ctx.fillStyle = '#1A1F5C'
    ctx.fill()
  })
  else {
    chaflan(ctx, r, 4)
    ctx.fillStyle = '#0A0C26'
    ctx.fill()
  }
  chaflan(ctx, r, 4)
  ctx.strokeStyle = on ? PAL.cian : 'rgba(45,51,117,0.8)'
  ctx.lineWidth = 1
  ctx.stroke()
  texto(ctx, w.etiqueta, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, FUENTE.etiqueta, on ? PAL.cianNucleo : PAL.textoEtiqueta, 'center', true)
}

/** Botón RESET de la cabecera: devuelve todos los parámetros a su valor por defecto. */
function botonReset(ctx: Ctx, w: WidgetLayout, e: EstadoDibujo) {
  const r = w.rect
  const radio = (r[3] - r[1]) / 2
  const sobre = e.activo === w
  ctx.beginPath()
  ctx.roundRect(r[0], r[1], r[2] - r[0], r[3] - r[1], radio)
  ctx.fillStyle = sobre ? 'rgba(25,217,255,0.26)' : 'rgba(25,217,255,0.10)'
  ctx.fill()
  ctx.strokeStyle = sobre ? 'rgba(25,217,255,0.95)' : 'rgba(25,217,255,0.55)'
  ctx.lineWidth = 1
  ctx.stroke()
  texto(ctx, w.etiqueta || 'RESET', (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, FUENTE.etiqueta, sobre ? PAL.cianNucleo : PAL.cian, 'center', true)
}

/** Selector [ BÁSICO | AVANZADO ] de la cabecera (como SelectorModo en jw_ui_view.cpp). */
function selectorModo(ctx: Ctx, w: WidgetLayout, e: EstadoDibujo) {
  const r = w.rect
  const corte = w.corte ?? (r[0] + r[2]) / 2
  const basico = e.modo === 'basico'
  const sobre = e.activo === w
  const radio = (r[3] - r[1]) / 2
  ctx.beginPath()
  ctx.roundRect(r[0], r[1], r[2] - r[0], r[3] - r[1], radio)
  ctx.fillStyle = sobre ? 'rgba(25,217,255,0.10)' : 'rgba(25,217,255,0.05)'
  ctx.fill()
  ctx.beginPath()
  ctx.roundRect(basico ? r[0] : corte, r[1], basico ? corte - r[0] : r[2] - corte, r[3] - r[1], radio)
  ctx.fillStyle = 'rgba(25,217,255,0.30)'
  ctx.fill()
  ctx.beginPath()
  ctx.roundRect(r[0], r[1], r[2] - r[0], r[3] - r[1], radio)
  ctx.strokeStyle = sobre ? 'rgba(25,217,255,0.95)' : 'rgba(25,217,255,0.55)'
  ctx.lineWidth = 1
  ctx.stroke()
  linea(ctx, corte, r[1] + 4, corte, r[3] - 4, 'rgba(25,217,255,0.35)')
  const cy = (r[1] + r[3]) / 2
  texto(ctx, 'BÁSICO', (r[0] + corte) / 2, cy, FUENTE.etiqueta, basico ? PAL.textoTitulo : 'rgba(25,217,255,0.75)', 'center', true)
  texto(ctx, 'AVANZADO', (corte + r[2]) / 2, cy, FUENTE.etiqueta, basico ? 'rgba(25,217,255,0.75)' : PAL.textoTitulo, 'center', true)
}

function desplegable(ctx: Ctx, w: WidgetLayout, e: EstadoDibujo) {
  const r = w.rect
  let bx = r[0]
  if (w.etiquetaArriba) {
    // página PARÁMETROS: el nombre encima y la caja a todo el ancho
    texto(ctx, w.etiqueta, (r[0] + r[2]) / 2, r[1] - 10, FUENTE.etiqueta, PAL.textoEtiqueta, 'center', true)
  } else if (w.etiqueta) {
    ctx.font = FUENTE.etiqueta
    conEspaciado(ctx, true, 11)
    const lw = ctx.measureText(w.etiqueta).width + 8
    conEspaciado(ctx, false, 11)
    texto(ctx, w.etiqueta, r[0], (r[1] + r[3]) / 2, FUENTE.etiqueta, PAL.textoEtiqueta, 'left', true)
    bx = r[0] + lw
  }
  const caja: Rect4 = [bx, r[1] + 1, r[2], r[3] - 1]
  ctx.fillStyle = '#090B24'
  ctx.fillRect(caja[0], caja[1], caja[2] - caja[0], caja[3] - caja[1])
  ctx.strokeStyle = e.activo === w ? 'rgba(25,217,255,0.7)' : PAL.panelBorde
  ctx.strokeRect(caja[0], caja[1], caja[2] - caja[0], caja[3] - caja[1])
  ctx.save()
  ctx.beginPath()
  ctx.rect(caja[0], caja[1], caja[2] - caja[0] - 16, caja[3] - caja[1])
  ctx.clip()
  texto(ctx, w.param !== undefined ? textoValor(w, e.valor(w.param)) : '', caja[0] + 6, (caja[1] + caja[3]) / 2, FUENTE.valorPeq, PAL.textoValor)
  ctx.restore()
  const cx = caja[2] - 9, cy = (caja[1] + caja[3]) / 2
  linea(ctx, cx - 3.5, cy - 1.5, cx, cy + 2, PAL.cian, 1.3)
  linea(ctx, cx, cy + 2, cx + 3.5, cy - 1.5, PAL.cian, 1.3)
}

function medidor(ctx: Ctx, w: WidgetLayout, m: Medidor | null, minDb = -60, maxDb = 6) {
  const conEtiqueta = Boolean(w.etiqueta)
  const bar: Rect4 = [w.rect[0], w.rect[1], w.rect[2], w.rect[3] - (conEtiqueta ? 16 : 0)]
  const segs = Math.max(4, Math.floor((bar[3] - bar[1]) / 5))
  const segH = (bar[3] - bar[1]) / segs
  const lit = m ? Math.round(Math.min(1, Math.max(0, (m.db - minDb) / (maxDb - minDb))) * segs) : 0
  ctx.fillStyle = '#03030F'
  ctx.fillRect(bar[0] - 1, bar[1] - 1, bar[2] - bar[0] + 2, bar[3] - bar[1] + 2)
  for (let i = 0; i < segs; i++) {
    const y0 = bar[3] - (i + 1) * segH
    const top = i === segs - 1
    ctx.fillStyle = i < lit ? (top ? PAL.alerta : PAL.cian) : top ? 'rgba(255,79,195,0.08)' : 'rgba(25,217,255,0.08)'
    ctx.fillRect(bar[0], y0 + 0.8, bar[2] - bar[0], segH - 1.6)
  }
  if (conEtiqueta) texto(ctx, w.etiqueta, (w.rect[0] + w.rect[2]) / 2, w.rect[3] - 7.5, FUENTE.etiqueta, PAL.textoEtiqueta, 'center', true)
}

// ---------------------------------------------------------------------------------
//  Visualizador y mini-panel
// ---------------------------------------------------------------------------------
function panel(ctx: Ctx, r: Rect4, titulo: string) {
  chaflan(ctx, r, 6)
  ctx.fillStyle = 'rgba(9,11,36,0.55)'
  ctx.fill()
  ctx.strokeStyle = PAL.panelBorde
  ctx.lineWidth = 1
  ctx.stroke()
  texto(ctx, titulo, r[0] + 12, r[1] + 14, FUENTE.seccion, PAL.textoTitulo, 'left', true)
}

const FRECUENCIAS: [number, string][] = [
  [50, '50'],
  [100, '100'],
  [200, '200'],
  [500, '500'],
  [1000, '1k'],
  [2000, '2k'],
  [5000, '5k'],
  [10000, '10k'],
]

function espectro(ctx: Ctx, a: Rect4, e: EstadoDibujo) {
  const ancho = a[2] - a[0], alto = a[3] - a[1]
  for (const [f, et] of FRECUENCIAS) {
    const x = xDeFrecuencia(a[0], ancho, f)
    linea(ctx, x, a[1], x, a[3], 'rgba(25,217,255,0.07)')
    texto(ctx, et, x, a[3] + 9, FUENTE.valorPeq, PAL.textoTenue, 'center')
  }
  for (let d = DB_MIN; d <= DB_MAX; d += 24) {
    const y = yDeDbfs(a[1], alto, d)
    linea(ctx, a[0], y, a[2], y, d === 0 ? 'rgba(25,217,255,0.4)' : 'rgba(25,217,255,0.07)')
    texto(ctx, d === 0 ? '+0' : String(d), a[2] + 2, y, FUENTE.valorPeq, PAL.textoTenue)
  }
  const traza = (cols: ArrayLike<number>, color: string, relleno: string, grosor: number, halo: boolean) => {
    const n = cols.length
    if (n < 2) return
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const x = a[0] + (ancho * (i + 0.5)) / n
      const y = yDeDbfs(a[1], alto, cols[i]!)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = color
    ctx.lineWidth = grosor
    if (halo) brillo(ctx, PAL.cianGlow, 8, () => ctx.stroke())
    else ctx.stroke()
    ctx.lineTo(a[0] + ancho * (1 - 0.5 / n), a[3])
    ctx.lineTo(a[0] + (ancho * 0.5) / n, a[3])
    ctx.closePath()
    ctx.fillStyle = relleno
    ctx.fill()
  }
  const inn = e.espectro?.in
  const out = e.espectro?.out
  if (inn) traza(inn, PAL.espectroIn, 'rgba(143,131,255,0.08)', 1, false)
  if (out) traza(out, PAL.cian, 'rgba(25,217,255,0.15)', 1.8, true)
  if (inn) {
    ctx.fillStyle = PAL.espectroIn
    ctx.fillRect(a[2] - 92, a[1] + 8, 12, 1.5)
    texto(ctx, 'IN', a[2] - 76, a[1] + 8, FUENTE.etiqueta, PAL.textoTenue, 'left', true)
  }
  if (out) {
    ctx.fillStyle = PAL.cian
    ctx.fillRect(a[2] - 44, a[1] + 8, 12, 1.5)
    texto(ctx, 'OUT', a[2] - 28, a[1] + 8, FUENTE.etiqueta, PAL.textoTenue, 'left', true)
  }
}

const esNegra = (n: number) => [1, 3, 6, 8, 10].includes(n % 12)

/** Teclado de 88 teclas del visualizador de instrumentos (mismas coordenadas que el VST nativo). */
export function rectTeclado(layout: UiLayout): Rect4 | null {
  if (layout.visualizador !== 'espectro-instrumento') return null
  const v = layout.zonas.visualizador
  return [v[0] + 14, v[3] - 84, v[2] - 14, v[3] - 14]
}

/** Nota MIDI (21..108) bajo un punto del teclado, o null. Las negras van encima de las blancas. */
export function notaEnTeclado(kb: Rect4, x: number, y: number): number | null {
  if (x < kb[0] || x > kb[2] || y < kb[1] || y > kb[3]) return null
  const ww = (kb[2] - kb[0]) / 52
  const blanca = Math.min(51, Math.floor((x - kb[0]) / ww))
  if (y <= kb[1] + (kb[3] - kb[1]) * 0.6) {
    // negra: centrada en el borde izquierdo de la blanca siguiente
    let wi = 0
    for (let n = 21; n <= 108; n++) {
      if (esNegra(n)) {
        const cx = kb[0] + wi * ww
        if (Math.abs(x - cx) <= ww * 0.32) return n
        continue
      }
      wi++
    }
  }
  let wi = 0
  for (let n = 21; n <= 108; n++) {
    if (esNegra(n)) continue
    if (wi === blanca) return n
    wi++
  }
  return null
}

function teclado(ctx: Ctx, kb: Rect4, pulsada: number | null) {
  const ww = (kb[2] - kb[0]) / 52
  let wi = 0
  const negras: Array<[number, number]> = []
  for (let n = 21; n <= 108; n++) {
    if (esNegra(n)) {
      negras.push([n, kb[0] + wi * ww])
      continue
    }
    ctx.fillStyle = n === pulsada ? PAL.cian : '#12143A'
    ctx.fillRect(kb[0] + wi * ww + 0.6, kb[1], ww - 1.2, kb[3] - kb[1])
    ctx.strokeStyle = PAL.panelBorde
    ctx.strokeRect(kb[0] + wi * ww + 0.6, kb[1], ww - 1.2, kb[3] - kb[1])
    wi++
  }
  for (const [n, x] of negras) {
    ctx.fillStyle = n === pulsada ? PAL.cian : '#03030F'
    ctx.fillRect(x - ww * 0.32, kb[1], ww * 0.64, (kb[3] - kb[1]) * 0.6)
    ctx.strokeStyle = PAL.panelBorde
    ctx.strokeRect(x - ww * 0.32, kb[1], ww * 0.64, (kb[3] - kb[1]) * 0.6)
  }
}

function vectorscopio(ctx: Ctx, v: Rect4) {
  const cx = v[0] + 152, cy = (v[1] + v[3]) / 2 + 12, R = 116
  ctx.strokeStyle = 'rgba(25,217,255,0.25)'
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(25,217,255,0.10)'
  ctx.beginPath()
  ctx.arc(cx, cy, R / 2, 0, Math.PI * 2)
  ctx.stroke()
  linea(ctx, cx, cy - R - 6, cx, cy + R + 6, 'rgba(25,217,255,0.4)')
  linea(ctx, cx - R - 6, cy, cx + R + 6, cy, 'rgba(25,217,255,0.2)')
  const k = R * 0.7071
  linea(ctx, cx - k, cy - k, cx + k, cy + k, 'rgba(25,217,255,0.15)')
  linea(ctx, cx + k, cy - k, cx - k, cy + k, 'rgba(25,217,255,0.15)')
  texto(ctx, 'M', cx, cy - R - 14, FUENTE.etiqueta, PAL.textoEtiqueta, 'center')
  texto(ctx, '+S', cx + R + 8, cy, FUENTE.etiqueta, PAL.textoTenue)
  texto(ctx, '−S', cx - R - 8, cy, FUENTE.etiqueta, PAL.textoTenue, 'right')
}

const TITULO_VISUAL: Record<UiLayout['visualizador'], string> = {
  'espectro-dual': 'ESPECTRO IN / OUT',
  'espectro-instrumento': 'ESPECTRO OUT · TECLADO',
  vectorscopio: 'VECTORSCOPIO · ESPECTRO IN / OUT',
  'curva-tono': 'CURVA DE TONO · DETECTADO / CORREGIDO',
}

const NOTAS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Rejilla de semitonos del afinador (Vocal Tune); la réplica web no procesa audio, así que no hay curva. */
function curvaTono(ctx: Ctx, a: Rect4) {
  const centro = 62, rango = 12
  for (let s = -rango; s <= rango; s++) {
    const y = a[3] - ((s + rango) / (2 * rango)) * (a[3] - a[1])
    const n = (((centro + s) % 12) + 12) % 12
    const natural = !NOTAS[n]!.includes('#')
    linea(ctx, a[0], y, a[2], y, natural ? 'rgba(25,217,255,0.10)' : 'rgba(25,217,255,0.04)')
    if (natural) texto(ctx, `${NOTAS[n]}${Math.floor((centro + s) / 12) - 1}`, a[0] - 4, y, FUENTE.valorPeq, PAL.textoTenue, 'right')
  }
}

function visualizador(ctx: Ctx, e: EstadoDibujo) {
  const L = e.layout
  const v = L.zonas.visualizador
  panel(ctx, v, TITULO_VISUAL[L.visualizador])
  if (L.visualizador === 'vectorscopio') {
    vectorscopio(ctx, v)
    espectro(ctx, [v[0] + 310, v[1] + 32, v[2] - 40, v[3] - 22], e)
  } else if (L.visualizador === 'espectro-instrumento') {
    espectro(ctx, [v[0] + 14, v[1] + 32, v[2] - 40, v[3] - 112], e)
    teclado(ctx, [v[0] + 14, v[3] - 84, v[2] - 14, v[3] - 14], e.notaPulsada ?? null)
  } else if (L.visualizador === 'curva-tono') {
    curvaTono(ctx, [v[0] + 44, v[1] + 32, v[2] - 14, v[3] - 14])
  } else {
    espectro(ctx, L.zonas.espectro, e)
  }
  const m = L.zonas.miniPanel
  panel(ctx, m, 'MEDICIÓN')
  if (e.avisoMedicion) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(m[0] + 12, m[1] + 28, m[2] - m[0] - 24, m[3] - m[1] - 36)
    ctx.clip()
    const palabras = e.avisoMedicion.split(/\s+/)
    let lineaActual = ''
    let y = m[1] + 50
    ctx.font = FUENTE.cuerpo
    for (const p of palabras) {
      const prueba = lineaActual ? `${lineaActual} ${p}` : p
      if (ctx.measureText(prueba).width > m[2] - m[0] - 40 && lineaActual) {
        texto(ctx, lineaActual, m[0] + 20, y, FUENTE.cuerpo, PAL.textoEtiqueta)
        y += 18
        lineaActual = p
      } else lineaActual = prueba
    }
    texto(ctx, lineaActual, m[0] + 20, y, FUENTE.cuerpo, PAL.textoEtiqueta)
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------------
//  Página MIX / FX (FX Rack)
// ---------------------------------------------------------------------------------
const COLOR_BANDA = (b: number) => gradienteMarca(b / (BANDAS - 1))
const NOMBRE_BANDA = (b: number) => (b === 0 ? 'LOW SHELF' : b === BANDAS - 1 ? 'HIGH SHELF' : 'PEAK')

function botonPagina(ctx: Ctx, w: WidgetLayout, e: EstadoDibujo) {
  const r = w.rect
  const activa = (e.pagina ?? 0) === (w.paginaDestino ?? 1)
  const sobre = e.activo === w
  ctx.beginPath()
  ctx.roundRect(r[0], r[1], r[2] - r[0], r[3] - r[1], (r[3] - r[1]) / 2)
  ctx.fillStyle = activa ? 'rgba(25,217,255,0.34)' : sobre ? 'rgba(25,217,255,0.26)' : 'rgba(25,217,255,0.10)'
  ctx.fill()
  ctx.strokeStyle = activa || sobre ? 'rgba(25,217,255,0.95)' : 'rgba(25,217,255,0.55)'
  ctx.lineWidth = 1
  ctx.stroke()
  const fx = (w.paginaDestino ?? 1) === 1
  const rotulo = activa ? w.textoAbierta ?? 'EDITOR' : w.etiqueta || 'MIX / FX'
  texto(ctx, rotulo, fx ? (r[0] + r[2] - 6) / 2 : (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, FUENTE.etiqueta, activa || sobre ? PAL.textoTitulo : PAL.cian, 'center', true)
  // LED «rack encendido»: solo en el botón MIX / FX
  const base = fx ? widgetEq(e.layout.widgets)?.base : undefined
  if (base !== undefined) {
    const ons = [OFF.HpfOn, OFF.LpfOn, OFF.EqOn, OFF.CompOn, OFF.SatOn, OFF.ChOn, OFF.DlOn, OFF.RvOn, OFF.OutOn]
    if (ons.some((o) => e.valor(base + o) >= 0.5)) brillo(ctx, PAL.cianNucleo, 6, () => {
      ctx.fillStyle = PAL.cianNucleo
      ctx.beginPath()
      ctx.arc(r[2] - 9, (r[1] + r[3]) / 2, 2.6, 0, Math.PI * 2)
      ctx.fill()
    })
  }
}

/** Valor plano de un parámetro descrito por una banda del layout. */
function planoDe(e: EstadoDibujo, d?: { param: number; min: number; max: number; defecto: number; escala: 'linear' | 'log' | 'stepped' }): number {
  if (!d) return 0
  return aPlano({ min: d.min, max: d.max, defecto: d.defecto, escala: d.escala }, e.valor(d.param))
}

function botonBanda(ctx: Ctx, w: WidgetLayout, e: EstadoDibujo) {
  const b = w.selBanda ?? 0
  const sel = (e.bandaSel ?? BANDA_INICIAL) === b
  const c = COLOR_BANDA(b)
  const r = w.rect
  const tocada = Math.abs(planoDe(e, widgetEq(e.layout.widgets)?.bandas?.[b]?.gain)) > 0.05
  chaflan(ctx, r, 4)
  ctx.fillStyle = sel ? c.replace('rgb', 'rgba').replace(')', ',0.30)') : '#0A0C26'
  ctx.fill()
  ctx.strokeStyle = sel || e.activo === w ? c : PAL.panelBorde
  ctx.lineWidth = 1
  ctx.stroke()
  texto(ctx, w.etiqueta, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, FUENTE.etiqueta, sel ? PAL.textoTitulo : PAL.textoEtiqueta, 'center', true)
  if (tocada) {
    ctx.fillStyle = c
    ctx.beginPath()
    ctx.arc(r[2] - 6, r[1] + 6, 1.8, 0, Math.PI * 2)
    ctx.fill()
  }
}

function botonResetFx(ctx: Ctx, w: WidgetLayout, e: EstadoDibujo) {
  const r = w.rect
  const sobre = e.activo === w
  ctx.beginPath()
  ctx.roundRect(r[0], r[1], r[2] - r[0], r[3] - r[1], (r[3] - r[1]) / 2)
  ctx.fillStyle = sobre ? 'rgba(255,79,195,0.24)' : 'rgba(255,79,195,0.08)'
  ctx.fill()
  ctx.strokeStyle = sobre ? 'rgba(255,79,195,0.95)' : 'rgba(255,79,195,0.5)'
  ctx.lineWidth = 1
  ctx.stroke()
  texto(ctx, w.etiqueta || 'RESET FX', (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, FUENTE.etiqueta, sobre ? PAL.textoTitulo : PAL.alerta, 'center', true)
}

/** Gráfica del ecualizador: espectro de salida + curva de respuesta (EQ + filtros) + 6 nodos (misma geometría que GraficaEq). */
function graficaEq(ctx: Ctx, w: WidgetLayout, e: EstadoDibujo) {
  const [l, t, rr, b] = w.rect
  const ancho = rr - l, alto = b - t
  const dbMin = w.dbMin ?? -18, dbMax = w.dbMax ?? 18
  const yDb = (db: number) => b - ((Math.min(Math.max(db, dbMin), dbMax) - dbMin) / (dbMax - dbMin)) * alto
  const xF = (f: number) => l + (Math.log(f / 20) / Math.log(1000)) * ancho
  ctx.fillStyle = 'rgba(5,6,26,0.55)'
  ctx.fillRect(l, t, ancho, alto)
  ctx.strokeStyle = PAL.panelBorde
  ctx.lineWidth = 1
  ctx.strokeRect(l, t, ancho, alto)
  // espectro de salida de la pista (tenue, escala dBFS) bajo la curva
  const out = e.espectro?.out
  if (out && out.length > 1) {
    const n = out.length
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const x = l + (ancho * (i + 0.5)) / n
      const y = yDeDbfs(t, alto, out[i]!)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = 'rgba(25,217,255,0.45)'
    ctx.lineWidth = 1.2
    ctx.stroke()
    ctx.lineTo(l + ancho * (1 - 0.5 / n), b)
    ctx.lineTo(l + (ancho * 0.5) / n, b)
    ctx.closePath()
    ctx.fillStyle = 'rgba(25,217,255,0.07)'
    ctx.fill()
  }
  for (const [f, et] of FRECUENCIAS) {
    const x = xF(f)
    linea(ctx, x, t, x, b, 'rgba(25,217,255,0.07)')
    texto(ctx, et, x, b + 9, FUENTE.valorPeq, PAL.textoTenue, 'center')
  }
  for (let d = Math.ceil(dbMin / 6) * 6; d <= dbMax + 1e-9; d += 6) {
    const y = yDb(d)
    linea(ctx, l, y, rr, y, Math.abs(d) < 1e-9 ? 'rgba(25,217,255,0.4)' : 'rgba(25,217,255,0.07)')
    texto(ctx, `${d > 0 ? '+' : ''}${d}`, rr + 2, y, FUENTE.valorPeq, PAL.textoTenue)
  }
  const p = leerParamsEq(e.layout.widgets, e.valor)
  if (!p) return
  const sr = e.sampleRate ?? 48000
  if (p.hpfOn) linea(ctx, xF(p.hpfHz), t, xF(p.hpfHz), b, 'rgba(255,79,195,0.35)')
  if (p.lpfOn) linea(ctx, xF(p.lpfHz), t, xF(p.lpfHz), b, 'rgba(255,79,195,0.35)')
  const viva = p.eqOn || p.hpfOn || p.lpfOn
  const N = 180
  ctx.beginPath()
  for (let i = 0; i < N; i++) {
    const f = 20 * Math.pow(1000, i / (N - 1))
    const x = l + (ancho * i) / (N - 1), y = yDb(respuestaDb(p, sr, f, p.eqOn))
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = viva ? PAL.cian : 'rgba(25,217,255,0.35)'
  ctx.lineWidth = viva ? 1.8 : 1.2
  if (viva) brillo(ctx, PAL.cianGlow, 8, () => ctx.stroke())
  else ctx.stroke()
  ctx.lineTo(rr, yDb(0))
  ctx.lineTo(l, yDb(0))
  ctx.closePath()
  ctx.fillStyle = viva ? 'rgba(25,217,255,0.13)' : 'rgba(25,217,255,0.05)'
  ctx.fill()
  const sel = e.bandaSel ?? BANDA_INICIAL
  for (let k = 0; k < BANDAS; k++) {
    const nx = xF(p.bandas[k]!.hz), ny = yDb(p.bandas[k]!.gainDb)
    const c = COLOR_BANDA(k)
    const r = k === sel ? 9 : 7
    if (k === sel) brillo(ctx, c, 10, () => {
      ctx.fillStyle = c
      ctx.beginPath()
      ctx.arc(nx, ny, r + 1, 0, Math.PI * 2)
      ctx.fill()
    })
    ctx.fillStyle = p.eqOn ? '#0B0D27' : 'rgba(11,13,39,0.6)'
    ctx.beginPath()
    ctx.arc(nx, ny, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = p.eqOn ? c : 'rgba(255,255,255,0.25)'
    ctx.lineWidth = k === sel ? 2 : 1.4
    ctx.stroke()
    texto(ctx, String(k + 1), nx, ny, FUENTE.valorPeq, p.eqOn ? PAL.textoTitulo : PAL.textoTenue, 'center')
  }
  const bd = p.bandas[sel]!
  const fb = bd.hz >= 1000 ? `${(bd.hz / 1000).toFixed(2)} kHz` : `${bd.hz.toFixed(0)} Hz`
  texto(ctx, `BANDA ${sel + 1} · ${NOMBRE_BANDA(sel)} · ${fb} · ${bd.gainDb >= 0 ? '+' : ''}${bd.gainDb.toFixed(1)} dB · Q ${bd.q.toFixed(2)}`, 196, 107, FUENTE.valorPeq, PAL.textoValor)
  texto(ctx, 'ARRASTRA: FREQ / GAIN', 646, 341, FUENTE.valorPeq, PAL.textoTenue, 'right')
  texto(ctx, 'RUEDA: Q', 646, 355, FUENTE.valorPeq, PAL.textoTenue, 'right')
  texto(ctx, 'DOBLE CLIC: RESET BANDA', 646, 369, FUENTE.valorPeq, PAL.textoTenue, 'right')
}

function medidorGr(ctx: Ctx, w: WidgetLayout, e: EstadoDibujo) {
  const [l, t, r, b] = w.rect
  const barra: Rect4 = [l, t, r - 58, b]
  const base = w.base ?? widgetEq(e.layout.widgets)?.base
  const on = base !== undefined && e.valor(base + OFF.CompOn) >= 0.5
  const gr = on && e.grDb != null ? e.grDb : 0
  const SEGS = 48
  const sw = (barra[2] - barra[0]) / SEGS
  const maxDb = w.maxDb ?? 24
  for (let i = 0; i < SEGS; i++) {
    const x0 = barra[2] - (i + 1) * sw
    const nivel = ((i + 0.5) * maxDb) / SEGS
    ctx.fillStyle = gr >= nivel ? (on ? PAL.cian : 'rgba(25,217,255,0.4)') : on ? 'rgba(25,217,255,0.08)' : 'rgba(25,217,255,0.04)'
    ctx.fillRect(x0 + 1, barra[1], sw - 2, barra[3] - barra[1])
  }
  texto(ctx, e.grDb == null ? 'GR  —' : `GR ${gr.toFixed(1).padStart(4)} dB`, r + 4, (t + b) / 2, FUENTE.valorPeq, on ? PAL.textoValor : PAL.textoTenue, 'right')
}

/** Dibuja el editor completo. `ctx` ya debe estar escalado a unidades de diseño. */
export function dibujarEditor(ctx: Ctx, e: EstadoDibujo): void {
  const pagina = e.modo === 'basico' ? 0 : e.pagina ?? 0
  const L = layoutParaVista(e.layout, e.modo ?? 'avanzado', pagina)
  e = { ...e, layout: L }
  fondo(ctx, L)
  cabecera(ctx, e)
  if (pagina === 0) visualizador(ctx, e)
  const z = L.zonas.medidores
  let indiceMedidor = 0
  for (const w0 of L.widgets) {
    if (!visibleEnPagina(w0, pagina)) continue
    // las perillas FREQ / GAIN / Q siguen a la banda seleccionada del ecualizador
    const w = resolverWidget(L.widgets, w0, e.bandaSel ?? BANDA_INICIAL)
    if (w !== w0 && e.activo === w0) e = { ...e, activo: w }
    switch (w.tipo) {
      case 'section':
        seccion(ctx, w, e)
        break
      case 'knob':
        perilla(ctx, w, e)
        break
      case 'fader':
        fader(ctx, w, e)
        break
      case 'toggle':
        interruptor(ctx, w, e)
        break
      case 'dropdown':
        desplegable(ctx, w, e)
        break
      case 'reset':
        botonReset(ctx, w, e)
        break
      case 'pagina':
        botonPagina(ctx, w, e)
        break
      case 'modo':
        selectorModo(ctx, w, e)
        break
      case 'button':
        if (w.selBanda !== undefined) botonBanda(ctx, w, e)
        break
      case 'reset-fx':
        botonResetFx(ctx, w, e)
        break
      case 'mixfx-eq':
        graficaEq(ctx, w, e)
        break
      case 'mixfx-gr':
        medidorGr(ctx, w, e)
        break
      case 'meter': {
        const estandar = w.rect[1] === z.arriba && w.rect[3] === z.abajo && w.rect[0] >= z.x - 0.5
        let m: Medidor | null = null
        if (estandar && e.medidores) {
          m = indiceMedidor < 2 ? e.medidores.in[indiceMedidor as 0 | 1] : e.medidores.out[(indiceMedidor - 2) as 0 | 1]
          indiceMedidor++
        }
        medidor(ctx, w, m)
        break
      }
      default:
        break
    }
  }
  // etiquetas IN / OUT bajo los medidores estándar (como StereoMeters::drawLabels)
  if (pagina !== 0) return
  texto(ctx, L.instrumento ? 'MIDI' : 'IN', z.x + 12, z.abajo + 9, FUENTE.etiqueta, PAL.textoEtiqueta, 'center', true)
  texto(ctx, 'OUT', z.x + 57, z.abajo + 9, FUENTE.etiqueta, PAL.textoEtiqueta, 'center', true)
}
