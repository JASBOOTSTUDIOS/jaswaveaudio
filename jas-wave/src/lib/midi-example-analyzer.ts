/**
 * Búfer de escucha MIDI de la IA y análisis de lo que el usuario toca como ejemplo («tócalo así»).
 *
 * Los eventos llevan su instante en ns: con el reloj del host (QPC) en las entradas nativas, alineado con
 * `performance.now()`. Así el análisis ve el micro-timing real (flams, acordes arpegiados, adelantos),
 * no el jitter del transporte hasta la UI.
 */

export type EventoEscucha = {
  /** Instante del evento en ns (escala de `performance.now()` × 1e6). */
  tNs: number
  tipo: 'on' | 'off'
  pitch: number
  velocity: number
  canal: number
}

export type NotaEscuchada = { pitch: number; velocity: number; inicioMs: number; duracionMs: number }

const CAPACIDAD = 4096

/** Anillo de los últimos eventos tocados (todas las entradas). */
export class BufferEscuchaMidi {
  private eventos: EventoEscucha[] = []

  push(ev: EventoEscucha): void {
    this.eventos.push(ev)
    if (this.eventos.length > CAPACIDAD) this.eventos.splice(0, this.eventos.length - CAPACIDAD)
  }

  /** Eventos de los últimos `segundos` respecto a `ahoraNs` (o al último evento). */
  ultimos(segundos: number, ahoraNs?: number): EventoEscucha[] {
    if (this.eventos.length === 0) return []
    const fin = ahoraNs ?? this.eventos[this.eventos.length - 1]!.tNs
    const desde = fin - segundos * 1e9
    return this.eventos.filter((e) => e.tNs >= desde && e.tNs <= fin)
  }

  limpiar(): void {
    this.eventos = []
  }

  get tamano(): number {
    return this.eventos.length
  }
}

export const bufferEscuchaMidi = new BufferEscuchaMidi()

/** Empareja note-on/off (por pitch y canal). Las notas sin off duran hasta el último evento. */
export function notasDeEventos(eventos: readonly EventoEscucha[]): NotaEscuchada[] {
  const orden = [...eventos].sort((a, b) => a.tNs - b.tNs)
  const abiertas = new Map<string, EventoEscucha>()
  const notas: NotaEscuchada[] = []
  const cerrar = (on: EventoEscucha, finNs: number) =>
    notas.push({ pitch: on.pitch, velocity: on.velocity, inicioMs: on.tNs / 1e6, duracionMs: Math.max(0, (finNs - on.tNs) / 1e6) })
  for (const e of orden) {
    const k = `${e.canal}:${e.pitch}`
    const previa = abiertas.get(k)
    if (e.tipo === 'on' && e.velocity > 0) {
      if (previa) cerrar(previa, e.tNs)
      abiertas.set(k, e)
    } else if (previa) {
      cerrar(previa, e.tNs)
      abiertas.delete(k)
    }
  }
  const finNs = orden.length ? orden[orden.length - 1]!.tNs : 0
  for (const on of abiertas.values()) cerrar(on, finNs)
  return notas.sort((a, b) => a.inicioMs - b.inicioMs || a.pitch - b.pitch)
}

export type AnalisisEjemploMidi = {
  notas: number
  duracionSeg: number
  rango: { min: number; max: number } | null
  velocidad: { media: number; min: number; max: number; desviacion: number } | null
  /** Ataques: notas que empiezan juntas (< `ventanaAcordeMs`) cuentan como uno. */
  ataques: number
  acordes: number
  /** Golpes dobles casi simultáneos (flam): dos ataques separados 8–45 ms. */
  flams: number
  /** Acorde «arpegiado»: notas del mismo ataque separadas más de 5 ms (en ms, media). */
  dispersionAcordeMs: number
  ioiMedianaMs: number | null
  bpmEstimado: number | null
  /** Respecto a la rejilla del tempo (si se conoce): + = tarde, − = adelantado. */
  microtiming: { rejillaBeats: number; desvioMedioMs: number; desvioAbsMedioMs: number; desvioMaxMs: number } | null
  /** Proporción de notas que se solapan con la siguiente (legato) frente a las que dejan hueco. */
  legato: number
}

const mediana = (xs: number[]): number => {
  const o = [...xs].sort((a, b) => a - b)
  const m = o.length >> 1
  return o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2
}

/** Lleva un tempo candidato al rango musical habitual doblando o dividiendo. */
function plegarBpm(bpm: number): number {
  let b = bpm
  while (b < 70) b *= 2
  while (b > 180) b /= 2
  return Math.round(b * 10) / 10
}

export function analizarEjemploMidi(
  notas: readonly NotaEscuchada[],
  opts: { bpm?: number; rejillaBeats?: number; ventanaAcordeMs?: number } = {},
): AnalisisEjemploMidi {
  const ventana = opts.ventanaAcordeMs ?? 30
  const vacio: AnalisisEjemploMidi = {
    notas: 0,
    duracionSeg: 0,
    rango: null,
    velocidad: null,
    ataques: 0,
    acordes: 0,
    flams: 0,
    dispersionAcordeMs: 0,
    ioiMedianaMs: null,
    bpmEstimado: null,
    microtiming: null,
    legato: 0,
  }
  if (notas.length === 0) return vacio
  const ns = [...notas].sort((a, b) => a.inicioMs - b.inicioMs)
  const vels = ns.map((n) => n.velocity)
  const mediaVel = vels.reduce((a, b) => a + b, 0) / vels.length
  const desviacion = Math.sqrt(vels.reduce((a, v) => a + (v - mediaVel) ** 2, 0) / vels.length)

  // Agrupa en ataques (acordes / golpes simultáneos).
  const grupos: NotaEscuchada[][] = []
  for (const n of ns) {
    const g = grupos[grupos.length - 1]
    if (g && n.inicioMs - g[0]!.inicioMs < ventana) g.push(n)
    else grupos.push([n])
  }
  const inicios = grupos.map((g) => g[0]!.inicioMs)
  const iois = inicios.slice(1).map((t, i) => t - inicios[i]!)
  let flams = 0
  const dispersiones: number[] = []
  for (const g of grupos) {
    if (g.length < 2) continue
    const d = g[g.length - 1]!.inicioMs - g[0]!.inicioMs
    if (g.length === 2 && d >= 8 && d <= 45) flams += 1
    if (g.length >= 3) dispersiones.push(d)
  }
  // Un flam también son dos ataques muy cercanos que la ventana de acorde no juntó.
  for (const d of iois) if (d >= ventana && d <= 45) flams += 1

  const ioiMusical = iois.filter((d) => d > 45)
  const ioiMedianaMs = ioiMusical.length ? mediana(ioiMusical) : null
  const bpmEstimado = ioiMedianaMs ? plegarBpm(60000 / ioiMedianaMs) : null

  let microtiming: AnalisisEjemploMidi['microtiming'] = null
  const bpm = opts.bpm ?? bpmEstimado
  if (bpm && inicios.length >= 2) {
    const rejillaBeats = opts.rejillaBeats ?? 0.25
    const pasoMs = (60000 / bpm) * rejillaBeats
    const origen = inicios[0]!
    const desvios = inicios.map((t) => {
      const rel = t - origen
      return rel - Math.round(rel / pasoMs) * pasoMs
    })
    const abs = desvios.map(Math.abs)
    microtiming = {
      rejillaBeats,
      desvioMedioMs: round2(desvios.reduce((a, b) => a + b, 0) / desvios.length),
      desvioAbsMedioMs: round2(abs.reduce((a, b) => a + b, 0) / abs.length),
      desvioMaxMs: round2(Math.max(...abs)),
    }
  }

  let solapes = 0
  for (let i = 0; i < ns.length - 1; i++) {
    const a = ns[i]!
    const sig = ns.find((n, j) => j > i && n.inicioMs - a.inicioMs >= ventana)
    if (sig && a.inicioMs + a.duracionMs >= sig.inicioMs) solapes += 1
  }

  const pitches = ns.map((n) => n.pitch)
  const ultimo = ns.reduce((m, n) => Math.max(m, n.inicioMs + n.duracionMs), 0)
  return {
    notas: ns.length,
    duracionSeg: round2((ultimo - ns[0]!.inicioMs) / 1000),
    rango: { min: Math.min(...pitches), max: Math.max(...pitches) },
    velocidad: { media: round2(mediaVel), min: Math.min(...vels), max: Math.max(...vels), desviacion: round2(desviacion) },
    ataques: grupos.length,
    acordes: grupos.filter((g) => g.length >= 3).length,
    flams,
    dispersionAcordeMs: dispersiones.length ? round2(dispersiones.reduce((a, b) => a + b, 0) / dispersiones.length) : 0,
    ioiMedianaMs: ioiMedianaMs != null ? round2(ioiMedianaMs) : null,
    bpmEstimado,
    microtiming,
    legato: ns.length > 1 ? round2(solapes / (ns.length - 1)) : 0,
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}
