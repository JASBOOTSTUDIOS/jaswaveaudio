import type { EtapaMedible, EtapaProduccion } from './produccion'

/**
 * Tiempos de la producción (plan P): cuánto tarda cada etapa y cuántas peticiones al modelo hace, qué mediciones
 * del host se hicieron y qué refinamientos se omitieron por falta de tiempo. Todo con un reloj inyectable para
 * poder probarlo sin esperar.
 */

/** Tiempo de reloj objetivo de una canción completa en el caso normal. */
export const PRESUPUESTO_MS_DEFECTO = 15 * 60_000
/** Tope duro: pasado este tiempo se entrega lo que hay (la grabación de los músicos y la medición final no se saltan). */
export const LIMITE_MS_DEFECTO = 30 * 60_000

export type TiempoEtapa = { ms: number; peticiones: number }
export type TiempoMedicion = { etapa: EtapaMedible; ms: number; ok: boolean | null }
export type MotivoOmision = 'presupuesto' | 'limite' | 'sin_progreso' | 'tope_agente'
export type Omision = { que: string; motivo: MotivoOmision; texto: string }

export type TiemposProduccion = {
  totalMs: number
  presupuestoMs: number
  limiteMs: number
  /** Etapas del flujo (el tiempo de una etapa anidada en otra, p. ej. la coherencia dentro de la revisión, se descuenta de la de fuera). */
  etapas: Partial<Record<EtapaProduccion, TiempoEtapa>>
  peticiones: number
  mediciones: TiempoMedicion[]
  omitidos: Omision[]
}

const ORDEN: EtapaProduccion[] = ['plan', 'direccion', 'musicos', 'ensayo', 'coherencia', 'qa_musicos', 'mezcla', 'qa_mezcla', 'master', 'qa_master', 'entrega']
const CORTO: Record<EtapaProduccion, string> = {
  plan: 'plan',
  direccion: 'dirección',
  musicos: 'músicos',
  ensayo: 'ensayo',
  coherencia: 'arreglista',
  qa_musicos: 'revisión de partes',
  mezcla: 'mezcla',
  qa_mezcla: 'revisión de mezcla',
  master: 'máster',
  qa_master: 'revisión de máster',
  entrega: 'entrega',
}

export function formatearDuracion(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r && m < 10 ? `${m} min ${r} s` : `${m} min`
}

/** «Tiempos: plan 40 s (2 pet.) · músicos 6 min (78 pet.) · … · total 14 min.» */
export function resumenTiempos(t: TiemposProduccion): string {
  const partes = ORDEN.filter((e) => (t.etapas[e]?.ms ?? 0) >= 1000 || (t.etapas[e]?.peticiones ?? 0) > 0).map((e) => {
    const x = t.etapas[e]!
    return `${CORTO[e]} ${formatearDuracion(x.ms)}${x.peticiones ? ` (${x.peticiones} pet.)` : ''}`
  })
  const med = t.mediciones.length ? `mediciones ${t.mediciones.length} (${formatearDuracion(t.mediciones.reduce((s, m) => s + m.ms, 0))})` : ''
  return `Tiempos: ${[...partes, med].filter(Boolean).join(' · ')} · total ${formatearDuracion(t.totalMs)} (${t.peticiones} peticiones).`
}

type Marco = { etapa: EtapaProduccion; t0: number; hijos: number; peticiones: number }

/**
 * Cronómetro por etapas. La producción es secuencial entre etapas (el paralelismo ocurre dentro de una), así que
 * una pila basta: las peticiones se cuentan en la etapa en curso y el tiempo de una etapa anidada se resta de la
 * que la contiene (no se cuenta dos veces).
 */
export function crearCronometro(reloj: () => number, alTerminar?: (e: { etapa: EtapaProduccion; ms: number; peticiones: number; totalMs: number }) => void) {
  const t0 = reloj()
  const pila: Marco[] = []
  const etapas: Partial<Record<EtapaProduccion, TiempoEtapa>> = {}
  const mediciones: TiempoMedicion[] = []
  const omitidos: Omision[] = []
  let peticiones = 0
  const acum = (e: EtapaProduccion) => (etapas[e] ??= { ms: 0, peticiones: 0 })

  return {
    transcurrido: () => reloj() - t0,
    /** Ejecuta `fn` contando su tiempo y sus peticiones en `etapa`. */
    async medir<T>(etapa: EtapaProduccion, fn: () => Promise<T>): Promise<T> {
      const marco: Marco = { etapa, t0: reloj(), hijos: 0, peticiones: 0 }
      pila.push(marco)
      try {
        return await fn()
      } finally {
        pila.pop()
        const total = reloj() - marco.t0
        const propio = Math.max(0, total - marco.hijos)
        const a = acum(etapa)
        a.ms += propio
        a.peticiones += marco.peticiones
        const padre = pila[pila.length - 1]
        if (padre) padre.hijos += total
        alTerminar?.({ etapa, ms: propio, peticiones: marco.peticiones, totalMs: reloj() - t0 })
      }
    },
    /** Una petición al modelo, en la etapa en curso. */
    peticion() {
      peticiones++
      const m = pila[pila.length - 1]
      if (m) m.peticiones++
      else acum('entrega').peticiones++
    },
    medicion(m: TiempoMedicion) {
      mediciones.push(m)
    },
    omitir(o: Omision): boolean {
      if (omitidos.some((x) => x.que === o.que && x.motivo === o.motivo)) return false
      omitidos.push(o)
      return true
    },
    omitidos: () => omitidos,
    instantanea(presupuestoMs: number, limiteMs: number): TiemposProduccion {
      return {
        totalMs: reloj() - t0,
        presupuestoMs,
        limiteMs,
        etapas: Object.fromEntries(Object.entries(etapas).map(([k, v]) => [k, { ...v! }])) as TiemposProduccion['etapas'],
        peticiones,
        mediciones: [...mediciones],
        omitidos: [...omitidos],
      }
    },
  }
}

export type Cronometro = ReturnType<typeof crearCronometro>
