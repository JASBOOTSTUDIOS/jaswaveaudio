/**
 * Dibujo en Canvas 2D del editor cyber, en unidades de diseño (1100×620), con los mismos tokens y
 * geometría que plugins/shared-ui (jw_ui_widgets.cpp, jw_ui_plantilla.h): marco, cabecera, secciones,
 * perillas, fader, interruptores, desplegables, medidores y los visualizadores comunes.
 */

import { DB_MAX, DB_MIN, xDeFrecuencia, yDeDbfs } from './espectro'
import { pildora } from './disposicion'
import type { Rect4, UiLayout, WidgetLayout } from './tipos'
import { aPlano, defDe, formatear } from './valores'

/** Tokens de V3 §3.1 (idénticos a Pal en jw_ui.h). */
export const PAL = {
  metalAlto: '#3A4148',
  metalBajo: '#15191D',
  metalBrillo: '#5C666F',
  metalSombra: '#0A0C0E',
  pantallaCentro: '#0A1822',
  pantallaBorde: '#050D14',
  panelFondo: 'rgba(11,24,35,0.88)',
  panelBorde: '#1E4656',
  reticula: 'rgba(22,53,67,0.55)',
  cian: '#2FD6F2',
  cianNucleo: '#BFF6FF',
  cianGlow: 'rgba(47,214,242,0.35)',
  espectroIn: 'rgba(88,139,158,0.65)',
  textoTitulo: '#7FE3F5',
  textoEtiqueta: '#8FB4BF',
  textoValor: '#A8EEFA',
  textoTenue: '#4F6B75',
  alerta: '#F2B544',
  bloqueado: '#5A6870',
  perillaCuerpo: '#0E1A22',
  perillaPista: '#1A2C36',
} as const

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
}

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
  ctx.fillStyle = '#06080A'
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
  for (const x of [15, W - 15]) brillo(ctx, PAL.cian, 10, () => {
    ctx.fillStyle = 'rgba(191,246,255,0.8)'
    ctx.fillRect(x - 0.8, H / 2 - 33, 1.6, 66)
  })
  // pantalla
  const p = layout.zonas.pantalla
  const rg = ctx.createRadialGradient((p[0] + p[2]) / 2, (p[1] + p[3]) / 2, 0, (p[0] + p[2]) / 2, (p[1] + p[3]) / 2, (p[2] - p[0]) * 0.62)
  rg.addColorStop(0, PAL.pantallaCentro)
  rg.addColorStop(1, PAL.pantallaBorde)
  chaflan(ctx, p, 14)
  ctx.fillStyle = rg
  ctx.fill()
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
  ctx.strokeStyle = 'rgba(47,214,242,0.35)'
  ctx.stroke()
}

function cabecera(ctx: Ctx, e: EstadoDibujo) {
  const L = e.layout
  if (e.logo) ctx.drawImage(e.logo, 52, 42, 28, 28)
  brillo(ctx, PAL.cianGlow, 6, () => texto(ctx, L.titulo, 90, 58, FUENTE.titulo, PAL.textoTitulo, 'left', true))
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
  texto(ctx, 'JASWAVE', 1046, 56, FUENTE.marca, PAL.textoTitulo, 'right', true)
  linea(ctx, 918, 74, 1046, 74, 'rgba(47,214,242,0.4)')
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
  linea(ctx, w.rect[0] + 8, w.rect[1] + 26, w.rect[2] - 8, w.rect[1] + 26, 'rgba(30,70,86,0.6)')
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
    ctx.strokeStyle = 'rgba(47,214,242,0.45)'
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
  ctx.strokeStyle = 'rgba(92,102,111,0.75)'
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
    linea(ctx, s[0] - (i % 5 === 0 ? 9 : 6), y, s[0] - 3, y, 'rgba(79,107,117,0.7)')
  }
  ctx.fillStyle = '#020507'
  ctx.fillRect(s[0] - 1, s[1] - 1, s[2] - s[0] + 2, s[3] - s[1] + 2)
  ctx.strokeStyle = PAL.panelBorde
  ctx.strokeRect(s[0], s[1], s[2] - s[0], s[3] - s[1])
  ctx.fillStyle = 'rgba(47,214,242,0.32)'
  ctx.fillRect(s[0] + 1, capY, s[2] - s[0] - 2, s[3] - capY - 0.5)
  const g = ctx.createLinearGradient(0, capY - 5, 0, capY + 5)
  g.addColorStop(0, '#6A747E')
  g.addColorStop(1, '#2A3036')
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
    ctx.fillStyle = '#0E2C38'
    ctx.fill()
  })
  else {
    chaflan(ctx, r, 4)
    ctx.fillStyle = '#08131B'
    ctx.fill()
  }
  chaflan(ctx, r, 4)
  ctx.strokeStyle = on ? PAL.cian : 'rgba(30,70,86,0.8)'
  ctx.lineWidth = 1
  ctx.stroke()
  texto(ctx, w.etiqueta, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, FUENTE.etiqueta, on ? PAL.cianNucleo : PAL.textoEtiqueta, 'center', true)
}

function desplegable(ctx: Ctx, w: WidgetLayout, e: EstadoDibujo) {
  const r = w.rect
  let bx = r[0]
  if (w.etiqueta) {
    ctx.font = FUENTE.etiqueta
    conEspaciado(ctx, true, 11)
    const lw = ctx.measureText(w.etiqueta).width + 8
    conEspaciado(ctx, false, 11)
    texto(ctx, w.etiqueta, r[0], (r[1] + r[3]) / 2, FUENTE.etiqueta, PAL.textoEtiqueta, 'left', true)
    bx = r[0] + lw
  }
  const caja: Rect4 = [bx, r[1] + 1, r[2], r[3] - 1]
  ctx.fillStyle = '#07121A'
  ctx.fillRect(caja[0], caja[1], caja[2] - caja[0], caja[3] - caja[1])
  ctx.strokeStyle = e.activo === w ? 'rgba(47,214,242,0.7)' : PAL.panelBorde
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
  ctx.fillStyle = '#03080C'
  ctx.fillRect(bar[0] - 1, bar[1] - 1, bar[2] - bar[0] + 2, bar[3] - bar[1] + 2)
  for (let i = 0; i < segs; i++) {
    const y0 = bar[3] - (i + 1) * segH
    const top = i === segs - 1
    ctx.fillStyle = i < lit ? (top ? PAL.alerta : PAL.cian) : top ? 'rgba(242,181,68,0.08)' : 'rgba(47,214,242,0.08)'
    ctx.fillRect(bar[0], y0 + 0.8, bar[2] - bar[0], segH - 1.6)
  }
  if (conEtiqueta) texto(ctx, w.etiqueta, (w.rect[0] + w.rect[2]) / 2, w.rect[3] - 7.5, FUENTE.etiqueta, PAL.textoEtiqueta, 'center', true)
}

// ---------------------------------------------------------------------------------
//  Visualizador y mini-panel
// ---------------------------------------------------------------------------------
function panel(ctx: Ctx, r: Rect4, titulo: string) {
  chaflan(ctx, r, 6)
  ctx.fillStyle = 'rgba(7,18,26,0.55)'
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
    linea(ctx, x, a[1], x, a[3], 'rgba(47,214,242,0.07)')
    texto(ctx, et, x, a[3] + 9, FUENTE.valorPeq, PAL.textoTenue, 'center')
  }
  for (let d = DB_MIN; d <= DB_MAX; d += 24) {
    const y = yDeDbfs(a[1], alto, d)
    linea(ctx, a[0], y, a[2], y, d === 0 ? 'rgba(47,214,242,0.4)' : 'rgba(47,214,242,0.07)')
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
  if (inn) traza(inn, PAL.espectroIn, 'rgba(88,139,158,0.08)', 1, false)
  if (out) traza(out, PAL.cian, 'rgba(47,214,242,0.15)', 1.8, true)
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

function teclado(ctx: Ctx, kb: Rect4) {
  const negra = (n: number) => [1, 3, 6, 8, 10].includes(n % 12)
  const ww = (kb[2] - kb[0]) / 52
  let wi = 0
  const negras: number[] = []
  for (let n = 21; n <= 108; n++) {
    if (negra(n)) {
      negras.push(kb[0] + wi * ww)
      continue
    }
    ctx.fillStyle = '#0F1E28'
    ctx.fillRect(kb[0] + wi * ww + 0.6, kb[1], ww - 1.2, kb[3] - kb[1])
    ctx.strokeStyle = PAL.panelBorde
    ctx.strokeRect(kb[0] + wi * ww + 0.6, kb[1], ww - 1.2, kb[3] - kb[1])
    wi++
  }
  for (const x of negras) {
    ctx.fillStyle = '#03080C'
    ctx.fillRect(x - ww * 0.32, kb[1], ww * 0.64, (kb[3] - kb[1]) * 0.6)
    ctx.strokeStyle = PAL.panelBorde
    ctx.strokeRect(x - ww * 0.32, kb[1], ww * 0.64, (kb[3] - kb[1]) * 0.6)
  }
}

function vectorscopio(ctx: Ctx, v: Rect4) {
  const cx = v[0] + 152, cy = (v[1] + v[3]) / 2 + 12, R = 116
  ctx.strokeStyle = 'rgba(47,214,242,0.25)'
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(47,214,242,0.10)'
  ctx.beginPath()
  ctx.arc(cx, cy, R / 2, 0, Math.PI * 2)
  ctx.stroke()
  linea(ctx, cx, cy - R - 6, cx, cy + R + 6, 'rgba(47,214,242,0.4)')
  linea(ctx, cx - R - 6, cy, cx + R + 6, cy, 'rgba(47,214,242,0.2)')
  const k = R * 0.7071
  linea(ctx, cx - k, cy - k, cx + k, cy + k, 'rgba(47,214,242,0.15)')
  linea(ctx, cx + k, cy - k, cx - k, cy + k, 'rgba(47,214,242,0.15)')
  texto(ctx, 'M', cx, cy - R - 14, FUENTE.etiqueta, PAL.textoEtiqueta, 'center')
  texto(ctx, '+S', cx + R + 8, cy, FUENTE.etiqueta, PAL.textoTenue)
  texto(ctx, '−S', cx - R - 8, cy, FUENTE.etiqueta, PAL.textoTenue, 'right')
}

const TITULO_VISUAL: Record<UiLayout['visualizador'], string> = {
  'espectro-dual': 'ESPECTRO IN / OUT',
  'espectro-instrumento': 'ESPECTRO OUT · TECLADO',
  vectorscopio: 'VECTORSCOPIO · ESPECTRO IN / OUT',
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
    teclado(ctx, [v[0] + 14, v[3] - 84, v[2] - 14, v[3] - 14])
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

/** Dibuja el editor completo. `ctx` ya debe estar escalado a unidades de diseño. */
export function dibujarEditor(ctx: Ctx, e: EstadoDibujo): void {
  const L = e.layout
  fondo(ctx, L)
  cabecera(ctx, e)
  visualizador(ctx, e)
  const z = L.zonas.medidores
  let indiceMedidor = 0
  for (const w of L.widgets) {
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
  texto(ctx, L.instrumento ? 'MIDI' : 'IN', z.x + 12, z.abajo + 9, FUENTE.etiqueta, PAL.textoEtiqueta, 'center', true)
  texto(ctx, 'OUT', z.x + 57, z.abajo + 9, FUENTE.etiqueta, PAL.textoEtiqueta, 'center', true)
}
