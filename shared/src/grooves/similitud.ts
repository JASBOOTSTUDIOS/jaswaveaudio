/**
 * Huella y similitud de grooves por CONTENIDO MIDI (no por nombre ni por bytes del archivo). Lógica pura, sin
 * imports: la usan el cliente y el backend (el backend tiene una copia idéntica, comprobada por un test).
 *
 * Un groove se normaliza a una matriz rítmica independiente del tempo y del formato:
 *  - 7 familias de pieza (bombo, caja, hi-hat, ride, platos, toms, percusión) según el mapa GM;
 *  - cuadrícula por compás: semicorcheas (4 pasos por negra) o, en compases compuestos (6/8, 9/8, 12/8),
 *    tresillos de semicorchea (6 pasos por negra);
 *  - velocidad cuantizada en 3 niveles (1 suave/ghost, 2 media, 3 acento).
 * La huella exacta es un hash de la matriz BINARIA (sin velocidades) reducida a su periodo mínimo, así que un
 * mismo groove con otro tempo, otras velocidades o repetido varias veces da la misma huella.
 * La puntuación 0–100 combina coincidencia de golpes por pieza (Jaccard ponderado: bombo y caja pesan más), perfil
 * de velocidades, densidad y longitud, probando alineaciones de compás y desplazamientos de 0–2 tiempos.
 */

export type NotaHuella = { pitch: number; velocidad: number; inicio: number }
export type CompasHuella = { numerador: number; denominador: number }

export const FAMILIAS = ['bombo', 'caja', 'hihat', 'ride', 'platos', 'toms', 'percusion'] as const
export type Familia = (typeof FAMILIAS)[number]
const NF = FAMILIAS.length
const PESOS = [3, 3, 1.5, 1.5, 1, 1, 0.75]

export const UMBRALES_SIMILITUD = { duplicado: 98, muySimilar: 85, similar: 70 }
export type NivelSimilitud = 'duplicado' | 'muy-similar' | 'similar' | 'distinto'

export function nivelDeSimilitud(puntuacion: number, u = UMBRALES_SIMILITUD): NivelSimilitud {
  if (puntuacion >= u.duplicado) return 'duplicado'
  if (puntuacion >= u.muySimilar) return 'muy-similar'
  if (puntuacion >= u.similar) return 'similar'
  return 'distinto'
}

const FAMILIA_POR_PITCH = new Map<number, number>()
for (const [fam, pitches] of [
  [0, [35, 36]],
  [1, [37, 38, 39, 40]],
  [2, [42, 44, 46]],
  [3, [51, 53, 59]],
  [4, [49, 52, 55, 57]],
  [5, [41, 43, 45, 47, 48, 50]],
] as Array<[number, number[]]>)
  for (const p of pitches) FAMILIA_POR_PITCH.set(p, fam)

/** Índice de familia (0..6) de un pitch GM; todo lo demás es percusión. */
export const familiaDePitch = (pitch: number): number => FAMILIA_POR_PITCH.get(pitch) ?? 6

export const nivelDeVelocidad = (v: number): 1 | 2 | 3 => (v < 50 ? 1 : v < 90 ? 2 : 3)

export type Huella = {
  /** Hash de la matriz binaria normalizada: igual huella = mismo patrón rítmico. */
  hash: string
  compas: string
  /** Pasos por negra de la cuadrícula (4 = semicorcheas, 6 = tresillos en compases compuestos). */
  pasosPorNegra: number
  /** Pasos por compás. */
  pasos: number
  /** Compases del groove tal como está. */
  compases: number
  /** Compases del patrón mínimo que se repite (≤ compases). */
  periodo: number
  /** Golpes por compás (media). */
  densidad: number
  /** Niveles 0..3 por [compás][familia][paso] del periodo, aplanado. */
  celdas: Uint8Array
}

const MAX_COMPASES = 64

const esCompuesto = (c: CompasHuella) => c.denominador === 8 && c.numerador % 3 === 0 && c.numerador >= 6
export const negrasPorCompas = (c: CompasHuella) => (c.numerador * 4) / c.denominador

/** FNV-1a doble de 32 bits → 16 hex. No es criptográfico: solo identifica patrones. */
function hashBytes(b: Uint8Array, sal: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x1b873593
  const mezcla = (x: number) => {
    h1 = Math.imul(h1 ^ x, 0x01000193)
    h2 = Math.imul(h2 ^ (x + 0x9e), 0x85ebca6b)
    h2 ^= h2 >>> 13
  }
  for (let i = 0; i < sal.length; i++) mezcla(sal.charCodeAt(i))
  for (let i = 0; i < b.length; i++) mezcla(b[i]!)
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

/** Construye la huella de un groove (notas con `inicio` en negras desde el principio). */
export function crearHuella(notas: readonly NotaHuella[], compas: CompasHuella = { numerador: 4, denominador: 4 }): Huella {
  const ppn = esCompuesto(compas) ? 6 : 4
  const npc = negrasPorCompas(compas)
  const pasos = Math.max(1, Math.round(npc * ppn))
  let ultimo = 0
  for (const n of notas) if (n.inicio > ultimo) ultimo = n.inicio
  const compases = Math.min(MAX_COMPASES, Math.max(1, Math.ceil((ultimo + 1e-6) / npc - 1e-9) || 1))
  const total = compases * pasos
  const grid = new Uint8Array(NF * total) // [familia][pasoGlobal]
  let golpes = 0
  for (const n of notas) {
    if (!(n.inicio >= 0) || n.velocidad <= 0) continue
    const paso = Math.round(n.inicio * ppn)
    if (paso >= total) continue // más allá del máximo
    const i = familiaDePitch(n.pitch) * total + paso
    const nivel = nivelDeVelocidad(n.velocidad)
    if (grid[i] === 0) golpes++
    if (nivel > grid[i]!) grid[i] = nivel
  }
  // Reorganiza a [compás][familia][paso] y busca el periodo mínimo.
  const porCompas = (c: number): Uint8Array => {
    const out = new Uint8Array(NF * pasos)
    for (let f = 0; f < NF; f++) for (let s = 0; s < pasos; s++) out[f * pasos + s] = grid[f * total + c * pasos + s]!
    return out
  }
  const barras = Array.from({ length: compases }, (_, c) => porCompas(c))
  const iguales = (a: Uint8Array, b: Uint8Array) => {
    for (let i = 0; i < a.length; i++) if ((a[i] ? 1 : 0) !== (b[i] ? 1 : 0)) return false
    return true
  }
  let periodo = compases
  for (let p = 1; p < compases; p++) {
    if (compases % p !== 0) continue
    let ok = true
    for (let c = p; c < compases && ok; c++) ok = iguales(barras[c]!, barras[c % p]!)
    if (ok) {
      periodo = p
      break
    }
  }
  const celdas = new Uint8Array(periodo * NF * pasos)
  for (let c = 0; c < periodo; c++) celdas.set(barras[c]!, c * NF * pasos)
  const bin = new Uint8Array(celdas.length)
  for (let i = 0; i < celdas.length; i++) bin[i] = celdas[i] ? 1 : 0
  const compasTxt = `${compas.numerador}/${compas.denominador}`
  return {
    hash: hashBytes(bin, `${compasTxt}|${ppn}|${periodo}|`),
    compas: compasTxt,
    pasosPorNegra: ppn,
    pasos,
    compases,
    periodo,
    densidad: golpes / compases,
    celdas,
  }
}

// ── Serialización (JSON de la base de datos) ─────────────────────────────────

export type HuellaJson = { v: 1; hash: string; compas: string; ppn: number; pasos: number; compases: number; periodo: number; densidad: number; celdas: string }

const aBase64 = (b: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!)
  return btoa(s)
}
const deBase64 = (t: string): Uint8Array => Uint8Array.from(atob(t), (c) => c.charCodeAt(0))

export function huellaAJson(h: Huella): HuellaJson {
  return { v: 1, hash: h.hash, compas: h.compas, ppn: h.pasosPorNegra, pasos: h.pasos, compases: h.compases, periodo: h.periodo, densidad: h.densidad, celdas: aBase64(h.celdas) }
}

export function huellaDeJson(j: unknown): Huella | null {
  const o = j as Partial<HuellaJson> | null
  if (!o || o.v !== 1 || typeof o.celdas !== 'string' || typeof o.hash !== 'string' || typeof o.pasos !== 'number' || typeof o.periodo !== 'number') return null
  try {
    const celdas = deBase64(o.celdas)
    if (celdas.length !== o.periodo * NF * o.pasos) return null
    return { hash: o.hash, compas: String(o.compas), pasosPorNegra: Number(o.ppn), pasos: o.pasos, compases: Number(o.compases), periodo: o.periodo, densidad: Number(o.densidad), celdas }
  } catch {
    return null
  }
}

// ── Similitud ────────────────────────────────────────────────────────────────

export type ResultadoSimilitud = {
  /** 0–100. */
  puntuacion: number
  nivel: NivelSimilitud
  /** Misma huella exacta. */
  identica: boolean
  /** Tiempos (negras) de desplazamiento con los que mejor coinciden (-2..2). */
  desplazamiento: number
}

const mcd = (a: number, b: number): number => (b ? mcd(b, a % b) : a)

/** Penalización por tiempo de desplazamiento. */
const PENA_DESPLAZAMIENTO = 0.04

/** Puntuación de un compás de A frente a un compás de B (ya alineados y desplazados). */
function puntuarCompas(a: Uint8Array, offA: number, b: Uint8Array, offB: number, pasos: number, desp: number): number {
  let num = 0
  let den = 0
  let velSum = 0
  let velN = 0
  for (let f = 0; f < NF; f++) {
    let inter = 0
    let union = 0
    for (let s = 0; s < pasos; s++) {
      const va = a[offA + f * pasos + s]!
      const sb = (((s + desp) % pasos) + pasos) % pasos
      const vb = b[offB + f * pasos + sb]!
      if (va || vb) {
        union++
        if (va && vb) {
          inter++
          velSum += 1 - Math.abs(va - vb) / 2
          velN++
        }
      }
    }
    num += PESOS[f]! * inter
    den += PESOS[f]! * union
  }
  const jaccard = den === 0 ? 1 : num / den
  const vel = velN === 0 ? 1 : velSum / velN
  return 0.9 * jaccard + 0.1 * vel * (jaccard > 0 ? 1 : 0)
}

/**
 * Compara dos huellas. Si los compases o la cuadrícula no coinciden (p. ej. 6/8 frente a 4/4) solo se comparan
 * densidad y longitud y la puntuación no pasa de 50. `corte` permite abandonar pronto lo claramente distinto.
 */
export function compararHuellas(a: Huella, b: Huella): ResultadoSimilitud {
  if (a.hash === b.hash) return { puntuacion: 100, nivel: 'duplicado', identica: true, desplazamiento: 0 }
  const dens = Math.max(a.densidad, b.densidad)
  const ratioDens = dens === 0 ? 1 : Math.min(a.densidad, b.densidad) / dens
  const largo = Math.max(a.periodo, b.periodo)
  const ratioLargo = Math.min(a.periodo, b.periodo) / largo
  if (a.pasos !== b.pasos || a.pasosPorNegra !== b.pasosPorNegra) {
    const p = Math.round(50 * (0.7 * ratioDens + 0.3 * ratioLargo))
    return { puntuacion: p, nivel: nivelDeSimilitud(p), identica: false, desplazamiento: 0 }
  }
  const pasos = a.pasos
  const ppn = a.pasosPorNegra
  const sz = NF * pasos
  // Longitud común: mínimo común múltiplo de los periodos (tope 16 compases).
  let L = (a.periodo * b.periodo) / mcd(a.periodo, b.periodo)
  if (L > 16) L = largo
  let mejor = 0
  let mejorDesp = 0
  for (let alin = 0; alin < b.periodo; alin++) {
    for (let d = -2; d <= 2; d++) {
      let suma = 0
      for (let c = 0; c < L; c++) {
        suma += puntuarCompas(a.celdas, (c % a.periodo) * sz, b.celdas, (((c + alin) % b.periodo) as number) * sz, pasos, d * ppn)
      }
      const media = (suma / L) * (1 - PENA_DESPLAZAMIENTO * Math.abs(d))
      if (media > mejor) {
        mejor = media
        mejorDesp = d
      }
    }
  }
  const factorLargo = 1 - 0.1 * (1 - ratioLargo)
  const p = Math.round(100 * (0.88 * mejor + 0.12 * ratioDens) * factorLargo * 10) / 10
  const puntuacion = Math.min(99.9, Math.max(0, p)) // 100 solo para huella idéntica
  return { puntuacion, nivel: nivelDeSimilitud(puntuacion), identica: false, desplazamiento: mejorDesp }
}

export type CandidatoSimilitud<T> = { item: T; huella: Huella }
export type CoincidenciaSimilitud<T> = { item: T; puntuacion: number; nivel: NivelSimilitud; identica: boolean; desplazamiento: number }

/**
 * Busca en una lista los grooves parecidos a `huella` (puntuación ≥ `minimo`, de mayor a menor). Prefiltra por
 * densidad (golpes por compás) y longitud para que comparar con miles de grooves sea inmediato.
 */
export function buscarSimilares<T>(
  huella: Huella,
  candidatos: ReadonlyArray<CandidatoSimilitud<T>>,
  opciones: { minimo?: number; max?: number } = {},
): Array<CoincidenciaSimilitud<T>> {
  const minimo = opciones.minimo ?? UMBRALES_SIMILITUD.similar
  const out: Array<CoincidenciaSimilitud<T>> = []
  for (const c of candidatos) {
    const h = c.huella
    if (h.hash !== huella.hash) {
      // Compases o cuadrícula distintos: como mucho 50, nunca llega a «similar».
      if (minimo > 50 && (h.pasos !== huella.pasos || h.pasosPorNegra !== huella.pasosPorNegra)) continue
      const mx = Math.max(h.densidad, huella.densidad)
      if (mx > 0 && Math.min(h.densidad, huella.densidad) / mx < 0.5) continue
    }
    const r = compararHuellas(huella, h)
    if (r.puntuacion >= minimo) out.push({ item: c.item, puntuacion: r.puntuacion, nivel: r.nivel, identica: r.identica, desplazamiento: r.desplazamiento })
  }
  out.sort((a, b) => b.puntuacion - a.puntuacion)
  return opciones.max ? out.slice(0, opciones.max) : out
}

/** Rejilla legible (para pintar): [compás][familia][paso] → nivel 0..3, del periodo. */
export function rejillaDeHuella(h: Huella): Array<Uint8Array[]> {
  const sz = NF * h.pasos
  return Array.from({ length: h.periodo }, (_, c) => Array.from({ length: NF }, (_, f) => h.celdas.slice(c * sz + f * h.pasos, c * sz + (f + 1) * h.pasos)))
}
