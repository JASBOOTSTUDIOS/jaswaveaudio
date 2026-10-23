/**
 * Watchdog de estabilidad de plugins (V5 §2.4).
 *
 * Complementa a `quarantine.ts` (que actúa cuando el host muere): aquí se vigilan plugins vivos a
 * partir de las estadísticas por slot del host (`getSlotStats`). Lógica pura y testeable:
 *   - saturación: carga media del slot por encima del umbral durante N muestras seguidas
 *     (el plugin no termina su bloque a tiempo y provoca cortes);
 *   - excepciones recurrentes: M excepciones capturadas en una ventana de tiempo.
 */

export type MuestraSlot = {
  path: string
  /** Carga media del intervalo (tiempo de proceso / duración del bloque). */
  avgLoad: number
  /** Bloques del intervalo que se pasaron de tiempo. */
  overruns: number
  /** Contador acumulado de excepciones capturadas en process(). */
  exceptions: number
}

export type MotivoWatchdog = 'saturacion' | 'excepciones'

export type DecisionWatchdog = { plugin: string; motivo: MotivoWatchdog; detalle: string }

export type UmbralesWatchdog = {
  cargaMaxima: number
  muestrasSeguidas: number
  excepcionesMax: number
  ventanaExcepcionesMs: number
}

export const UMBRALES_POR_DEFECTO: UmbralesWatchdog = {
  cargaMaxima: 0.9,
  muestrasSeguidas: 5,
  excepcionesMax: 3,
  ventanaExcepcionesMs: 60_000,
}

type EstadoSlot = { saturadasSeguidas: number; excepcionesPrevias: number; marcasExcepcion: number[] }

export class Watchdog {
  private readonly estado = new Map<string, EstadoSlot>()
  private readonly apartados = new Set<string>()

  constructor(
    private readonly umbrales: UmbralesWatchdog = UMBRALES_POR_DEFECTO,
    /** true si el contador de excepciones empieza en 0 (quien llama acumula); false = ignorar lo previo. */
    private readonly contadoresDesdeCero = false,
  ) {}

  /** Procesa una tanda de muestras; devuelve los plugins que deben ir a cuarentena (una vez cada uno). */
  evaluar(muestras: MuestraSlot[], ahora: number): DecisionWatchdog[] {
    const decisiones: DecisionWatchdog[] = []
    const vistos = new Set<string>()
    for (const m of muestras) {
      if (!m.path || this.apartados.has(m.path)) continue
      vistos.add(m.path)
      const e = this.estado.get(m.path) ?? {
        saturadasSeguidas: 0,
        excepcionesPrevias: this.contadoresDesdeCero ? 0 : m.exceptions,
        marcasExcepcion: [],
      }

      const saturada = m.avgLoad > this.umbrales.cargaMaxima || m.overruns > 0
      e.saturadasSeguidas = saturada ? e.saturadasSeguidas + 1 : 0

      const nuevas = Math.max(0, m.exceptions - e.excepcionesPrevias)
      e.excepcionesPrevias = m.exceptions
      for (let i = 0; i < nuevas; i++) e.marcasExcepcion.push(ahora)
      e.marcasExcepcion = e.marcasExcepcion.filter((t) => ahora - t <= this.umbrales.ventanaExcepcionesMs)
      this.estado.set(m.path, e)

      if (e.marcasExcepcion.length >= this.umbrales.excepcionesMax) {
        decisiones.push({ plugin: m.path, motivo: 'excepciones', detalle: `${e.marcasExcepcion.length} excepciones en ${this.umbrales.ventanaExcepcionesMs / 1000} s` })
      } else if (e.saturadasSeguidas >= this.umbrales.muestrasSeguidas) {
        decisiones.push({ plugin: m.path, motivo: 'saturacion', detalle: `carga ${m.avgLoad.toFixed(2)} durante ${e.saturadasSeguidas} muestras` })
      }
    }
    for (const d of decisiones) {
      this.apartados.add(d.plugin)
      this.estado.delete(d.plugin)
    }
    // Slots descargados: se olvida su historial.
    for (const p of [...this.estado.keys()]) if (!vistos.has(p)) this.estado.delete(p)
    return decisiones
  }

  /** Tras "limpiar cuarentena" el plugin vuelve a vigilarse desde cero. */
  rehabilitar(plugin?: string): void {
    if (plugin) this.apartados.delete(plugin)
    else this.apartados.clear()
  }
}

export function mensajeWatchdog(d: DecisionWatchdog): string {
  const nombre = d.plugin.split(/[\\/]/).pop() ?? d.plugin
  return d.motivo === 'saturacion'
    ? `${nombre} se apartó (cuarentena): satura el procesamiento de audio (${d.detalle}). El audio sigue sin él.`
    : `${nombre} se apartó (cuarentena): falló repetidamente (${d.detalle}). El audio sigue sin él.`
}
