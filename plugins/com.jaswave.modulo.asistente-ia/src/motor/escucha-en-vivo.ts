/**
 * Escucha en vivo de la banda: el usuario oye lo que la IA va produciendo.
 *  - Partes: cada clip que un músico crea o edita suena (su sección, hasta ~4 compases). Si llegan varios
 *    a la vez, suena el último; los agentes no esperan a la escucha.
 *  - Mezcla y máster: la canción suena en bucle desde el principio, así cada cambio se oye al momento.
 * Con «Escuchar a la IA» apagado la banda sigue sonando por dentro (el medidor del master lo muestra) pero
 * la salida a los altavoces se silencia (`jaswave-monitor-ia`): así se ve que hay señal y que no sale.
 * Se pausa durante las mediciones offline (el render bloquea el transporte) y respeta al usuario: si él
 * para el transporte, la escucha no lo vuelve a arrancar hasta el siguiente clip o etapa.
 */
import type { TiendaDAW } from '@jaswave/host-sdk'

/** Misma preferencia que el botón «Escuchar a la IA» del transporte (jas-wave/src/lib/preferencias-ia.ts). */
const CLAVE = 'jaswave.ia.escuchar'
const EVENTO_PREFERENCIAS = 'jaswave-ia-preferencias'
/** Monitorización de la app (jas-wave/src/lib/monitor-salida.ts): {silencio: true} = no sacar audio. */
const EVENTO_MONITOR_IA = 'jaswave-monitor-ia'
/** Compases máximos que suena un clip recién grabado. */
const COMPASES_CLIP = 4
const MS_MAX_CLIP = 12_000

type Modo = 'parado' | 'clip' | 'cancion'

function leerPreferencia(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== 'no'
  } catch {
    return true
  }
}

export class EscuchaEnVivo {
  private activa = leerPreferencia()
  private oyentes = new Set<() => void>()
  private tienda: TiendaDAW | null = null
  private modo: Modo = 'parado'
  private pendiente: { inicio: number; duracion: number } | null = null
  private sonandoClip = false
  private reloj: ReturnType<typeof setInterval> | null = null
  private inicioCancion = 0
  private pausas = 0
  private arrancadoPorMi = false
  private enProduccion = false

  constructor() {
    // El botón del transporte cambia la misma preferencia: se sigue al momento.
    if (typeof window !== 'undefined') {
      window.addEventListener(EVENTO_PREFERENCIAS, () => {
        const v = leerPreferencia()
        if (v !== this.activa) this.aplicar(v)
      })
    }
  }

  estaActiva(): boolean {
    return this.activa
  }

  suscribir(fn: () => void): () => void {
    this.oyentes.add(fn)
    return () => void this.oyentes.delete(fn)
  }

  fijarActiva(v: boolean): void {
    try {
      localStorage.setItem(CLAVE, v ? 'si' : 'no')
    } catch {
      /* sin almacenamiento: solo esta sesión */
    }
    this.aplicar(v)
    try {
      window.dispatchEvent(new Event(EVENTO_PREFERENCIAS))
    } catch {
      /* sin ventana (tests) */
    }
  }

  private aplicar(v: boolean): void {
    this.activa = v
    // La banda no se detiene: solo cambia si lo que suena sale o no por los altavoces.
    if (this.enProduccion) this.avisarMonitor(!v)
    for (const o of this.oyentes) o()
  }

  /** Pide a la app silenciar (o no) la salida mientras la IA trabaja; el medidor del master sigue vivo. */
  private avisarMonitor(silencio: boolean): void {
    try {
      window.dispatchEvent(new CustomEvent(EVENTO_MONITOR_IA, { detail: { silencio } }))
    } catch {
      /* sin ventana (tests) */
    }
  }

  /** Empieza una producción: guarda la tienda (la escucha arranca con el primer clip o la mezcla). */
  comenzar(tienda: TiendaDAW): void {
    this.tienda = tienda
    this.modo = 'parado'
    this.pendiente = null
    this.pausas = 0
    this.enProduccion = true
    this.avisarMonitor(!this.activa)
  }

  /** Un músico grabó o editó un clip: que suene (el último que llegue). */
  oirClip(inicioBeats: number, duracionBeats: number): void {
    if (!this.tienda || this.modo === 'cancion') return
    this.pendiente = { inicio: Math.max(0, inicioBeats), duracion: Math.max(1, duracionBeats) }
    void this.bucleClips()
  }

  /** Mezcla o máster: la canción entera en bucle. */
  sonarCancion(): void {
    if (!this.tienda || this.modo === 'cancion') return
    this.modo = 'cancion'
    this.pendiente = null
    if (this.pausas === 0) void this.arrancarCancion()
  }

  /** Mientras se mide offline (render) el transporte no puede sonar. */
  async pausar(): Promise<void> {
    this.pausas++
    if (this.pausas === 1) {
      this.limpiarReloj()
      await this.detenerTransporte()
    }
  }

  reanudar(): void {
    this.pausas = Math.max(0, this.pausas - 1)
    if (this.pausas === 0 && this.modo === 'cancion') void this.arrancarCancion()
  }

  /** Fin de la producción: se detiene lo que arrancó la IA y la salida vuelve a oírse. */
  async parar(): Promise<void> {
    this.modo = 'parado'
    this.pendiente = null
    this.limpiarReloj()
    await this.detenerTransporte()
    if (this.enProduccion) {
      this.enProduccion = false
      this.avisarMonitor(false)
    }
  }

  private bpm(): number {
    const v = Number(this.tienda?.obtenerEstado().project?.bpm?.valor ?? 120)
    return v > 0 ? v : 120
  }

  private finCancionBeats(): number {
    const pistas = this.tienda?.obtenerEstado().project?.tracks ?? []
    return Math.max(0, ...pistas.flatMap((t) => (t.clips ?? []).map((c) => c.inicio + c.duracion)))
  }

  private async ejecutar(tipo: string, payload: Record<string, unknown> = {}): Promise<boolean> {
    try {
      const r = await this.tienda!.executor.execute(tipo, payload)
      return r.success
    } catch {
      return false
    }
  }

  private reproduciendo(): boolean {
    return Boolean(this.tienda?.obtenerEstado().transport?.reproduciendo)
  }

  private async sonarDesde(beats: number): Promise<boolean> {
    if (!(await this.ejecutar('transport.seek', { segundos: (beats * 60) / this.bpm() }))) return false
    if (!this.reproduciendo()) {
      if (!(await this.ejecutar('transport.toggle'))) return false
      this.arrancadoPorMi = true
    }
    return true
  }

  private async detenerTransporte(): Promise<void> {
    if (this.arrancadoPorMi && this.reproduciendo()) await this.ejecutar('transport.stop')
    this.arrancadoPorMi = false
  }

  private async bucleClips(): Promise<void> {
    if (this.sonandoClip) return
    this.sonandoClip = true
    try {
      while (this.pendiente && this.modo !== 'cancion') {
        if (this.pausas > 0) {
          await esperar(500)
          continue
        }
        const { inicio, duracion } = this.pendiente
        this.pendiente = null
        this.modo = 'clip'
        if (!(await this.sonarDesde(inicio))) break
        const beats = Math.min(duracion, COMPASES_CLIP * 4)
        const ms = Math.min(MS_MAX_CLIP, ((beats * 60) / this.bpm()) * 1000)
        // Se corta antes si llega otro clip (suena el más reciente).
        const fin = Date.now() + ms
        while (Date.now() < fin && !this.pendiente && this.modo === 'clip') await esperar(200)
      }
      if (this.modo === 'clip') {
        this.modo = 'parado'
        await this.detenerTransporte()
      }
    } finally {
      this.sonandoClip = false
    }
  }

  private async arrancarCancion(): Promise<void> {
    this.limpiarReloj()
    const fin = this.finCancionBeats()
    if (fin <= 0 || !(await this.sonarDesde(0))) return
    this.inicioCancion = Date.now()
    this.reloj = setInterval(() => {
      if (this.modo !== 'cancion' || this.pausas > 0) return
      // El usuario paró el transporte: se respeta.
      if (!this.reproduciendo()) {
        this.limpiarReloj()
        this.arrancadoPorMi = false
        return
      }
      const durMs = ((this.finCancionBeats() * 60) / this.bpm()) * 1000
      if (Date.now() - this.inicioCancion >= durMs) {
        this.inicioCancion = Date.now()
        void this.ejecutar('transport.seek', { segundos: 0 })
      }
    }, 250)
  }

  private limpiarReloj(): void {
    if (this.reloj) clearInterval(this.reloj)
    this.reloj = null
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export const escuchaEnVivo = new EscuchaEnVivo()
