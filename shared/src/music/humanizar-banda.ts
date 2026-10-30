/**
 * Humanización determinista de las partes de la banda (plan S). Una IA que escribe «cuadrado» produce compases
 * idénticos, todo clavado en la rejilla y con la misma velocidad. Esta función pura, SIN modelo y SIN azar real
 * (semilla = pista + compás), hace tres cosas por instrumento:
 *
 *  1. Micro-timing con desvío gaussiano pequeño (batería ±6 ms con el golpe del tiempo 1 casi exacto y los hi-hats
 *     con un swing leve; bajo «detrás» del bombo; guitarra, piano y pad ±14–18 ms; lead algo más suelto). Las notas
 *     de un mismo acorde se mueven juntas (el legato worship las agrupa por inicio) y ninguna cruza la barra del
 *     compás hacia atrás: el primer tiempo solo se retrasa.
 *  2. Microdinámica: acento natural por tiempo (fuerte > medio > débil), ghost notes de caja con su propia variación
 *     y una pequeña ganancia distinta en cada compás.
 *  3. Variación entre compases repetidos: a cada copia exacta se le aplica una variación distinta (semilla = compás):
 *     batería, ghost notes añadidas o quitadas, hi-hat abierto ocasional y un fill corto cada 4 compases (largo
 *     cada 8); bajo, guitarra y piano, algún ataque débil desplazado una semicorchea o suprimido. NUNCA cambia
 *     alturas ni añade notas que no sean de percusión: la armonía de la hoja de ruta queda intacta. Nunca toca el
 *     primer compás de una sección (solo el micro-timing y la dinámica).
 *
 * No muta la entrada y es reproducible: la misma entrada con la misma semilla da siempre la misma salida.
 */

export type FamiliaBanda = 'bateria' | 'bajo' | 'piano' | 'guitarra' | 'pad' | 'cuerdas' | 'lead' | 'otro'
export type ModoHumanizarBanda = 'siempre' | 'suave'

export interface NotaHumanizable {
  pitch: number
  /** Beats desde el inicio del clip. */
  inicio: number
  /** Beats. */
  duracion: number
  velocidad?: number
}

export interface NotaHumanizada extends NotaHumanizable {
  velocidad: number
  /** Índice de la nota de entrada de la que viene; −1 si es una nota nueva (percusión). */
  origen: number
  /** Para las nuevas: índice de una nota de entrada que sirve de plantilla de campos. */
  plantilla: number
}

export interface OpcionesHumanizarBanda {
  familia: FamiliaBanda
  bpm: number
  /** Pulsos por compás (4 por defecto). */
  numerador?: number
  modo?: ModoHumanizarBanda
  /** Semilla de texto estable (p. ej. el id de la pista): con ella y el compás se decide todo. */
  semilla: string
  /** Beat de la canción en el que empieza el clip (para numerar los compases con el resto de la pista). */
  inicioClip?: number
  /** Duración del clip: ninguna nota la sobrepasa. */
  finClip?: number
  /** Compases absolutos (0-based) que empiezan una sección: solo reciben micro-timing y dinámica. */
  compasesProtegidos?: ReadonlySet<number>
  /**
   * Memoria de la pista: firma estructural de cada compás ya visto → compases absolutos donde apareció. Se muta.
   * Con ella, un compás igual a otro escrito antes (incluso en otro clip) se detecta como copia.
   */
  vistos?: Map<string, Set<number>>
}

export interface ResumenHumanizarBanda {
  /** Notas cuyo inicio se movió. */
  movidas: number
  /** Notas cuya velocidad cambió. */
  velocidades: number
  /** Compases que eran copia exacta de otro. */
  copias: number
  /** Compases con variación estructural (notas añadidas, quitadas o desplazadas). */
  variados: number
  fantasmas: number
  fills: number
}

// ---------------------------------------------------------------------------------------------------------------
// Azar reproducible
// ---------------------------------------------------------------------------------------------------------------

function hash32(texto: string): number {
  let h = 1779033703 ^ texto.length
  for (let i = 0; i < texto.length; i++) {
    h = Math.imul(h ^ texto.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}

export function azarDeterminista(semilla: string): () => number {
  let a = hash32(semilla)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gauss(r: () => number): number {
  const u = Math.max(1e-9, r())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}

// ---------------------------------------------------------------------------------------------------------------
// Familia del instrumento
// ---------------------------------------------------------------------------------------------------------------

/** Familia por el nombre de la pista y de sus plugins. */
export function clasificarFamiliaBanda(nombre: string, plugins: ReadonlyArray<{ nombre?: string }> = []): FamiliaBanda {
  const t = `${nombre} ${plugins.map((p) => p.nombre ?? '').join(' ')}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/bater|drum|percus|kit/.test(t)) return 'bateria'
  if (/\bbajo|bajista|bass/.test(t)) return 'bajo'
  if (/guitar|gtr/.test(t)) return 'guitarra'
  if (/\bpads?\b|atmos|ambient|ambiente|textur|drone/.test(t)) return 'pad'
  if (/cuerd|string|violin|viola|cello|chelo|orquest/.test(t)) return 'cuerdas'
  if (/lead|solo|melod|arp|sinte|synth/.test(t)) return 'lead'
  if (/pian|teclad|key|organ|rhodes|wurli/.test(t)) return 'piano'
  return 'otro'
}

// Percusión general MIDI.
const BOMBOS = new Set([35, 36])
const CAJAS = new Set([37, 38, 39, 40])
const HATS = new Set([42, 44, 46])
const TOMS = [50, 48, 47, 45, 43, 41]
const PLATOS = new Set([49, 51, 52, 53, 55, 57, 59])

/** Perfil de micro-timing en ms: desvío típico, tope y sesgo medio (positivo = «detrás»). */
const PERFIL_MS: Record<FamiliaBanda, { sigma: number; tope: number; sesgo: number }> = {
  bateria: { sigma: 3, tope: 6, sesgo: 0 },
  bajo: { sigma: 3.5, tope: 12, sesgo: 5 },
  piano: { sigma: 7, tope: 16, sesgo: 0 },
  guitarra: { sigma: 7, tope: 16, sesgo: 0 },
  pad: { sigma: 9, tope: 18, sesgo: 0 },
  cuerdas: { sigma: 9, tope: 18, sesgo: 0 },
  lead: { sigma: 9, tope: 20, sesgo: 0 },
  otro: { sigma: 6, tope: 14, sesgo: 0 },
}
/** Tope absoluto del desplazamiento en beats: debe caber en el margen de rejilla de la medición de coherencia. */
export const MAX_DESVIO_BEATS = 0.06

// ---------------------------------------------------------------------------------------------------------------
// Utilidades de compás
// ---------------------------------------------------------------------------------------------------------------

const EPS = 1e-6
const UNIDAD = 1 / 32

type Viva = { pitch: number; inicio: number; duracion: number; velocidad: number | undefined; origen: number; plantilla: number }

const q32 = (x: number) => Math.round(x / UNIDAD)

/** Firma estructural de un compás: alturas, posiciones y duraciones a 1/32 de beat (el micro-timing no cuenta). */
function firmaCompas(notas: ReadonlyArray<Viva>, inicioCompas: number): string {
  return notas
    .map((n) => `${n.pitch}@${q32(n.inicio - inicioCompas)}/${q32(n.duracion)}`)
    .sort()
    .join('|')
}

const limitar = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))

function elegir<T>(lista: T[], r: () => number): T | undefined {
  return lista.length ? lista[Math.min(lista.length - 1, Math.floor(r() * lista.length))] : undefined
}

function barajar<T>(lista: T[], r: () => number): T[] {
  const a = [...lista]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

// ---------------------------------------------------------------------------------------------------------------
// Variación estructural
// ---------------------------------------------------------------------------------------------------------------

type Contexto = {
  fam: FamiliaBanda
  num: number
  absCompas: number
  relCompas: number
  /** Beat (relativo al clip) donde empieza el compás. */
  ini: number
  finClip: number
  r: () => number
  modo: ModoHumanizarBanda
  resumen: ResumenHumanizarBanda
  todas: ReadonlyArray<Viva>
  nuevaPlantilla: number
}

const pos = (n: Viva, c: Contexto) => n.inicio - c.ini

function agruparPorInicio(notas: Viva[]): Viva[][] {
  const grupos: Viva[][] = []
  for (const n of [...notas].sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch)) {
    const g = grupos[grupos.length - 1]
    if (g && Math.abs(g[0]!.inicio - n.inicio) < UNIDAD / 2) g.push(n)
    else grupos.push([n])
  }
  return grupos
}

/** Batería: ghost notes de caja distintas, hi-hat abierto ocasional y fills. Devuelve las notas del compás ya variadas. */
function variarBateria(notas: Viva[], c: Contexto, copia: boolean): Viva[] {
  let out = [...notas]
  const usa = (s: Set<number>) => c.todas.some((n) => s.has(n.pitch))
  const caja = c.todas.find((n) => CAJAS.has(n.pitch))?.pitch ?? 38
  const hayCaja = usa(CAJAS)
  const hayTom = TOMS.filter((p) => c.todas.some((n) => n.pitch === p))
  const libre = (p: number, margen = 0.1) => !out.some((n) => (BOMBOS.has(n.pitch) || CAJAS.has(n.pitch)) && Math.abs(pos(n, c) - p) < margen)

  // Fill: último compás de cada grupo de 4 (largo cada 8). La batería suena igual en el resto del compás.
  const finDeFrase = (c.absCompas + 1) % 4 === 0 && c.relCompas > 0
  if (finDeFrase && hayCaja && c.r() < 0.75) {
    const largo = (c.absCompas + 1) % 8 === 0
    const desde = largo ? c.num - 2 : c.num - 1
    const pasos = largo ? 8 : 4
    out = out.filter((n) => !(pos(n, c) >= desde - EPS && (HATS.has(n.pitch) || CAJAS.has(n.pitch) || TOMS.includes(n.pitch) || (n.velocidad ?? 100) < 45)))
    const secuencia = largo && hayTom.length >= 2 ? hayTom : [caja]
    for (let i = 0; i < pasos; i++) {
      const p = desde + i * (largo ? 0.25 : 0.25)
      const pitch = secuencia[Math.min(secuencia.length - 1, Math.floor((i / pasos) * secuencia.length))]!
      const v = Math.round(52 + (i / (pasos - 1)) * 46 + gauss(c.r) * 3)
      out.push({ pitch, inicio: c.ini + p, duracion: 0.2, velocidad: limitar(v, 30, 118), origen: -1, plantilla: c.nuevaPlantilla })
    }
    c.resumen.fills++
    c.resumen.variados++
    return out
  }

  if (!copia && c.modo !== 'siempre') return out

  if (hayCaja) {
    // Ghost notes: 2–3 por compás en sitios que cambian de una copia a otra.
    const fantasmas = out.filter((n) => CAJAS.has(n.pitch) && (n.velocidad ?? 100) < 45)
    const objetivo = 2 + (c.r() < 0.45 ? 1 : 0)
    if (fantasmas.length > objetivo || (fantasmas.length && c.r() < 0.35)) {
      const quitar = elegir(fantasmas, c.r)!
      out = out.filter((n) => n !== quitar)
      c.resumen.variados++
    }
    const faltan = objetivo - out.filter((n) => CAJAS.has(n.pitch) && (n.velocidad ?? 100) < 45).length
    if (faltan > 0) {
      const candidatos = barajar([0.75, 1.75, 2.25, 2.75, 3.25, 3.75, 1.25, 0.25].filter((p) => p < c.num - 0.2 && libre(p, 0.2)), c.r)
      for (const p of candidatos.slice(0, faltan)) {
        out.push({ pitch: caja, inicio: c.ini + p, duracion: 0.15, velocidad: Math.round(18 + c.r() * 16), origen: -1, plantilla: c.nuevaPlantilla })
        c.resumen.fantasmas++
      }
      c.resumen.variados++
    }
  }
  // Hi-hat abierto ocasional (solo si el kit del propio clip ya lo usa: no se inventan sonidos).
  if (c.todas.some((n) => n.pitch === 46) && c.r() < 0.3) {
    const cerrado = out.filter((n) => n.pitch === 42 && Math.abs(((pos(n, c) % 1) + 1) % 1 - 0.5) < 0.05)
    const h = elegir(cerrado, c.r)
    if (h) {
      out = out.map((n) => (n === h ? { ...n, pitch: 46, duracion: Math.max(n.duracion, 0.4) } : n))
      c.resumen.variados++
    }
  }
  return out
}

/** Instrumentos afinados: algún ataque débil desplazado o suprimido. Mismas alturas; sin tocar el tiempo fuerte. */
function variarAfinado(notas: Viva[], c: Contexto): Viva[] {
  if (c.fam === 'lead' || c.fam === 'pad' || c.fam === 'cuerdas' || c.fam === 'otro') return notas
  let out = [...notas]
  const grupos = agruparPorInicio(out)
  // Solo ataques en tiempo débil (≥ ¼ de beat tras la barra) y cortos: la armonía exigida en el primer tiempo y en
  // las notas largas queda como estaba.
  const debiles = grupos.filter((g) => pos(g[0]!, c) >= 0.5 - EPS && g.every((n) => n.duracion < 1 - EPS))
  const acc = c.r()
  if (grupos.length >= 6 && debiles.length >= 2 && acc < 0.5) {
    const g = elegir(debiles, c.r)!
    out = out.filter((n) => !g.includes(n))
    c.resumen.variados++
  } else if (debiles.length >= 1 && acc < 0.95) {
    const g = elegir(debiles, c.r)!
    const p0 = pos(g[0]!, c)
    const d = c.r() < 0.5 ? -0.25 : 0.25
    const p1 = p0 + d
    const ocupado = grupos.some((o) => o !== g && Math.abs(pos(o[0]!, c) - p1) < 0.2)
    if (p1 >= 0.5 - EPS && p1 + 0.25 < c.num && !ocupado) {
      out = out.map((n) => (g.includes(n) ? { ...n, inicio: n.inicio + d, duracion: Math.max(UNIDAD * 2, n.duracion - d) } : n))
      c.resumen.variados++
    }
  }
  // Pequeña variación de duración (múltiplos de 1/16) en notas cortas que no sean el primer ataque del compás.
  const cortas = out.filter((n) => pos(n, c) >= 0.5 - EPS && n.duracion < 1 - EPS && n.duracion >= 0.25)
  const k = elegir(cortas, c.r)
  if (k && c.r() < 0.6) {
    const nueva = Math.max(0.125, k.duracion + (c.r() < 0.5 ? -0.0625 : 0.0625))
    out = out.map((n) => (n === k ? { ...n, duracion: nueva } : n))
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Dinámica y tiempo
// ---------------------------------------------------------------------------------------------------------------

function acento(n: Viva, p: number, fam: FamiliaBanda, num: number): number {
  if (fam === 'bateria') {
    if (HATS.has(n.pitch) || PLATOS.has(n.pitch)) return Math.abs(p - Math.round(p)) < 0.05 ? 6 : Math.abs(p * 2 - Math.round(p * 2)) < 0.05 ? -3 : -8
    if (BOMBOS.has(n.pitch)) return p < 0.05 ? 8 : Math.abs(p - Math.round(p)) < 0.05 ? 3 : -3
    if (CAJAS.has(n.pitch)) return 3
    return 0
  }
  if (fam === 'pad' || fam === 'cuerdas') return 0
  if (p < 0.05) return 7
  if (num % 2 === 0 && Math.abs(p - num / 2) < 0.05) return 3
  if (Math.abs(p - Math.round(p)) < 0.05) return 0
  if (Math.abs(p * 2 - Math.round(p * 2)) < 0.05) return -3
  return -6
}

// ---------------------------------------------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------------------------------------------

export function humanizarBanda(notas: readonly NotaHumanizable[], o: OpcionesHumanizarBanda): { notas: NotaHumanizada[]; resumen: ResumenHumanizarBanda } {
  const resumen: ResumenHumanizarBanda = { movidas: 0, velocidades: 0, copias: 0, variados: 0, fantasmas: 0, fills: 0 }
  if (!notas.length || !(o.bpm > 0)) {
    return { notas: notas.map((n, i) => ({ ...n, velocidad: n.velocidad ?? 80, origen: i, plantilla: i })), resumen }
  }
  const num = Math.max(1, Math.round(o.numerador ?? 4))
  const modo = o.modo ?? 'suave'
  const fam = o.familia
  const inicioClip = o.inicioClip ?? 0
  const finClip = o.finClip ?? Infinity
  const absDe = (inicio: number) => Math.floor((inicioClip + inicio) / num + 1e-9)
  const absPrimero = absDe(Math.min(...notas.map((n) => n.inicio)))

  // Compases con sus notas vivas (la entrada sin mutar).
  const vivas: Viva[] = notas.map((n, i) => ({ pitch: n.pitch, inicio: n.inicio, duracion: n.duracion, velocidad: n.velocidad, origen: i, plantilla: i }))
  const porCompas = new Map<number, Viva[]>()
  for (const n of vivas) {
    const a = absDe(n.inicio)
    porCompas.set(a, [...(porCompas.get(a) ?? []), n])
  }
  const resultado: Viva[] = []
  const vistos = o.vistos

  for (const abs of [...porCompas.keys()].sort((a, b) => a - b)) {
    let grupo = porCompas.get(abs)!
    const ini = abs * num - inicioClip
    const protegido = !!o.compasesProtegidos?.has(abs) || abs === absPrimero
    const r = azarDeterminista(`${o.semilla}:${abs}`)

    // Copia exacta de otro compás de esta pista (misma estructura).
    const firma = firmaCompas(grupo, ini)
    const antes = vistos?.get(firma)
    const copia = !!antes && [...antes].some((x) => x !== abs)
    if (vistos && grupo.length >= 3) vistos.set(firma, new Set([...(antes ?? []), abs]))
    if (copia) resumen.copias++

    // 1) Variación estructural (antes del tiempo y la dinámica).
    if (!protegido && fam !== 'otro') {
      const ctx: Contexto = { fam, num, absCompas: abs, relCompas: abs - absPrimero, ini, finClip, r, modo, resumen, todas: vivas, nuevaPlantilla: grupo[0]!.plantilla }
      if (fam === 'bateria') grupo = variarBateria(grupo, ctx, copia)
      else if (copia || modo === 'siempre') grupo = variarAfinado(grupo, ctx)
    }

    // 2) Tiempo: un desvío por acorde (las notas del mismo inicio se mueven juntas).
    const perfil = PERFIL_MS[fam]
    const factor = modo === 'siempre' ? 1.25 : 1
    const aBeats = (ms: number) => Math.min(MAX_DESVIO_BEATS, (ms * o.bpm) / 60000)
    const swingMs = fam === 'bateria' ? Math.max(0, 3 + gauss(r) * 1.5) : 0
    for (const g of agruparPorInicio(grupo)) {
      const n0 = g[0]!
      const p = n0.inicio - ini
      const enBarra = p < 0.02
      let sigma = perfil.sigma
      let tope = perfil.tope
      let ms = 0
      if (fam === 'bateria') {
        const golpeFuerte = enBarra && g.some((n) => BOMBOS.has(n.pitch) || CAJAS.has(n.pitch))
        if (golpeFuerte) {
          sigma = 1.2
          tope = 3
        } else if (g.every((n) => HATS.has(n.pitch) || PLATOS.has(n.pitch))) {
          sigma = 3.5
          const frac = ((p % 1) + 1) % 1
          ms += Math.abs(frac - 0.5) < 0.05 ? swingMs : Math.abs(frac - 0.25) < 0.05 || Math.abs(frac - 0.75) < 0.05 ? swingMs / 2 : 0
        }
      }
      ms += perfil.sesgo + gauss(r) * sigma * factor
      ms = limitar(ms, -tope * factor, tope * factor)
      let d = aBeats(Math.abs(ms)) * Math.sign(ms)
      // La barra del compás no se cruza hacia atrás y el clip no empieza antes de cero.
      if (p + d < 0) d = Math.abs(d)
      for (const n of g) {
        const nuevoInicio = Math.max(Math.max(0, ini), n.inicio + d)
        if (Math.abs(nuevoInicio - n.inicio) > 1e-9) resumen.movidas++
        // El final de la nota se mueve con el ataque salvo que se pase del clip.
        const dur = Number.isFinite(finClip) && nuevoInicio + n.duracion > finClip ? Math.max(UNIDAD, finClip - nuevoInicio) : n.duracion
        n.inicio = nuevoInicio
        n.duracion = dur
      }
    }

    // 3) Dinámica: acento natural + ganancia de este compás + ruido pequeño. Los ghost notes conservan su fuerza baja.
    const ganancia = gauss(r) * (copia ? 3 : 1.5)
    const ruido = fam === 'pad' || fam === 'cuerdas' ? 1.5 : fam === 'bateria' ? 3 : fam === 'lead' ? 4 : 3
    for (const n of grupo) {
      const base = n.velocidad ?? (fam === 'bateria' ? 92 : 84)
      const fantasma = fam === 'bateria' && CAJAS.has(n.pitch) && base < 45
      const nueva = fantasma ? base + gauss(r) * 4 : base + acento(n, n.inicio - ini, fam, num) + ganancia + gauss(r) * ruido
      const v = Math.round(limitar(nueva, fantasma ? 8 : 1, fantasma ? 44 : 127))
      if (v !== n.velocidad) resumen.velocidades++
      n.velocidad = v
    }
    resultado.push(...grupo)
  }

  // Misma altura nunca solapada tras mover los ataques.
  resultado.sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch)
  const ultima = new Map<number, Viva>()
  for (const n of resultado) {
    const prev = ultima.get(n.pitch)
    if (prev && prev.inicio + prev.duracion > n.inicio - EPS) prev.duracion = Math.max(UNIDAD / 2, n.inicio - prev.inicio - 1 / 64)
    ultima.set(n.pitch, n)
  }
  const salida: NotaHumanizada[] = resultado.map((n) => ({ pitch: n.pitch, inicio: Math.round(n.inicio * 1e6) / 1e6, duracion: Math.round(n.duracion * 1e6) / 1e6, velocidad: n.velocidad ?? 80, origen: n.origen, plantilla: n.plantilla }))
  return { notas: salida, resumen }
}
