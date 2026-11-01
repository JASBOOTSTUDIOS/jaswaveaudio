/**
 * Vigilancia de plugins vivos (V5 §2.4): sondea `getSlotStats` del plugin host, pasa las muestras al
 * watchdog y, si un plugin satura el audio o falla de forma recurrente, pone todas sus instancias en
 * bypass (el audio sigue) y lo deja en cuarentena para próximas cargas.
 */

import { Watchdog, mensajeWatchdog, type DecisionWatchdog, type UmbralesWatchdog } from './watchdog'

export type EstadisticaSlot = {
  slot: string
  path: string
  avgLoad: number
  overruns: number
  /** Excepciones desde el último reset (se piden con reset: true). */
  exceptions: number
}

export type DependenciasVigilancia = {
  /** Envía un comando al host y devuelve su respuesta. */
  enviar: (cmd: Record<string, unknown>) => Promise<{ ok?: boolean; slots?: unknown }>
  /** El host nativo está en marcha (si no, no se sondea). */
  activo: () => boolean
  /** Persiste la cuarentena de la ruta del plugin. */
  apartar: (ruta: string) => void
  /** Avisa al usuario/renderer. */
  notificar: (decision: DecisionWatchdog, mensaje: string) => void
  intervaloMs?: number
  umbrales?: UmbralesWatchdog
  ahora?: () => number
}

function slotsValidos(v: unknown): EstadisticaSlot[] {
  if (!Array.isArray(v)) return []
  return v.filter(
    (s): s is EstadisticaSlot =>
      !!s &&
      typeof (s as EstadisticaSlot).slot === 'string' &&
      typeof (s as EstadisticaSlot).path === 'string' &&
      Number.isFinite((s as EstadisticaSlot).avgLoad) &&
      Number.isFinite((s as EstadisticaSlot).overruns) &&
      Number.isFinite((s as EstadisticaSlot).exceptions),
  )
}

export function crearVigilancia(d: DependenciasVigilancia) {
  // Se piden estadísticas con reset y aquí se acumulan: el contador empieza en 0.
  const watchdog = new Watchdog(d.umbrales, true)
  const excepcionesAcumuladas = new Map<string, number>()
  const ahora = d.ahora ?? Date.now
  let ocupado = false

  /** Una vuelta de sondeo (expuesta para pruebas). */
  async function sondear(): Promise<DecisionWatchdog[]> {
    if (ocupado || !d.activo()) return []
    ocupado = true
    try {
      const r = await d.enviar({ type: 'getSlotStats', reset: true }).catch(() => null)
      if (!r?.ok) return []
      const slots = slotsValidos(r.slots)
      // Varias instancias del mismo plugin: se vigila el plugin (ruta) con la peor carga.
      const porRuta = new Map<string, { avgLoad: number; overruns: number; exceptions: number }>()
      for (const s of slots) {
        const previo = porRuta.get(s.path) ?? { avgLoad: 0, overruns: 0, exceptions: 0 }
        porRuta.set(s.path, {
          avgLoad: Math.max(previo.avgLoad, s.avgLoad),
          overruns: previo.overruns + s.overruns,
          exceptions: previo.exceptions + s.exceptions,
        })
      }
      const muestras = [...porRuta].map(([path, m]) => {
        const acumuladas = (excepcionesAcumuladas.get(path) ?? 0) + m.exceptions
        excepcionesAcumuladas.set(path, acumuladas)
        return { path, avgLoad: m.avgLoad, overruns: m.overruns, exceptions: acumuladas }
      })
      const decisiones = watchdog.evaluar(muestras, ahora())
      for (const decision of decisiones) {
        // El exceso de CPU solo se avisa; únicamente los fallos reales apartan y puentean el plugin.
        if (decision.accion === 'apartar') {
          for (const s of slots.filter((x) => x.path === decision.plugin)) {
            await d.enviar({ type: 'setBypass', slotId: s.slot, bypass: true }).catch(() => undefined)
          }
          d.apartar(decision.plugin)
        }
        d.notificar(decision, mensajeWatchdog(decision))
      }
      return decisiones
    } finally {
      ocupado = false
    }
  }

  const temporizador = setInterval(() => void sondear(), d.intervaloMs ?? 1000)
  temporizador.unref?.()

  return {
    sondear,
    detener: () => clearInterval(temporizador),
    /** Tras "limpiar cuarentena": vuelve a vigilar desde cero. */
    rehabilitar: (ruta?: string) => {
      watchdog.rehabilitar(ruta)
      if (ruta) excepcionesAcumuladas.delete(ruta)
      else excepcionesAcumuladas.clear()
    },
  }
}
