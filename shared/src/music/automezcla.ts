/**
 * Mezcla inicial determinista (plan T). Lógica PURA, sin modelo ni comandos: a partir de las pistas (y, si la hay, de
 * una medición por pista) calcula un plan completo y reproducible que la app aplica con los comandos reales:
 *
 *  1. Ganancia por rol (cimiento en batería/bajo, acompañamiento por debajo, lead por encima) normalizada para que la
 *     SUMA llegue a ≈ −18 dBFS RMS con pico estimado < −3 dBFS.
 *  2. Filtros pasa-altos por rol (no se toca bajo ni bombo), recorte suave de 200–400 Hz y realce de presencia.
 *  3. Paneo por rol y envío a un bus de reverb corta.
 *  4. Objetivo de balance espectral (graves < 45 %, medios+presencia > 25 %): se predice el espectro de la suma y,
 *     si no se cumple, se corrige primero con el nivel del cimiento y después con un EQ ancho en el máster (< ±3 dB).
 *  5. Dinámica por sección: curva de volumen por pista (coro ≈ +3 dB sobre el verso; el puente crece).
 *
 * Convenciones: las mediciones son POST-FADER (como `analysis.mix`), así que el nivel «a fader 0 dB» de una pista es
 * `rms − dB(volumen)` y el plan sale en volúmenes ABSOLUTOS: aplicarlo dos veces da lo mismo (idempotente).
 * Las bandas son las seis agregadas de `BANDAS_AGREGADAS` (sub, low, lowmid, mid, highmid, high).
 */

import { PERFIL_MEZCLA_DEFECTO, type PerfilMezcla, type RolMezcla, type TipoSeccion } from './perfiles-mezcla'

/** Centros geométricos de las seis bandas agregadas (sub 20–60, low 60–250, lowmid 250–500, mid 0,5–2k, highmid 2–6k, high 6–20k). */
export const CENTROS_BANDA_HZ = [35, 122, 354, 1000, 3464, 10954] as const
export const NOMBRES_BANDA = ['sub', 'low', 'lowmid', 'mid', 'highmid', 'high'] as const

export type ObjetivoEspectral = {
  /** Máximo de energía por debajo de 250 Hz (sub + low), 0–1. */
  gravesMax: number
  /** Mínimo de energía entre 250 Hz y 6 kHz (lowmid + mid + highmid), 0–1. */
  mediosMin: number
}
export const OBJETIVO_ESPECTRAL_DEFECTO: ObjetivoEspectral = PERFIL_MEZCLA_DEFECTO.objetivoEspectral

export const OBJETIVO_RMS_SUMA_DB = PERFIL_MEZCLA_DEFECTO.rmsSumaDb
export const PICO_MAX_SUMA_DB = -3
export const CRESTA_SUMA_DEFECTO_DB = PERFIL_MEZCLA_DEFECTO.crestaDb
/** El cimiento (bajo, bombo, batería) no baja más de esto respecto de su nivel nominal al corregir graves. */
export const MAX_RECORTE_CIMIENTO_DB = 4
/** Tope del EQ de banda ancha del máster. */
export const MAX_EQ_MASTER_DB = 3
const VOLUMEN_MAX_PLAN = 1.4
const VOLUMEN_MIN_PLAN = 0.02

// ── Roles ──────────────────────────────────────────────────────────────────────────────────────

const REGLAS_ROL: Array<[RolMezcla, RegExp]> = [
  ['bombo', /bombo|kick/i],
  ['bateria', /bater|drum|percus|caja|snare|hi-?hat|platillo|cymbal/i],
  ['bajo', /\bbajo\b|bass|sub\b/i],
  ['cuerdas', /cuerda|string|violin|viola|cello|chelo/i],
  ['pad', /\bpad\b|shimmer|ambient|atmos|colch|sintetizador de fondo/i],
  ['guitarra', /guitar|\bgtr\b|ukelele|acustica|electrica/i],
  ['piano', /piano|teclado|keys|rhodes|organo|órgano|organ/i],
  ['voz', /\bvoz\b|voces|vocal|coro\b|choir|cantante/i],
  ['lead', /lead|melod|solista|synth/i],
]

/** Rol de mezcla de una pista por su nombre y sus plugins (español e inglés). */
export function clasificarRolMezcla(nombre: string, plugins: readonly string[] = []): RolMezcla {
  for (const texto of [nombre, plugins.join(' ')]) {
    for (const [rol, re] of REGLAS_ROL) if (re.test(texto)) return rol
  }
  return 'otro'
}

type TablaRol<T> = Record<RolMezcla, T>

/** Nivel relativo de cada pista respecto de la suma (dB; solo importan las diferencias entre roles). */
export const NIVEL_RELATIVO_DB: TablaRol<number> = PERFIL_MEZCLA_DEFECTO.nivelDb
/** RMS típico (dBFS) del stem a fader 0 dB cuando no hay medición. */
export const RMS_STEM_DEFECTO_DB: TablaRol<number> = { bombo: -16, bateria: -16, bajo: -18, piano: -22, guitarra: -22, cuerdas: -24, pad: -24, lead: -20, voz: -20, otro: -22 }
/** Reparto de energía por banda (sub, low, lowmid, mid, highmid, high) cuando no hay medición espectral. */
export const ESPECTRO_DEFECTO: TablaRol<readonly number[]> = {
  bombo: [0.3, 0.5, 0.08, 0.06, 0.05, 0.01],
  bateria: [0.1, 0.35, 0.15, 0.2, 0.14, 0.06],
  bajo: [0.25, 0.6, 0.1, 0.04, 0.01, 0],
  piano: [0.03, 0.3, 0.25, 0.3, 0.1, 0.02],
  guitarra: [0.02, 0.25, 0.25, 0.3, 0.15, 0.03],
  cuerdas: [0.02, 0.3, 0.3, 0.25, 0.1, 0.03],
  pad: [0.05, 0.4, 0.25, 0.2, 0.08, 0.02],
  lead: [0, 0.1, 0.25, 0.4, 0.2, 0.05],
  voz: [0, 0.1, 0.25, 0.4, 0.2, 0.05],
  otro: [0.03, 0.3, 0.25, 0.28, 0.12, 0.02],
}
/** Pasa-altos (Hz) por rol; 0 = sin filtro (bajo y bombo no se tocan). */
export const HPF_HZ: TablaRol<number> = PERFIL_MEZCLA_DEFECTO.hpfHz
/** Recorte suave de 200–400 Hz (dB, negativo) por rol. */
export const RECORTE_MEDIOBAJO_DB: TablaRol<number> = PERFIL_MEZCLA_DEFECTO.recorteDb
/** Realce de presencia (2–5 kHz) en dB por rol (solo guitarra y piano). */
export const PRESENCIA_DB: TablaRol<number> = PERFIL_MEZCLA_DEFECTO.presenciaDb
/** Paneo por rol (−1 izquierda, 1 derecha); los de un mismo rol alternan lados. */
export const PANEO_ROL: TablaRol<number> = PERFIL_MEZCLA_DEFECTO.paneo
/** Envío a la reverb corta (0–1). */
export const ENVIO_REVERB: TablaRol<number> = PERFIL_MEZCLA_DEFECTO.envioReverb
/** Cuánto de la variación por sección sigue cada rol (el pulso rítmico se mueve menos). */
const OSCILACION_SECCION: TablaRol<number> = { bombo: 0.5, bateria: 0.5, bajo: 0.5, piano: 1, guitarra: 1, cuerdas: 1, pad: 1, lead: 1, voz: 1, otro: 1 }

// ── Filtros y predicción espectral ─────────────────────────────────────────────────────────────

export type TipoBandaPlan = 'lowCut' | 'bell' | 'lowShelf' | 'highShelf'
export type BandaEqPlan = { slot: number; tipo: TipoBandaPlan; freq: number; gain: number; q: number; pendiente?: number }

/** Respuesta (dB) de una banda de EQ a una frecuencia. Modelo suave: basta para predecir el reparto por bandas. */
export function respuestaBandaDb(b: BandaEqPlan, hz: number): number {
  const x = hz / b.freq
  switch (b.tipo) {
    case 'lowCut': {
      const e = 2 * ((b.pendiente ?? 12) / 6)
      const p = Math.pow(x, e)
      return 10 * Math.log10(Math.max(1e-12, p / (1 + p)))
    }
    case 'bell': {
      const o = Math.log2(x) * 1.5 * b.q
      return b.gain / (1 + o * o)
    }
    case 'lowShelf':
      return b.gain / (1 + Math.pow(x, 3))
    case 'highShelf': {
      const p = Math.pow(x, 3)
      return (b.gain * p) / (1 + p)
    }
  }
}

const aDb = (lineal: number) => 20 * Math.log10(Math.max(lineal, 1e-9))
const potDb = (p: number) => 10 * Math.log10(Math.max(p, 1e-12))
const desdeDb = (db: number) => Math.pow(10, db / 10)

const BORDES_BANDA_HZ: ReadonlyArray<readonly [number, number]> = [[20, 60], [60, 250], [250, 500], [500, 2000], [2000, 6000], [6000, 20000]]
const PUNTOS_POR_BANDA = 9

/** Respuesta media (potencia, dB) de un conjunto de bandas en una banda agregada, con energía uniforme por octava. */
function respuestaMediaDb(eq: readonly BandaEqPlan[], banda: number): number {
  const [lo, hi] = BORDES_BANDA_HZ[banda]!
  let acc = 0
  for (let k = 0; k < PUNTOS_POR_BANDA; k++) {
    const hz = lo * Math.pow(hi / lo, (k + 0.5) / PUNTOS_POR_BANDA)
    acc += desdeDb(eq.reduce((a, b) => a + respuestaBandaDb(b, hz), 0))
  }
  return potDb(acc / PUNTOS_POR_BANDA)
}

function aplicarEq(pot: readonly number[], eq: readonly BandaEqPlan[]): number[] {
  return pot.map((p, i) => (eq.length ? p * desdeDb(respuestaMediaDb(eq, i)) : p))
}

export type ReparteEspectral = { graves: number; medios: number; presencia: number; brillo: number; bandas: number[] }

/** Reparto (0–1) de la energía por bandas de un espectro en potencia lineal. */
export function repartoEspectral(pot: readonly number[]): ReparteEspectral {
  const total = pot.reduce((a, b) => a + b, 0) || 1
  const f = pot.map((p) => p / total)
  return { graves: f[0]! + f[1]!, medios: f[2]! + f[3]! + f[4]!, presencia: f[4]!, brillo: f[5]!, bandas: f }
}

export function cumpleObjetivoEspectral(r: Pick<ReparteEspectral, 'graves' | 'medios'>, o: ObjetivoEspectral = OBJETIVO_ESPECTRAL_DEFECTO): { graves: boolean; medios: boolean } {
  return { graves: r.graves < o.gravesMax, medios: r.medios > o.mediosMin }
}

/**
 * Convierte las bandas agregadas medidas (dB de potencia, orden sub…high) en reparto lineal. Acepta menos de 6 valores
 * (devuelve null) o valores no finitos (los trata como silencio).
 */
export function repartoDesdeBandasDb(bandasDb: readonly number[] | undefined): number[] | null {
  if (!bandasDb || bandasDb.length < 6) return null
  const p = bandasDb.slice(0, 6).map((d) => (Number.isFinite(d) ? desdeDb(d) : 0))
  const t = p.reduce((a, b) => a + b, 0)
  return t > 0 ? p.map((x) => x / t) : null
}

/**
 * Segundo paso: EQ de banda ancha del máster (menos de ±3 dB) para acercar un espectro medido o predicho al objetivo.
 * Devuelve las bandas (slots 1–4 del EQ del máster) y el motivo; vacío si ya cumple.
 */
export function corregirBalanceMaster(pot: readonly number[], objetivo: ObjetivoEspectral = OBJETIVO_ESPECTRAL_DEFECTO): { eq: BandaEqPlan[]; notas: string[] } {
  const eq: BandaEqPlan[] = []
  const notas: string[] = []
  const r0 = repartoEspectral(pot)
  if (r0.bandas[0]! > 0.12) {
    eq.push({ slot: 1, tipo: 'lowCut', freq: 28, gain: 0, q: 0.7, pendiente: 12 })
    notas.push(`Máster: pasa-altos a 28 Hz (${Math.round(r0.bandas[0]! * 100)} % de la energía bajo 60 Hz).`)
  }
  let actual = eq.length ? aplicarEq(pot, eq) : [...pot]
  const cap = (g: number) => Math.max(-MAX_EQ_MASTER_DB, Math.min(MAX_EQ_MASTER_DB, g))
  // Graves de más: estante bajo (−0,5 dB por cada punto de exceso, tope ±3).
  let rr = repartoEspectral(actual)
  if (rr.graves >= objetivo.gravesMax) {
    const g = cap(-(1 + (rr.graves - objetivo.gravesMax) * 12))
    eq.push({ slot: 2, tipo: 'lowShelf', freq: 220, gain: g, q: 0.7 })
    notas.push(`Máster: estante bajo ${g.toFixed(1)} dB a 220 Hz (graves ${Math.round(rr.graves * 100)} %, objetivo < ${Math.round(objetivo.gravesMax * 100)} %).`)
    actual = aplicarEq(pot, eq)
    rr = repartoEspectral(actual)
  }
  // Medios y presencia de menos: realce ancho y suave (el brillo no se toca si ya manda).
  if (rr.medios <= objetivo.mediosMin) {
    const g = cap(1 + (objetivo.mediosMin - rr.medios) * 10)
    eq.push({ slot: 3, tipo: 'bell', freq: 1800, gain: g, q: 0.6 })
    notas.push(`Máster: campana ancha +${g.toFixed(1)} dB a 1,8 kHz (medios ${Math.round(rr.medios * 100)} %, objetivo > ${Math.round(objetivo.mediosMin * 100)} %).`)
    if (rr.presencia < 0.1) {
      eq.push({ slot: 4, tipo: 'highShelf', freq: 4500, gain: cap(g * 0.7), q: 0.7 })
      notas.push(`Máster: estante alto +${cap(g * 0.7).toFixed(1)} dB a 4,5 kHz (presencia ${Math.round(rr.presencia * 100)} %).`)
    }
  }
  return { eq, notas }
}

// ── Secciones ──────────────────────────────────────────────────────────────────────────────────

export type SeccionMezcla = { nombre: string; compases: number }
export type PuntoVolumen = { tiempo: number; valor: number }

export function clasificarSeccion(nombre: string): TipoSeccion {
  const n = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/pre[\s-]?(coro|chorus)/.test(n)) return 'precoro'
  if (/coro|chorus|estribillo/.test(n)) return 'coro'
  if (/puente|bridge/.test(n)) return 'puente'
  if (/verso|verse|estrofa/.test(n)) return 'verso'
  if (/intro/.test(n)) return 'intro'
  if (/final|outro|cierre|tag|coda/.test(n)) return 'final'
  return 'otra'
}

/** Nivel (dB respecto del fader) por tipo de sección del perfil por defecto. */
export const PERFIL_SECCION_DB: Record<TipoSeccion, [number, number]> = PERFIL_MEZCLA_DEFECTO.seccion

/** Curva de volumen (segundos, valor lineal absoluto) de una pista siguiendo las secciones. Null si no hay secciones. */
export function curvaVolumenPorSeccion(
  volumen: number,
  secciones: readonly SeccionMezcla[],
  bpm: number,
  numerador: number,
  oscilacion = 1,
  tabla: Record<TipoSeccion, [number, number]> = PERFIL_SECCION_DB,
): PuntoVolumen[] | null {
  if (!secciones.length || !(bpm > 0)) return null
  const segCompas = ((numerador > 0 ? numerador : 4) * 60) / bpm
  const segBeat = 60 / bpm
  const val = (db: number) => Math.round(Math.min(1.5, Math.max(0, volumen * Math.pow(10, (db * oscilacion) / 20))) * 1000) / 1000
  const pts: PuntoVolumen[] = []
  let t = 0
  for (const s of secciones) {
    const dur = Math.max(1, s.compases) * segCompas
    const [ini, fin] = tabla[clasificarSeccion(s.nombre)]
    const r = (x: number) => Math.round(x * 1000) / 1000
    pts.push({ tiempo: r(t), valor: val(ini) })
    // Se mantiene el nivel y se llega al de la sección siguiente con una rampa de un tiempo al final.
    pts.push({ tiempo: r(t + dur - Math.min(segBeat, dur * 0.25)), valor: val(fin) })
    t += dur
  }
  return pts
}

export function maximoDbSeccion(secciones: readonly SeccionMezcla[], oscilacion = 1, tabla: Record<TipoSeccion, [number, number]> = PERFIL_SECCION_DB): number {
  if (!secciones.length) return 0
  return Math.max(...secciones.map((s) => Math.max(...tabla[clasificarSeccion(s.nombre)]) * oscilacion))
}

// ── Plan ───────────────────────────────────────────────────────────────────────────────────────

export type MedicionPistaMezcla = {
  /** RMS (dBFS) del stem POST-FADER. */
  rmsDb?: number
  picoDb?: number
  /** Potencia por banda agregada (dB; sub, low, lowmid, mid, highmid, high). */
  bandasDb?: number[]
}
export type PistaAutomezcla = {
  id: string
  nombre: string
  plugins?: string[]
  rol?: RolMezcla
  /** Fader actual (lineal). Con medición, es el que tenía al medir. */
  volumen: number
  paneo?: number
  medicion?: MedicionPistaMezcla | null
}
export type OpcionesAutomezcla = {
  /** Perfil de mezcla del estilo (por defecto el worship moderno). */
  perfil?: PerfilMezcla
  objetivoRmsDb?: number
  picoMaxDb?: number
  /** Cresta (pico − RMS) de la suma antes del máster, si se midió. */
  crestaSumaDb?: number
  objetivo?: Partial<ObjetivoEspectral>
  secciones?: readonly SeccionMezcla[]
  bpm?: number
  numerador?: number
  /** Crear el bus de reverb y los envíos (por defecto sí). */
  reverb?: boolean
  /** Potencia por banda agregada (dB) medida en la SUMA, para informar del «antes». */
  sumaBandasDb?: number[]
}
export type PlanPistaMezcla = {
  id: string
  nombre: string
  rol: RolMezcla
  origen: 'medido' | 'rol'
  volumen: number
  gananciaDb: number
  paneo: number
  eq: BandaEqPlan[]
  envioReverb: number
  curvaVolumen: PuntoVolumen[] | null
}
export type PlanMezcla = {
  /** Perfil de estilo con el que se calculó. */
  perfil: { id: string; nombre: string; master: { lufs: number; picoDbtp: number } }
  pistas: PlanPistaMezcla[]
  master: { eq: BandaEqPlan[] }
  sumaRmsDb: number
  picoSumaDb: number
  espectroDespues: ReparteEspectral
  espectroAntes: ReparteEspectral | null
  cumple: { graves: boolean; medios: boolean }
  /** Pistas sin medición (usaron valores por rol). */
  sinMedicion: string[]
  notas: string[]
}

type Base = { p: PistaAutomezcla; rol: RolMezcla; medida: boolean; base0Db: number; pot0: number[] }

function baseDePista(p: PistaAutomezcla, rol: RolMezcla): Base {
  const m = p.medicion
  const medidaRms = m && Number.isFinite(m.rmsDb) && (m.rmsDb as number) > -70
  const base0Db = medidaRms ? (m!.rmsDb as number) - aDb(Math.max(p.volumen, 0.001)) : RMS_STEM_DEFECTO_DB[rol]
  const reparto = (medidaRms ? repartoDesdeBandasDb(m!.bandasDb) : null) ?? [...ESPECTRO_DEFECTO[rol]]
  const total = desdeDb(base0Db)
  return { p, rol, medida: !!medidaRms, base0Db, pot0: reparto.map((x) => x * total) }
}

function eqDePista(pf: PerfilMezcla, rol: RolMezcla, sordo: boolean, factorRecorte: number): BandaEqPlan[] {
  const eq: BandaEqPlan[] = []
  if (pf.hpfHz[rol] > 0) eq.push({ slot: 1, tipo: 'lowCut', freq: pf.hpfHz[rol], gain: 0, q: 0.7, pendiente: 12 })
  if (pf.recorteDb[rol] < 0) eq.push({ slot: 2, tipo: 'bell', freq: 300, gain: Math.round(pf.recorteDb[rol] * factorRecorte * 10) / 10, q: 1 })
  if (pf.presenciaDb[rol] > 0 && sordo) eq.push({ slot: 3, tipo: 'bell', freq: 3500, gain: pf.presenciaDb[rol], q: 0.9 })
  return eq
}

const r2 = (x: number) => Math.round(x * 100) / 100

/**
 * Calcula el plan de mezcla inicial. Determinista: mismas pistas y mediciones, mismo plan.
 * Sin pistas con música devuelve un plan vacío.
 */
export function planificarAutomezcla(pistas: readonly PistaAutomezcla[], op: OpcionesAutomezcla = {}): PlanMezcla {
  const pf = op.perfil ?? PERFIL_MEZCLA_DEFECTO
  const objetivoRms = op.objetivoRmsDb ?? pf.rmsSumaDb
  const picoMax = op.picoMaxDb ?? PICO_MAX_SUMA_DB
  const objetivo: ObjetivoEspectral = { ...pf.objetivoEspectral, ...op.objetivo }
  const notas: string[] = []
  const bases = pistas.map((p) => baseDePista(p, p.rol ?? clasificarRolMezcla(p.nombre, p.plugins)))
  const sinMedicion = bases.filter((b) => !b.medida).map((b) => b.p.nombre)
  const vacio = (): PlanMezcla => ({ perfil: { id: pf.id, nombre: pf.nombre, master: pf.master }, pistas: [], master: { eq: [] }, sumaRmsDb: -120, picoSumaDb: -120, espectroDespues: repartoEspectral([1, 0, 0, 0, 0, 0]), espectroAntes: null, cumple: { graves: false, medios: false }, sinMedicion, notas: ['No hay pistas que mezclar.'] })
  if (!bases.length) return vacio()
  if (sinMedicion.length) notas.push(`Sin medición de ${sinMedicion.join(', ')}: se usaron niveles típicos por rol.`)

  // ¿La mezcla medida es sorda? (poca energía de presencia/brillo): decide el realce de presencia y el recorte.
  const potMedido = bases.every((b) => b.medida) ? bases.reduce((a, b) => a.map((x, i) => x + b.pot0[i]! * b.p.volumen ** 2), [0, 0, 0, 0, 0, 0]) : null
  const antes = op.sumaBandasDb ? (() => { const f = repartoDesdeBandasDb(op.sumaBandasDb); return f ? repartoEspectral(f) : null })() : potMedido ? repartoEspectral(potMedido) : null
  const sordo = antes ? antes.medios < objetivo.mediosMin : true
  const factorRecorte = antes && antes.graves > objetivo.gravesMax ? 1.5 : 1

  const eqs = bases.map((b) => eqDePista(pf, b.rol, sordo, factorRecorte))
  const esCimiento = (r: RolMezcla) => r === 'bajo' || r === 'bombo' || r === 'bateria'

  // Niveles: objetivo de RMS por pista = suma objetivo + nivel relativo normalizado. Se prueban recortes crecientes del
  // cimiento hasta cumplir el objetivo de graves (o llegar al tope).
  let recorteCimiento = 0
  let gains: number[] = []
  let potFinal: number[] = []
  const calcular = (recorte: number) => {
    const rel = bases.map((b) => pf.nivelDb[b.rol] - (esCimiento(b.rol) ? recorte : 0))
    const norm = potDb(rel.reduce((a, r) => a + desdeDb(r), 0))
    gains = bases.map((b, i) => objetivoRms + rel[i]! - norm - b.base0Db)
    potFinal = bases.reduce(
      (acc, b, i) => {
        const filtrada = aplicarEq(b.pot0, eqs[i]!)
        const g = desdeDb(gains[i]!)
        return acc.map((x, k) => x + filtrada[k]! * g)
      },
      [0, 0, 0, 0, 0, 0],
    )
  }
  calcular(0)
  while (repartoEspectral(potFinal).graves >= objetivo.gravesMax && recorteCimiento < MAX_RECORTE_CIMIENTO_DB) {
    recorteCimiento += 1
    calcular(recorteCimiento)
  }
  if (recorteCimiento > 0) notas.push(`Cimiento (bajo y batería) ${recorteCimiento} dB más bajo para repartir mejor los graves.`)

  // Segundo paso: EQ ancho del máster si aún no cumple (o hay mucho sub).
  const cumpleSin = cumpleObjetivoEspectral(repartoEspectral(potFinal), objetivo)
  let masterEq: BandaEqPlan[] = []
  if (!cumpleSin.graves || !cumpleSin.medios || repartoEspectral(potFinal).bandas[0]! > 0.12) {
    const c = corregirBalanceMaster(potFinal, objetivo)
    masterEq = c.eq
    notas.push(...c.notas)
    potFinal = aplicarEq(potFinal, masterEq)
  }

  // Recorte global para que la suma (con el máster ya ecualizado) quede en el objetivo y el pico estimado no pase del tope.
  const tablaOsc = bases.map((b) => OSCILACION_SECCION[b.rol])
  const maxSeccion = op.secciones?.length ? Math.max(...tablaOsc.map((o) => maximoDbSeccion(op.secciones!, o, pf.seccion))) : 0
  const cresta = Number.isFinite(op.crestaSumaDb) ? (op.crestaSumaDb as number) : pf.crestaDb
  let ajusteGlobal = objetivoRms - potDb(potFinal.reduce((a, b) => a + b, 0))
  // `ajusteGlobal` ya lleva la suma a objetivoRms; si el pico estimado pasa del tope se baja todo lo que falte.
  const picoConObjetivo = objetivoRms + cresta + Math.max(0, maxSeccion)
  if (picoConObjetivo > picoMax) {
    const exceso = picoConObjetivo - picoMax
    ajusteGlobal -= exceso
    notas.push(`Pico estimado de la suma ${r2(picoConObjetivo)} dBFS: se bajó todo ${r2(exceso)} dB para no pasar de ${picoMax} dBFS.`)
  }
  gains = gains.map((g) => g + ajusteGlobal)
  // Fader máximo: si algún stem muy bajo pide más de lo razonable, se baja todo lo mismo (el máster lo recupera después).
  const volumenes = gains.map((g) => Math.pow(10, g / 20))
  const maxVol = Math.max(...volumenes)
  if (maxVol > VOLUMEN_MAX_PLAN) {
    const baja = aDb(maxVol / VOLUMEN_MAX_PLAN)
    gains = gains.map((g) => g - baja)
    ajusteGlobal -= baja
    notas.push(`Un stem pedía un fader por encima de +${r2(aDb(VOLUMEN_MAX_PLAN))} dB: se bajó todo ${r2(baja)} dB.`)
  }

  // Paneo: los roles con lado alternan izquierda/derecha cuando hay más de una pista del mismo rol.
  const contador = new Map<RolMezcla, number>()
  const planPistas: PlanPistaMezcla[] = bases.map((b, i) => {
    const n = contador.get(b.rol) ?? 0
    contador.set(b.rol, n + 1)
    const base = Math.max(-1, Math.min(1, pf.paneo[b.rol] * pf.anchura))
    const paneo = base === 0 ? 0 : Math.round((n % 2 === 0 ? base : -base) * 100) / 100
    const vol = Math.min(VOLUMEN_MAX_PLAN, Math.max(VOLUMEN_MIN_PLAN, Math.pow(10, gains[i]! / 20)))
    const volumen = Math.round(vol * 1000) / 1000
    return {
      id: b.p.id,
      nombre: b.p.nombre,
      rol: b.rol,
      origen: b.medida ? 'medido' : 'rol',
      volumen,
      gananciaDb: r2(gains[i]!),
      paneo,
      eq: eqs[i]!,
      envioReverb: op.reverb === false ? 0 : pf.envioReverb[b.rol],
      curvaVolumen: op.secciones?.length && op.bpm ? curvaVolumenPorSeccion(volumen, op.secciones, op.bpm, op.numerador ?? 4, tablaOsc[i], pf.seccion) : null,
    }
  })

  const potPost = potFinal.map((p) => p * desdeDb(ajusteGlobal))
  const despues = repartoEspectral(potPost)
  const sumaRms = potDb(potPost.reduce((a, b) => a + b, 0))
  const picoSuma = sumaRms + cresta + Math.max(0, maxSeccion)
  const cumple = cumpleObjetivoEspectral(despues, objetivo)
  if (!cumple.graves) notas.push(`Aviso: tras la mezcla inicial los graves siguen en ${Math.round(despues.graves * 100)} % (objetivo < ${Math.round(objetivo.gravesMax * 100)} %); se revisará con la medición.`)
  if (!cumple.medios) notas.push(`Aviso: los medios y la presencia quedan en ${Math.round(despues.medios * 100)} % (objetivo > ${Math.round(objetivo.mediosMin * 100)} %); se revisará con la medición.`)
  return { perfil: { id: pf.id, nombre: pf.nombre, master: pf.master }, pistas: planPistas, master: { eq: masterEq }, sumaRmsDb: r2(sumaRms), picoSumaDb: r2(picoSuma), espectroDespues: despues, espectroAntes: antes, cumple, sinMedicion, notas }
}
