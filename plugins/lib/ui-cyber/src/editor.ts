/**
 * Editor cyber interactivo sobre un <canvas>: dibuja la vista pedida (editor completo o una pestaña),
 * y traduce ratón, rueda y táctil a cambios de parámetros con el mismo comportamiento que el VST:
 * arrastre vertical (Mayús = fino), doble clic o clic central = valor por defecto, rueda = 1 % o un paso, clic en
 * interruptores y píldoras, desplegables con menú, pulsación larga = escribir el valor, y en los
 * instrumentos el teclado en pantalla suena (clic = nota, arrastrar = glissando).
 */

import { Balistica } from './espectro'
import { anchoDe, altoDe, escalaPara, layoutParaVista, modoEnSelector, modoInicial, widgetEn } from './disposicion'
import { BANDA_INICIAL, dibujarEditor, notaEnTeclado, rectTeclado, type EstadoDibujo } from './dibujo'
import { BANDAS, OFF, leerParamsEq, resolverWidget, widgetEq, type ParamsEq } from './fxrack'
import type { ModoEditor, Rect4, UiLayout, WidgetLayout } from './tipos'
import { aNormalizado, defDe, limitar01, normalizadoPorDefecto, pasoRueda } from './valores'

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
  /** Botón RESET pulsado: el anfitrión devuelve todos los parámetros a su valor por defecto (un solo paso de deshacer). */
  reiniciar?: () => void
  /** Botón «MIX / FX» o «+N PARÁM.»: el anfitrión cambia de página (0 = editor del plugin, 1 = MIX / FX, 2 = PARÁMETROS). */
  cambiarPagina?: (pagina: number) => void
  /** Modo con el que abre el editor (por defecto, el del layout). */
  modo?: ModoEditor
  /** Selector BÁSICO | AVANZADO pulsado: el anfitrión puede guardar el modo de esta instancia (el editor ya lo aplica). */
  cambiarModo?: (modo: ModoEditor) => void
  /** RESET FX de la página MIX / FX: devuelve a su valor por defecto SOLO los parámetros del rack [base, base + RANGO). */
  reiniciarFx?: (base: number) => void
  /** Reducción de ganancia del compresor integrado (dB) o null si no hay medición (la web no procesa audio). */
  grDb?: () => number | null
  /** Teclado en pantalla de los instrumentos: el anfitrión hace sonar la nota (velocidad 0 = note-off). */
  tocarNota?: (nota: number, velocidad: number) => void
}

const COLUMNAS = 192
const PULSACION_LARGA_MS = 550

type Arrastre = { w: WidgetLayout; param: number; y0: number; n0: number; punteroId: number; movido: boolean }
/** Arrastre de un nodo de la gráfica del ecualizador (frecuencia horizontal, ganancia vertical). */
type ArrastreEq = { w: WidgetLayout; banda: number; x0: number; y0: number; nx0: number; ny0: number; punteroId: number }
/** Tecla del teclado en pantalla sostenida (arrastrar = glissando). */
type TeclaSostenida = { nota: number; punteroId: number }

export class EditorCyber {
  private vista: Rect4
  private escala = 1
  private dpr = 1
  private activo: WidgetLayout | null = null
  private arrastre: Arrastre | null = null
  private arrastreEq: ArrastreEq | null = null
  private tecla: TeclaSostenida | null = null
  private pagina = 0
  private modo: ModoEditor
  private banda = BANDA_INICIAL
  private tactil = false
  private temporizador: ReturnType<typeof setTimeout> | null = null
  private readonly balIn = new Balistica(COLUMNAS)
  private readonly balOut = new Balistica(COLUMNAS)
  private hayIn = false
  private hayOut = false
  private readonly quitar: Array<() => void> = []

  constructor(private readonly lienzo: HTMLCanvasElement, private o: OpcionesEditor) {
    this.vista = [0, 0, o.layout.base.ancho, o.layout.base.alto]
    this.modo = o.modo ?? modoInicial(o.layout)
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

  /** Página visible: 0 = editor del plugin, 1 = MIX / FX (la fija el anfitrión al recibir `cambiarPagina`). */
  fijarPagina(pagina: number): void {
    if (pagina === this.pagina) return
    this.pagina = pagina
    this.activo = null
    this.arrastre = null
    this.arrastreEq = null
  }

  get paginaActual(): number {
    return this.modo === 'basico' ? 0 : this.pagina
  }

  /** Modo Básico (controles esenciales) o Avanzado (100 % de los parámetros). Las páginas extra son del Avanzado. */
  fijarModo(modo: ModoEditor): void {
    if (modo === this.modo) return
    this.modo = modo
    this.activo = null
    this.arrastre = null
    this.arrastreEq = null
    if (modo === 'basico' && this.pagina !== 0) {
      this.pagina = 0
      this.o.cambiarPagina?.(0)
    }
  }

  get modoActual(): ModoEditor {
    return this.modo
  }

  /** Layout tal como se ve ahora (modo y página): el que se dibuja y el que recibe los clics. */
  private get visible(): UiLayout {
    return layoutParaVista(this.o.layout, this.modo, this.paginaActual)
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
      pagina: this.paginaActual,
      modo: this.modo,
      bandaSel: this.banda,
      grDb: this.o.grDb?.() ?? null,
      notaPulsada: this.tecla?.nota ?? null,
    })
  }

  destruir(): void {
    this.soltarTecla()
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

  /** Widget bajo el puntero (el original del layout; ver `resolver` para las perillas que siguen a la banda del EQ). */
  private widget(e: PointerEvent | MouseEvent): WidgetLayout | null {
    const p = this.aDiseno(e)
    // 44 px CSS de área mínima en táctil, convertidos a unidades de diseño
    const minimo = (e as PointerEvent).pointerType === 'touch' || this.tactil ? 44 / this.escala : 0
    return widgetEn(this.visible, p.x, p.y, minimo, this.paginaActual)
  }

  private resolver(w: WidgetLayout): WidgetLayout {
    return resolverWidget(this.o.layout.widgets, w, this.banda)
  }

  // --- gráfica del ecualizador (página MIX / FX) ---
  private xDeF(w: WidgetLayout, f: number) {
    return w.rect[0] + (Math.log(f / (w.fMin ?? 20)) / Math.log((w.fMax ?? 20000) / (w.fMin ?? 20))) * (w.rect[2] - w.rect[0])
  }
  private fDeX(w: WidgetLayout, x: number) {
    const u = limitar01((x - w.rect[0]) / (w.rect[2] - w.rect[0]))
    return (w.fMin ?? 20) * Math.pow((w.fMax ?? 20000) / (w.fMin ?? 20), u)
  }
  private yDeDb(w: WidgetLayout, db: number) {
    const lo = w.dbMin ?? -18, hi = w.dbMax ?? 18
    return w.rect[3] - ((Math.min(Math.max(db, lo), hi) - lo) / (hi - lo)) * (w.rect[3] - w.rect[1])
  }
  private dbDeY(w: WidgetLayout, y: number) {
    const lo = w.dbMin ?? -18, hi = w.dbMax ?? 18
    return lo + ((w.rect[3] - y) / (w.rect[3] - w.rect[1])) * (hi - lo)
  }
  private nodoCerca(w: WidgetLayout, p: ParamsEq, x: number, y: number): number {
    let mejor = -1
    let dMejor = 15 * 15
    for (let b = 0; b < BANDAS; b++) {
      const dx = this.xDeF(w, p.bandas[b]!.hz) - x, dy = this.yDeDb(w, p.bandas[b]!.gainDb) - y
      const d = dx * dx + dy * dy
      if (d <= dMejor) {
        dMejor = d
        mejor = b
      }
    }
    return mejor
  }

  /** Nota del teclado en pantalla bajo el puntero (solo en el editor del plugin, no en MIX / FX). */
  private notaBajo(e: PointerEvent): number | null {
    if (this.paginaActual !== 0 || !this.o.tocarNota) return null
    const kb = rectTeclado(this.o.layout)
    if (!kb) return null
    const p = this.aDiseno(e)
    return notaEnTeclado(kb, p.x, p.y)
  }
  /** Más fuerte hacia el borde inferior de la tecla, como en el VST nativo. */
  private velocidadEn(e: PointerEvent): number {
    const kb = rectTeclado(this.o.layout)
    if (!kb) return 0.7
    const t = limitar01((this.aDiseno(e).y - kb[1]) / (kb[3] - kb[1]))
    return 0.35 + 0.6 * t
  }
  private soltarTecla(): void {
    if (!this.tecla) return
    this.o.tocarNota?.(this.tecla.nota, 0)
    this.tecla = null
  }

  private cancelarPulsacion(): void {
    if (this.temporizador) clearTimeout(this.temporizador)
    this.temporizador = null
  }

  private bajarEq(e: PointerEvent, w: WidgetLayout): void {
    const eq = leerParamsEq(this.o.layout.widgets, this.o.valor)
    if (!eq || !w.bandas || w.base === undefined) return
    const p = this.aDiseno(e)
    const b = this.nodoCerca(w, eq, p.x, p.y)
    if (b < 0) return
    e.preventDefault()
    this.lienzo.setPointerCapture?.(e.pointerId)
    this.banda = b
    const bd = w.bandas[b]!
    if (!eq.eqOn) this.o.cambiar(w.base + OFF.EqOn, 1, 'unico') // tocar un nodo enciende el ecualizador
    this.o.cambiar(bd.freq.param, this.o.valor(bd.freq.param), 'inicio')
    this.o.cambiar(bd.gain.param, this.o.valor(bd.gain.param), 'inicio')
    this.arrastreEq = { w, banda: b, x0: p.x, y0: p.y, nx0: this.xDeF(w, eq.bandas[b]!.hz), ny0: this.yDeDb(w, eq.bandas[b]!.gainDb), punteroId: e.pointerId }
    this.activo = w
  }

  private alBajar(e: PointerEvent): void {
    if (e.button === 1) {
      // clic central = valor por defecto (como el doble clic), una sola vez y sin autoscroll
      e.preventDefault()
      this.alDobleClic(e)
      return
    }
    if (e.button !== 0) return
    if (e.pointerType === 'touch') this.tactil = true
    const nota = this.notaBajo(e)
    if (nota !== null) {
      e.preventDefault()
      this.lienzo.setPointerCapture?.(e.pointerId)
      this.soltarTecla()
      this.tecla = { nota, punteroId: e.pointerId }
      this.o.tocarNota?.(nota, this.velocidadEn(e))
      return
    }
    const wo = this.widget(e)
    const w = wo ? this.resolver(wo) : null
    if (w?.tipo === 'reset') {
      e.preventDefault()
      this.o.reiniciar?.()
      return
    }
    if (w?.tipo === 'pagina') {
      e.preventDefault()
      const destino = w.paginaDestino ?? 1
      this.o.cambiarPagina?.(this.pagina === destino ? 0 : destino)
      return
    }
    if (w?.tipo === 'modo') {
      e.preventDefault()
      const modo = modoEnSelector(w, this.aDiseno(e).x)
      if (modo !== this.modo) {
        this.fijarModo(modo)
        this.o.cambiarModo?.(modo)
      }
      return
    }
    if (w?.tipo === 'reset-fx') {
      e.preventDefault()
      const base = widgetEq(this.o.layout.widgets)?.base
      if (base !== undefined) this.o.reiniciarFx?.(base)
      return
    }
    if (w?.tipo === 'button') {
      if (w.selBanda !== undefined) {
        e.preventDefault()
        this.banda = w.selBanda
      }
      return
    }
    if (w?.tipo === 'mixfx-eq') {
      this.bajarEq(e, w)
      return
    }
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
    this.activo = wo
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

  private moverEq(e: PointerEvent, a: ArrastreEq): void {
    const p = this.aDiseno(e)
    const k = e.shiftKey ? 0.2 : 1
    const bd = a.w.bandas![a.banda]!
    const x = a.nx0 + (p.x - a.x0) * k, y = a.ny0 + (p.y - a.y0) * k
    const f = Math.min(Math.max(this.fDeX(a.w, x), bd.freq.min), bd.freq.max)
    let g = Math.round(this.dbDeY(a.w, y) * 10) / 10
    if (Math.abs(g) < 0.35) g = 0 // imán a 0 dB
    g = Math.min(Math.max(g, bd.gain.min), bd.gain.max)
    this.o.cambiar(bd.freq.param, aNormalizado(bd.freq, f), 'cambio')
    this.o.cambiar(bd.gain.param, aNormalizado(bd.gain, g), 'cambio')
  }

  private alMover(e: PointerEvent): void {
    const t = this.tecla
    if (t && e.pointerId === t.punteroId) {
      const nota = this.notaBajo(e)
      if (nota !== null && nota !== t.nota) {
        this.o.tocarNota?.(t.nota, 0)
        this.tecla = { nota, punteroId: t.punteroId }
        this.o.tocarNota?.(nota, this.velocidadEn(e))
      }
      return
    }
    const q = this.arrastreEq
    if (q && e.pointerId === q.punteroId) {
      this.moverEq(e, q)
      return
    }
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
    if (this.tecla && e.pointerId === this.tecla.punteroId) {
      this.soltarTecla()
      return
    }
    const q = this.arrastreEq
    if (q && e.pointerId === q.punteroId) {
      this.arrastreEq = null
      const bd = q.w.bandas![q.banda]!
      this.o.cambiar(bd.freq.param, this.o.valor(bd.freq.param), 'fin')
      this.o.cambiar(bd.gain.param, this.o.valor(bd.gain.param), 'fin')
      if (e.pointerType !== 'mouse') this.activo = null
      return
    }
    const a = this.arrastre
    if (!a || e.pointerId !== a.punteroId) return
    this.arrastre = null
    this.o.cambiar(a.param, this.o.valor(a.param), 'fin')
    if (e.pointerType !== 'mouse') this.activo = null
  }

  private alDobleClic(e: MouseEvent): void {
    const wo = this.widget(e)
    if (wo?.tipo === 'mixfx-eq' && wo.bandas) {
      // doble clic sobre un nodo: restablece frecuencia, ganancia y Q de esa banda
      const eq = leerParamsEq(this.o.layout.widgets, this.o.valor)
      const p = this.aDiseno(e)
      const b = eq ? this.nodoCerca(wo, eq, p.x, p.y) : -1
      if (b >= 0) for (const d of [wo.bandas[b]!.freq, wo.bandas[b]!.gain, wo.bandas[b]!.q]) this.o.cambiar(d.param, aNormalizado(d, d.defecto), 'unico')
      return
    }
    const w = wo ? this.resolver(wo) : null
    const d = w ? defDe(w) : null
    if (!w || !d || (w.tipo !== 'knob' && w.tipo !== 'fader')) return
    this.o.cambiar(w.param!, normalizadoPorDefecto(d), 'unico')
  }

  private alMenuContextual(e: MouseEvent): void {
    const wo = this.widget(e)
    const w = wo ? this.resolver(wo) : null
    if (!w || w.param === undefined || !this.o.entradaNumerica || (w.tipo !== 'knob' && w.tipo !== 'fader')) return
    e.preventDefault()
    this.o.entradaNumerica(w, this.rectCss(w))
  }

  private alRueda(e: WheelEvent): void {
    const wo = this.widget(e)
    if (wo?.tipo === 'mixfx-eq' && wo.bandas) {
      // rueda sobre la gráfica: Q de la banda bajo el puntero (o de la seleccionada)
      e.preventDefault()
      const eq = leerParamsEq(this.o.layout.widgets, this.o.valor)
      const p = this.aDiseno(e)
      const b = eq ? this.nodoCerca(wo, eq, p.x, p.y) : -1
      if (b >= 0) this.banda = b
      const q = wo.bandas[this.banda]!.q
      const n = this.o.valor(q.param)
      this.o.cambiar(q.param, limitar01(n + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.01 : 0.04)), 'unico')
      return
    }
    const w = wo ? this.resolver(wo) : null
    const d = w ? defDe(w) : null
    if (!w || !d || w.tipo === 'section' || w.tipo === 'toggle') return
    e.preventDefault()
    const dir = e.deltaY < 0 ? 1 : -1
    this.o.cambiar(w.param!, pasoRueda(d, this.o.valor(w.param!), dir, e.shiftKey), 'unico')
  }
}
