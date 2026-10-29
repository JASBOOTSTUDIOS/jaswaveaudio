/**
 * Pausa por falta de red (plan Q): cuando se pierde la conexión, la petición pendiente NO gasta reintentos ni se da
 * por fallida: la producción espera (sin límite, salvo que el usuario la detenga) y continúa sola al volver internet.
 */

export type OpcionesEsperaRed = {
  /** `navigator.onLine` (rápido, pero solo dice si hay interfaz de red). */
  enLinea: () => boolean
  /** Sondeo real del backend (p. ej. GET /health); true = responde. */
  sondear: () => Promise<boolean>
  /** Cada cuánto se sondea mientras falla (por defecto 10 s). */
  intervaloMs?: number
  /** Suscripción a «ya hay red» (evento `online`) para despertar sin esperar al sondeo; devuelve la baja. */
  alVolver?: (cb: () => void) => () => void
  signal?: AbortSignal
  /** Espera inyectable (pruebas). */
  dormir?: (ms: number) => Promise<void>
  alPausar?: () => void
  alReanudar?: (esperadoMs: number) => void
  reloj?: () => number
}

export const INTERVALO_SONDEO_RED_MS = 10_000

/**
 * Espera hasta que haya conexión real. Devuelve true si volvió, false si el usuario detuvo la producción.
 * Llama a `alPausar` una vez al empezar y a `alReanudar` al volver.
 */
export async function esperarConexion(o: OpcionesEsperaRed): Promise<boolean> {
  const reloj = o.reloj ?? Date.now
  const t0 = reloj()
  const intervalo = o.intervaloMs ?? INTERVALO_SONDEO_RED_MS
  o.alPausar?.()
  let despertar: (() => void) | null = null
  const baja = o.alVolver?.(() => despertar?.())
  const dormir =
    o.dormir ??
    ((ms: number) =>
      new Promise<void>((ok) => {
        const t = setTimeout(ok, ms)
        despertar = () => (clearTimeout(t), ok())
        o.signal?.addEventListener('abort', () => (clearTimeout(t), ok()), { once: true })
      }))
  try {
    while (!o.signal?.aborted) {
      let bien = false
      try {
        bien = o.enLinea() && (await o.sondear())
      } catch {
        bien = false
      }
      if (bien) {
        o.alReanudar?.(reloj() - t0)
        return true
      }
      await dormir(intervalo)
    }
    return false
  } finally {
    baja?.()
  }
}

/** Clave estable de una llamada de herramienta (nombre + id + argumentos) para no repetir lo ya entregado. */
export function claveLlamada(l: { id: string; nombre: string; argumentos: Record<string, unknown> }): string {
  return `${l.nombre}|${l.id}|${JSON.stringify(l.argumentos ?? {})}`
}
