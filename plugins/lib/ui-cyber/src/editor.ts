/**
 * Editor cyber interactivo sobre un <canvas>: dibuja la vista pedida (editor completo o una pestaña),
 * y traduce ratón, rueda y táctil a cambios de parámetros con el mismo comportamiento que el VST:
 * arrastre vertical (Mayús = fino), doble clic = valor por defecto, rueda = 1 % o un paso, clic en
 * interruptores y píldoras, desplegables con menú, y pulsación larga = escribir el valor.
 */

import { Balistica } from './espectro'
import { anchoDe, altoDe, escalaPara, widgetEn } from './disposicion'
import { dibujarEditor, type EstadoDibujo } from './dibujo'
import type { Rect4, UiLayout, WidgetLayout } from './tipos'
import { defDe, limitar01, normalizadoPorDefecto, pasoRueda } from './valores'

export type FaseCambio = 'inicio' | 'cambio' | 'fin' | 'unico'
export type RectCss = { x: number; y: number; ancho: number; alto: number }

export type OpcionesEditor = {
  layout: UiLayout
  valor: (param: number) => number
  /** Cambio de un parámetro. Un gesto = inicio → cambio… → fin (un paso de deshacer); un clic = unico. */
  cambiar: (param: number, normalizado: number, fase: FaseCambio) => void
  /** Columnas del espectro en dBFS con señal NUEVA, o null si no hay (la balística las hace caer). */
  espectro?: () => { in?: ArrayLike<number> | null; out?: ArrayLike<number> | null } | null
  medidores?: () => EstadoDibujo['medidores']
  logo?: CanvasImageSource | null
  avisoMedicion?: string
  /** Desplegable pulsado: el anfitrión muestra la lista de opciones. */
  menu?: (w: WidgetLayout, rect: RectCss) => void
  /** Pulsación larga o clic derecho: el anfitrión pide el valor por teclado. */
  entradaNumerica?: (w: WidgetLayout, rect: RectCss) => void
}

const COLUMNAS = 192
const PULSACION_LARGA_MS = 550

type Arrastre = { w: WidgetLayout; param: number; y0: number; n0: number; punteroId: number; movido: boolean }

export class EditorCyber {
  private vista: Rect4
  private escala = 1
  private dpr = 1
  private activo: WidgetLayout | null = null
  private arrastre: Arrastre | null = null
  private tactil = false
  private temporizador: ReturnType<typeof setTimeout> | null = null
  private readonly balIn = new Balistica(COLUMNAS)
  private readonly balOut = new Balistica(COLUMNAS)
  private hayIn = false
  private hayOut = false
  private readonly quitar: Array<() => void> = []

  constructor(private readonly lienzo: HTMLCanvasElement, private o: OpcionesEditor) {
    this.vista = [0, 0, o.layout.base.ancho, o.layout.base.alto]
    this.tactil = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches
    lienzo.style.touchAction = 'none'
    const en = <K extends keyof HTMLElementEventMap>(tipo: K, f: (e: HTMLElementEventMap[K]) => void, opciones?: AddEventListenerOptions) => {
      lienzo.addEventListener(tipo, f as EventListener, opciones)
      this.quitar.push(() => lienzo.removeEventListener(tipo, f as EventListener, opciones))
    }
    en('pointerdown', (e) => this.alBajar(e))
    en('pointermove', (e) => this.alMover(e))
    en('pointerup', (e) => this.alSubir(e))
    en('pointercancel', (e) => this.alSubir(e))
    en('pointerleave', () => {
      if (!this.arrastre) this.activo = null
    })
    en('dblclick', (e) => this.alDobleClic(e))
    en('contextmenu', (e) => this.alMenuContextual(e))
    en('wheel', (e) => this.alRueda(e), { passive: false })
  }

  actualizarOpciones(o: Partial<OpcionesEditor>): void {
    this.o = { ...this.o, ...o }
  }

  fijarVista(vista: Rect4): void {
    this.vista = vista
  }

  /** Ajusta el lienzo al ancho CSS disponible (y alto máximo); devuelve el alto CSS resultante. */
  redimensionar(anchoCss: number, altoMaxCss?: number): number {
    this.escala = escalaPara(this.vista, Math.max(1, anchoCss), altoMaxCss)
    this.dpr = typeof devicePixelRatio === 'number' ? Math.min(3, Math.max(1, devicePixelRatio)) : 1
    const w = anchoDe(this.vista) * this.escala, h = altoDe(this.vista) * this.escala
    this.lienzo.style.width = `${w}px`
    this.lienzo.style.height = `${h}px`
    this.lienzo.width = Math.round(w * this.dpr)
    this.lienzo.height = Math.round(h * this.dpr)
    return h
  }

  /** Un fotograma: balística del espectro con el dt real y dibujo. */
  dibujar(dt: number): void {
    const ctx = this.lienzo.getContext('2d')
    if (!ctx) return
    const nuevo = this.o.espectro?.() ?? null
    if (nuevo?.in !== undefined) this.hayIn = true
    if (nuevo?.out !== undefined) this.hayOut = true
    const inn = this.hayIn ? this.balIn.actualizar(nuevo?.in ?? null, dt) : null
    const out = this.hayOut ? this.balOut.actualizar(nuevo?.out ?? null, dt) : null
    const k = this.escala * this.dpr
    ctx.setTransform(k, 0, 0, k, -this.vista[0] * k, -this.vista[1] * k)
    ctx.clearRect(this.vista[0], this.vista[1], anchoDe(this.vista), altoDe(this.vista))
    dibujarEditor(ctx, {
      layout: this.o.layout,
      valor: this.o.valor,
      activo: this.activo,
      mostrarValores: this.tactil,
      espectro: { in: inn, out: out },
      medidores: this.o.medidores?.() ?? null,
      logo: this.o.logo ?? null,
      avisoMedicion: this.o.avisoMedicion,
    })
  }

  destruir(): void {
    this.cancelarPulsacion()
    for (const q of this.quitar.splice(0)) q()
  }

  // ---------------------------------------------------------------------------
  private aDiseno(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.lienzo.getBoundingClientRect()
    return { x: this.vista[0] + (e.clientX - r.left) / this.escala, y: this.vista[1] + (e.clientY - r.top) / this.escala }
  }

  private rectCss(w: WidgetLayout): RectCss {
    const r = this.lienzo.getBoundingClientRect()
    return {
      x: r.left + (w.rect[0] - this.vista[0]) * this.escala,
      y: r.top + (w.rect[1] - this.vista[1]) * this.escala,
      ancho: (w.rect[2] - w.rect[0]) * this.escala,
      alto: (w.rect[3] - w.rect[1]) * this.escala,
    }
  }

  private widget(e: PointerEvent | MouseEvent): WidgetLayout | null {
    const p = this.aDiseno(e)
    // 44 px CSS de área mínima en táctil, convertidos a unidades de diseño
    const minimo = (e as PointerEvent).pointerType === 'touch' || this.tactil ? 44 / this.escala : 0
    return widgetEn(this.o.layout, p.x, p.y, minimo)
  }

  private cancelarPulsacion(): void {
    if (this.temporizador) clearTimeout(this.temporizador)
    this.temporizador = null
  }

  private alBajar(e: PointerEvent): void {
    if (e.button !== 0) return
    if (e.pointerType === 'touch') this.tactil = true
    const w = this.widget(e)
    if (!w || w.param === undefined) return
    e.preventDefault()
    const param = w.param
    const n = this.o.valor(param)
    if (w.tipo === 'toggle' || w.tipo === 'section') {
      this.o.cambiar(param, n >= 0.5 ? 0 : 1, 'unico')
      return
    }
    if (w.tipo === 'dropdown') {
      this.activo = w
      this.o.menu?.(w, this.rectCss(w))
      return
    }
    if (w.tipo !== 'knob' && w.tipo !== 'fader') return
    this.lienzo.setPointerCapture?.(e.pointerId)
    const p = this.aDiseno(e)
    let n0 = n
    this.o.cambiar(param, n, 'inicio')
    if (w.tipo === 'fader') {
      // clic fuera de la tapa: salta a la posición (como Fader::onDown)
      const t = w.rect[1] + 8, b = w.rect[3] - 36
      const capY = b - n * (b - t)
      if (Math.abs(p.y - capY) > 8 && p.y >= t && p.y <= b) {
        n0 = limitar01((b - p.y) / (b - t))
        this.o.cambiar(param, n0, 'cambio')
      }
    }
    this.arrastre = { w, param, y0: p.y, n0, punteroId: e.pointerId, movido: false }
    this.activo = w
    this.cancelarPulsacion()
    if (this.o.entradaNumerica) {
      this.temporizador = setTimeout(() => {
        const a = this.arrastre
        if (!a || a.movido) return
        this.arrastre = null
        this.o.cambiar(a.param, a.n0, 'fin')
        this.o.entradaNumerica?.(a.w, this.rectCss(a.w))
      }, PULSACION_LARGA_MS)
    }
  }

  private alMover(e: PointerEvent): void {
    const a = this.arrastre
    if (!a || e.pointerId !== a.punteroId) {
      if (e.pointerType === 'mouse') this.activo = this.widget(e)
      return
    }
    const p = this.aDiseno(e)
    const dy = a.y0 - p.y
    if (Math.abs(dy) > 3) {
      a.movido = true
      this.cancelarPulsacion()
    }
    const d = defDe(a.w)
    let n: number
    if (a.w.tipo === 'fader') {
      const alto = a.w.rect[3] - 36 - (a.w.rect[1] + 8)
      n = limitar01(a.n0 + (dy * (e.shiftKey ? 0.2 : 1)) / alto)
    } else {
      n = limitar01(a.n0 + dy * (e.shiftKey ? 1 / 900 : 1 / 180))
      if (d?.escala === 'stepped' && (d.pasos ?? 0) > 0) n = Math.floor(n * (d.pasos ?? 1) + 0.5) / (d.pasos ?? 1)
    }
    this.o.cambiar(a.param, n, 'cambio')
  }

  private alSubir(e: PointerEvent): void {
    this.cancelarPulsacion()
    const a = this.arrastre
    if (!a || e.pointerId !== a.punteroId) return
    this.arrastre = null
    this.o.cambiar(a.param, this.o.valor(a.param), 'fin')
    if (e.pointerType !== 'mouse') this.activo = null
  }

  private alDobleClic(e: MouseEvent): void {
    const w = this.widget(e)
    const d = w ? defDe(w) : null
    if (!w || !d || (w.tipo !== 'knob' && w.tipo !== 'fader')) return
    this.o.cambiar(w.param!, normalizadoPorDefecto(d), 'unico')
  }

  private alMenuContextual(e: MouseEvent): void {
    const w = this.widget(e)
    if (!w || w.param === undefined || !this.o.entradaNumerica || (w.tipo !== 'knob' && w.tipo !== 'fader')) return
    e.preventDefault()
    this.o.entradaNumerica(w, this.rectCss(w))
  }

  private alRueda(e: WheelEvent): void {
    const w = this.widget(e)
    const d = w ? defDe(w) : null
    if (!w || !d || w.tipo === 'section' || w.tipo === 'toggle') return
    e.preventDefault()
    const dir = e.deltaY < 0 ? 1 : -1
    this.o.cambiar(w.param!, pasoRueda(d, this.o.valor(w.param!), dir, e.shiftKey), 'unico')
  }
}
