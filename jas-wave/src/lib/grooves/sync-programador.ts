/** Programación pura de la sincronización de grooves (sin React ni sesión), para poder probarla. */

export const INTERVALO_SYNC_MS = 6 * 60 * 60 * 1000

/** Espera tras el n-ésimo fallo seguido: 30 s, 1 min, 2 min… hasta 30 min. */
export function esperaReintentoSync(fallosSeguidos: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, fallosSeguidos - 1), 30 * 60_000)
}

export type Temporizadores = { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void }

/**
 * Programador puro (testeable): ejecuta `tarea` ya, y luego cada `intervaloMs`; si la tarea falla, reintenta con
 * espera creciente. `pedir()` fuerza una ejecución (p. ej. al volver la conexión). Nunca ejecuta dos a la vez.
 */
export function crearProgramadorSync(o: {
  tarea: () => Promise<{ ok: boolean }>
  intervaloMs?: number
  temporizadores?: Temporizadores
  activo?: () => boolean
}) {
  const t = o.temporizadores ?? { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
  let fallos = 0
  let handle: unknown = null
  let corriendo = false
  let parado = false
  const planificar = (ms: number) => {
    if (parado) return
    if (handle) t.clear(handle)
    handle = t.set(() => void ejecutar(), ms)
  }
  const ejecutar = async (): Promise<void> => {
    if (parado || corriendo) return
    if (o.activo && !o.activo()) return planificar(o.intervaloMs ?? INTERVALO_SYNC_MS)
    corriendo = true
    try {
      const r = await o.tarea()
      fallos = r.ok ? 0 : fallos + 1
    } catch {
      fallos++
    } finally {
      corriendo = false
    }
    planificar(fallos > 0 ? esperaReintentoSync(fallos) : (o.intervaloMs ?? INTERVALO_SYNC_MS))
  }
  return {
    iniciar: () => void ejecutar(),
    pedir: () => void ejecutar(),
    parar: () => {
      parado = true
      if (handle) t.clear(handle)
    },
    fallosSeguidos: () => fallos,
  }
}
