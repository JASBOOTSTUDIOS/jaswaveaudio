/**
 * Búfer de escucha MIDI de la IA y análisis de lo que el usuario toca como ejemplo («tócalo así»).
 *
 * Los eventos llevan su instante en ns: con el reloj del host (QPC) en las entradas nativas, alineado con
 * `performance.now()`. Así el análisis ve el micro-timing real (flams, acordes arpegiados, adelantos),
 * no el jitter del transporte hasta la UI.
 */

type BaseEvento = {
  /** Instante del evento en ns (escala de `performance.now()` × 1e6). */
  tNs: number
  canal: number
  /** Entrada MIDI de la que llegó (id del dispositivo). */
  deviceId?: string
}

export type EventoNotaEscucha = BaseEvento & { tipo: 'on' | 'off'; pitch: number; velocity: number }
/** Controlador continuo: sustain (64), sostenuto (66), suave (67), modulación (1), expresión (11)… */
export type EventoControlEscucha = BaseEvento & { tipo: 'cc'; cc: number; valor: number }
/** Pitch bend normalizado −1..1. */
export type EventoBendEscucha = BaseEvento & { tipo: 'bend'; valor: number }
export type EventoEscucha = EventoNotaEscucha | EventoControlEscucha | EventoBendEscucha

/** Controladores que la escucha guarda (los demás no describen el toque). */
export const CC_ESCUCHADOS: readonly number[] = [64, 66, 67, 1, 11]

export type NotaEscuchada = { pitch: number; velocity: number; inicioMs: number; duracionMs: number }

/** Transporte al empezar una toma (si estaba en marcha, las notas se alinean a él). */
export type TransporteToma = { reproduciendo: boolean; posicionBeats: number; bpm: number }

export type Toma = {
  id: string
  inicioNs: number
  /** Sin valor: toma en curso. */
  finNs?: number
  transporte?: TransporteToma
  eventos: EventoEscucha[]
}

const CAPACIDAD = 4096
const CAPACIDAD_TOMA = 60_000

const ahoraNsPorDefecto = (): number | undefined => (typeof performance !== 'undefined' ? performance.now() * 1e6 : undefined)

/** Anillo de los últimos eventos tocados (todas las entradas) y sesiones de toma. */
export class BufferEscuchaMidi {
  private eventos: EventoEscucha[] = []
  private toma: Toma | null = null
  private contadorTomas = 0

  push(ev: EventoEscucha): void {
    this.eventos.push(ev)
    if (this.eventos.length > CAPACIDAD) this.eventos.splice(0, this.eventos.length - CAPACIDAD)
    const t = this.toma
    if (t && t.finNs === undefined && ev.tNs >= t.inicioNs && t.eventos.length < CAPACIDAD_TOMA) t.eventos.push(ev)
  }

  /** Eventos de los últimos `segundos` respecto a `ahoraNs` (o al último evento). */
  ultimos(segundos: number, ahoraNs?: number): EventoEscucha[] {
    if (this.eventos.length === 0) return []
    const fin = ahoraNs ?? this.eventos[this.eventos.length - 1]!.tNs
    const desde = fin - segundos * 1e9
    return this.eventos.filter((e) => e.tNs >= desde && e.tNs <= fin)
  }

  /**
   * Empieza una toma: desde ahora todo lo que llegue se guarda aparte (sin el tope del anillo). Si ya había
   * una en curso, se cierra. Con el transporte en marcha, guarda su posición y BPM para alinear la métrica.
   */
  iniciarToma(o: { transporte?: TransporteToma; ahoraNs?: number } = {}): Toma {
    if (this.toma && this.toma.finNs === undefined) this.terminarToma(o.ahoraNs)
    const inicioNs = o.ahoraNs ?? ahoraNsPorDefecto() ?? (this.eventos.length ? this.eventos[this.eventos.length - 1]!.tNs : 0)
    this.contadorTomas += 1
    this.toma = {
      id: `toma-${this.contadorTomas}`,
      inicioNs,
      ...(o.transporte ? { transporte: { ...o.transporte } } : {}),
      eventos: [],
    }
    return this.toma
  }

  /** Cierra la toma en curso (null si no había). */
  terminarToma(ahoraNs?: number): Toma | null {
    const t = this.toma
    if (!t || t.finNs !== undefined) return null
    const ultimo = t.eventos.length ? t.eventos[t.eventos.length - 1]!.tNs : t.inicioNs
    t.finNs = Math.max(ahoraNs ?? ahoraNsPorDefecto() ?? ultimo, ultimo, t.inicioNs)
    return t
  }

  /** La toma en curso o la última terminada (null si nunca se grabó). */
  tomaActual(): Toma | null {
    return this.toma
  }

  get tomaEnCurso(): boolean {
    return this.toma !== null && this.toma.finNs === undefined
  }

  limpiar(): void {
    this.eventos = []
    this.toma = null
  }

  get tamano(): number {
    return this.eventos.length
  }
}

export const bufferEscuchaMidi = new BufferEscuchaMidi()

export function esEventoNota(e: EventoEscucha): e is EventoNotaEscucha {
  return e.tipo === 'on' || e.tipo === 'off'
}

/** Curva de un controlador (p. ej. 64 = sustain) dentro de unos eventos, en orden temporal. */
export function controlDeEventos(eventos: readonly EventoEscucha[], cc: number): Array<{ tMs: number; valor: number }> {
  return eventos
    .filter((e): e is EventoControlEscucha => e.tipo === 'cc' && e.cc === cc)
    .sort((a, b) => a.tNs - b.tNs)
    .map((e) => ({ tMs: e.tNs / 1e6, valor: e.valor }))
}

/** Resumen de una toma para la UI: duración, notas (note-on), eventos de pedal y controladores. */
export function resumenToma(t: Toma | null, ahoraNs?: number): { enCurso: boolean; segundos: number; notas: number; pedal: number; controles: number } {
  if (!t) return { enCurso: false, segundos: 0, notas: 0, pedal: 0, controles: 0 }
  const fin = t.finNs ?? ahoraNs ?? ahoraNsPorDefecto() ?? t.inicioNs
  let notas = 0
  let pedal = 0
  let controles = 0
  for (const e of t.eventos) {
    if (e.tipo === 'on' && e.velocity > 0) notas++
    else if (e.tipo === 'cc') {
      if (e.cc === 64) pedal++
      else controles++
    } else if (e.tipo === 'bend') controles++
  }
  return { enCurso: t.finNs === undefined, segundos: Math.max(0, (fin - t.inicioNs) / 1e9), notas, pedal, controles }
}

/** Empareja note-on/off (por pitch y canal). Las notas sin off duran hasta el último evento. */
export function notasDeEventos(eventos: readonly EventoEscucha[]): NotaEscuchada[] {
  const orden = [...eventos].filter(esEventoNota).sort((a, b) => a.tNs - b.tNs)
  const abiertas = new Map<string, EventoNotaEscucha>()
  const notas: NotaEscuchada[] = []
  const cerrar = (on: EventoNotaEscucha, finNs: number) =>
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
  const finNs = eventos.reduce((m, e) => Math.max(m, e.tNs), orden.length ? orden[orden.length - 1]!.tNs : 0)
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
