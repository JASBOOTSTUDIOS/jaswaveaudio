/**
 * Editor nativo de VST "embebido" en el panel del DAW (V4).
 *
 * El plugin-host abre el editor en una ventana popup sin borde y SIN padre/owner (un hijo u owned de
 * otro proceso deja a Electron y al host esperando SendMessage entre sí). Main la mantiene encima del
 * rectángulo del panel: la convierte de px CSS del renderer a píxeles físicos de pantalla y la
 * reposiciona cuando el panel cambia, la ventana se mueve/redimensiona, se minimiza o vuelve al frente.
 */

export type Rect = { x: number; y: number; width: number; height: number }

/** Rectángulo del panel en px CSS relativos al viewport, más su visibilidad. */
export type PanelEmbebido = { x: number; y: number; w: number; h: number; visible: boolean }

export function panelDesdeComando(cmd: Record<string, unknown>): PanelEmbebido | null {
  const e = cmd.embed
  if (!e || typeof e !== 'object') return null
  const r = e as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)
  const x = num(r.x), y = num(r.y), w = num(r.w), h = num(r.h)
  if ([x, y, w, h].some(Number.isNaN)) return null
  return { x, y, w: Math.max(0, w), h: Math.max(0, h), visible: r.visible !== false && w >= 1 && h >= 1 }
}

/**
 * Rectángulo de pantalla en DIP: origen del contenido de la ventana + panel (px CSS × zoom del renderer).
 * Redondea hacia fuera para no dejar una línea del DAW visible en el borde.
 */
export function rectPantallaDip(contenido: Rect, panel: PanelEmbebido, zoom: number): Rect {
  const z = zoom > 0 ? zoom : 1
  const x0 = contenido.x + panel.x * z, y0 = contenido.y + panel.y * z
  const x1 = contenido.x + (panel.x + panel.w) * z, y1 = contenido.y + (panel.y + panel.h) * z
  return { x: Math.floor(x0), y: Math.floor(y0), width: Math.ceil(x1) - Math.floor(x0), height: Math.ceil(y1) - Math.floor(y0) }
}

export type VentanaEditor = {
  id: number
  isDestroyed(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  getContentBounds(): Rect
  zoom(): number
  /** DIP → píxeles físicos (screen.dipToScreenRect en Windows). */
  aPantalla(r: Rect): Rect
}

type Entrada = { slotId: string; ventana: VentanaEditor; panel: PanelEmbebido }

/**
 * Seguimiento de los editores embebidos abiertos. `enviar` manda el comando al plugin-host.
 * Se usa desde los manejadores IPC y desde los eventos de la BrowserWindow (move, resize, minimize…).
 */
export class EditoresEmbebidos {
  private porSlot = new Map<string, Entrada>()
  private ultimo = new Map<string, { clave: string; t: number }>()
  private diferido = new Map<string, ReturnType<typeof setTimeout>>()
  /**
   * `minIntervaloMs` limita setEditorBounds por slot (mover/redimensionar la ventana dispara decenas de
   * eventos por segundo y cada uno es un RPC serializado + SetWindowPos en el hilo UI del host).
   * El último valor siempre se envía (trailing).
   */
  constructor(
    private readonly enviar: (cmd: Record<string, unknown>) => void,
    private readonly minIntervaloMs = 0,
  ) {}

  /** Comando openEditor con `embed`: devuelve el comando listo para el host (x/y/w/h físicos). */
  abrir(slotId: string, ventana: VentanaEditor, panel: PanelEmbebido, cmd: Record<string, unknown>): Record<string, unknown> {
    this.porSlot.set(slotId, { slotId, ventana, panel })
    const r = this.rectFisico(ventana, panel)
    const out: Record<string, unknown> = { ...cmd, embedded: true, x: r.x, y: r.y, w: r.width, h: r.height }
    delete out.embed
    delete out.parentHwnd
    return out
  }

  actualizar(slotId: string, panel: PanelEmbebido, raise = false): void {
    const e = this.porSlot.get(slotId)
    if (!e) return
    e.panel = panel
    this.sincronizar(e, raise)
  }

  cerrar(slotId: string): void {
    this.porSlot.delete(slotId)
    this.ultimo.delete(slotId)
    const t = this.diferido.get(slotId)
    if (t) clearTimeout(t)
    this.diferido.delete(slotId)
  }

  /** Eventos de la ventana: reposiciona (y sube encima del DAW si `raise`) sus editores. */
  ventanaCambio(ventanaId: number, raise = false): void {
    for (const e of this.porSlot.values()) if (e.ventana.id === ventanaId) this.sincronizar(e, raise)
  }

  ventanaCerrada(ventanaId: number): void {
    for (const [k, e] of this.porSlot) if (e.ventana.id === ventanaId) this.porSlot.delete(k)
  }

  abiertos(): string[] {
    return [...this.porSlot.keys()]
  }

  private rectFisico(v: VentanaEditor, panel: PanelEmbebido): Rect {
    return v.aPantalla(rectPantallaDip(v.getContentBounds(), panel, v.zoom()))
  }

  private sincronizar(e: Entrada, raise: boolean): void {
    if (e.ventana.isDestroyed()) {
      this.porSlot.delete(e.slotId)
      return
    }
    const visible = e.panel.visible && !e.ventana.isMinimized() && e.ventana.isVisible()
    const r = this.rectFisico(e.ventana, e.panel)
    const cmd = { type: 'setEditorBounds', slotId: e.slotId, embedded: true, visible, raise, x: r.x, y: r.y, w: r.width, h: r.height }
    if (this.minIntervaloMs <= 0) {
      this.enviar(cmd)
      return
    }
    const clave = JSON.stringify(cmd)
    const prev = this.ultimo.get(e.slotId)
    if (prev && prev.clave === clave && !raise) return
    const ahora = Date.now()
    const espera = prev ? this.minIntervaloMs - (ahora - prev.t) : 0
    const emitir = () => {
      this.diferido.delete(e.slotId)
      if (!this.porSlot.has(e.slotId)) return
      this.ultimo.set(e.slotId, { clave, t: Date.now() })
      this.enviar(cmd)
    }
    const pendiente = this.diferido.get(e.slotId)
    if (pendiente) clearTimeout(pendiente)
    if (espera <= 0) emitir()
    else this.diferido.set(e.slotId, setTimeout(emitir, espera))
  }
}
