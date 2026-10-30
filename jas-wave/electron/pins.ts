/**
 * Gestor de pins (proceso main): mantiene la jerarquía de elementos anclados y la aplica al sistema.
 *  - editores nativos del host: comando `pinEditor` (HWND_TOPMOST en el host, ordenado por índice),
 *  - paneles flotantes (BrowserWindow): setAlwaysOnTop(true, 'floating', nivel) + moveTop en orden.
 * La lista es por proyecto y se persiste en userData/pins.json. Sin Electron en este archivo (dependencias
 * inyectadas) para poder probarlo con node:test.
 */

import {
  anclar,
  conProyecto,
  crearPin,
  desanclar,
  indiceDe,
  mover,
  moverA,
  ordenDeAplicacion,
  parsearPersistido,
  serializarPersistido,
  type Pin,
  type PinsPersistidos,
  type TipoPin,
} from './pins-jerarquia'

export type VentanaPin = {
  isDestroyed(): boolean
  setAlwaysOnTop(flag: boolean, nivel?: string, relativeLevel?: number): void
  moveTop(): void
  hide(): void
  showInactive(): void
  isVisible(): boolean
  on(evento: 'focus', cb: () => void): unknown
}

export type EstadoPins = { proyecto: string; lista: Pin[] }

export type DepsPins = {
  leerArchivo(): string | null
  escribirArchivo(contenido: string): void
  /** Envía un comando al plugin host (sin esperar). */
  enviarHost(cmd: Record<string, unknown>): void
  ventanaPanel(toolId: string): VentanaPin | null
  difundir(estado: EstadoPins): void
}

const PROYECTO_DEFECTO = 'sin-proyecto'

export class GestorPins {
  private proyecto = PROYECTO_DEFECTO
  private lista: Pin[] = []
  private persistido: PinsPersistidos
  /** Lo que ya está aplicado al SO (para desanclar lo que sale de la lista). */
  private aplicados = new Map<string, Pin>()
  private ocultos = new Set<string>()
  private appOculta = false
  private escuchados = new WeakSet<object>()
  private temporizador: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: DepsPins) {
    this.persistido = parsearPersistido(deps.leerArchivo())
    this.lista = (this.persistido.proyectos[this.proyecto] ?? []).slice()
  }

  estado(): EstadoPins {
    return { proyecto: this.proyecto, lista: this.lista.slice() }
  }

  /** Cambia de proyecto: desancla lo del anterior y aplica la jerarquía guardada del nuevo. */
  establecerProyecto(clave: string): EstadoPins {
    const nueva = (clave || PROYECTO_DEFECTO).slice(0, 200)
    if (nueva === this.proyecto) return this.estado()
    this.proyecto = nueva
    this.lista = (this.persistido.proyectos[nueva] ?? []).slice()
    this.cambio()
    return this.estado()
  }

  alternar(tipo: TipoPin, id: string, etiqueta?: string): EstadoPins {
    if (!id) return this.estado()
    const pin = crearPin(tipo, id, etiqueta)
    this.lista = indiceDe(this.lista, pin.clave) >= 0 ? desanclar(this.lista, pin.clave) : anclar(this.lista, pin)
    this.cambio()
    return this.estado()
  }

  quitar(clave: string): EstadoPins {
    this.lista = desanclar(this.lista, clave)
    this.cambio()
    return this.estado()
  }

  mover(clave: string, delta: number): EstadoPins {
    this.lista = mover(this.lista, clave, delta)
    this.cambio()
    return this.estado()
  }

  moverA(clave: string, destino: number): EstadoPins {
    this.lista = moverA(this.lista, clave, destino)
    this.cambio()
    return this.estado()
  }

  /** El slot se descargó: su pin desaparece (no se deja colgado). */
  slotDescargado(slotId: string): void {
    const antes = this.lista.length
    this.lista = desanclar(this.lista, crearPin('editor', slotId).clave)
    if (this.lista.length !== antes) this.cambio()
  }

  /** Antes de abrir un editor flotante: el host debe saber si nace anclado (también tras reiniciar el host). */
  prepararEditor(slotId: string): void {
    const i = indiceDe(this.lista, crearPin('editor', slotId).clave)
    if (i >= 0) this.deps.enviarHost({ type: 'pinEditor', slotId, pinned: true, index: i, reorder: false })
  }

  /** Tras abrir/crear una ventana de panel flotante: aplicar su pin si lo tiene. */
  ventanaAbierta(toolId: string, win: VentanaPin): void {
    if (!this.escuchados.has(win)) {
      this.escuchados.add(win)
      // un anclado que recibe el foco subiría al frente rompiendo la jerarquía: se reaplica (diferido)
      win.on('focus', () => {
        if (indiceDe(this.lista, crearPin('panel', toolId).clave) >= 0) this.reaplicarDiferido()
      })
    }
    if (indiceDe(this.lista, crearPin('panel', toolId).clave) >= 0) this.reaplicarDiferido()
  }

  /** Política con la app: minimizada/oculta → los anclados se ocultan; al volver, reaparecen. */
  appOcultada(oculta: boolean): void {
    if (this.appOculta === oculta) return
    this.appOculta = oculta
    this.deps.enviarHost({ type: 'setPinsVisible', visible: !oculta })
    for (const pin of this.lista) {
      if (pin.tipo !== 'panel') continue
      const win = this.deps.ventanaPanel(pin.id)
      if (!win || win.isDestroyed()) continue
      if (oculta) {
        if (win.isVisible()) {
          this.ocultos.add(pin.clave)
          win.hide()
        }
      } else if (this.ocultos.has(pin.clave)) {
        this.ocultos.delete(pin.clave)
        win.showInactive()
      }
    }
    if (!oculta) this.reaplicar()
  }

  reaplicarDiferido(): void {
    if (this.temporizador) return
    this.temporizador = setTimeout(() => {
      this.temporizador = null
      this.reaplicar()
    }, 40)
    ;(this.temporizador as { unref?: () => void }).unref?.()
  }

  /** Aplica al SO: desancla lo que salió y apila los anclados del índice más alto al 0 (el 0 queda encima). */
  reaplicar(): void {
    const vigentes = new Set(this.lista.map((p) => p.clave))
    for (const [clave, pin] of this.aplicados) {
      if (vigentes.has(clave)) continue
      this.aplicados.delete(clave)
      this.ocultos.delete(clave)
      if (pin.tipo === 'editor') this.deps.enviarHost({ type: 'pinEditor', slotId: pin.id, pinned: false, index: 0 })
      else {
        const win = this.deps.ventanaPanel(pin.id)
        if (win && !win.isDestroyed()) win.setAlwaysOnTop(false)
      }
    }
    if (this.appOculta) {
      // oculta: solo se registran (el host guarda el índice); no se sube nada hasta restaurar
      for (const pin of this.lista) {
        this.aplicados.set(pin.clave, pin)
        if (pin.tipo === 'editor') {
          this.deps.enviarHost({ type: 'pinEditor', slotId: pin.id, pinned: true, index: indiceDe(this.lista, pin.clave), reorder: false })
        }
      }
      return
    }
    const total = this.lista.length
    for (const pin of ordenDeAplicacion(this.lista)) {
      const indice = indiceDe(this.lista, pin.clave)
      this.aplicados.set(pin.clave, pin)
      if (pin.tipo === 'editor') {
        this.deps.enviarHost({ type: 'pinEditor', slotId: pin.id, pinned: true, index: indice, reorder: false, raise: true })
      } else {
        const win = this.deps.ventanaPanel(pin.id)
        if (!win || win.isDestroyed()) continue
        win.setAlwaysOnTop(true, 'floating', Math.min(10, total - 1 - indice))
        win.moveTop()
      }
    }
  }

  private cambio(): void {
    this.persistido = conProyecto(this.persistido, this.proyecto, this.lista)
    try {
      this.deps.escribirArchivo(serializarPersistido(this.persistido))
    } catch {
      /* persistir es de mejor esfuerzo */
    }
    // al cambiar de proyecto también hay que soltar lo aplicado del anterior (reaplicar compara con la lista nueva)
    this.reaplicar()
    this.deps.difundir(this.estado())
  }
}
