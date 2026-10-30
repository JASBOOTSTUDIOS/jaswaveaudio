/**
 * Medición determinista de la coherencia de la banda con la hoja de ruta (la usa el arreglista):
 *  - Tiempo: clips en la barra de compás, nada después del final, nadie se apaga antes del final, la base
 *    no deja secciones vacías, notas cerca de la rejilla (semicorcheas o tresillos, con margen humano).
 *  - Armonía: notas de la tonalidad, el tiempo fuerte en el acorde del compás (extensiones incluidas), el
 *    bajo en la fundamental (o en la nota tras «/»).
 *  - Ritmo: el bajo se apoya en el bombo.
 *  - Vida: una parte con todas las notas de la misma duración o la misma velocidad suena robótica y se
 *    devuelve a su músico (no se «corrige» nota a nota).
 * Solo lee el estado; cada detalle nombra la pista y los compases para que el arreglista los corrija.
 */
import type { MedicionQA, TiendaDAW } from '@jaswave/host-sdk'

/** Lo que se usa de la hoja de ruta (misma forma que `HojaDeRuta` del harness). */
export type HojaCoherencia = { tonalidad: string; numerador: number; secciones: Array<{ nombre: string; compases: number; acordes: string[] }> }

type Nota = { pitch: number; inicio: number; duracion: number; velocidad?: number }
type Pista = { nombre: string; clips?: Array<{ nombre?: string; inicio: number; duracion: number; notas?: Nota[] }>; plugins?: Array<{ nombre?: string }> }

const LETRA: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const SOLFEO: Array<[RegExp, number]> = [
  [/^do/i, 0],
  [/^re/i, 2],
  [/^mi/i, 4],
  [/^fa/i, 5],
  [/^sol/i, 7],
  [/^la/i, 9],
  [/^si/i, 11],
]
const MAYOR = [0, 2, 4, 5, 7, 9, 11]
/** Menor natural más la sensible (menor armónica). */
const MENOR = [0, 2, 3, 5, 7, 8, 10, 11]
/**
 * Margen humano respecto de la rejilla (beats): ~50 ms a 120 BPM. El micro-tiempo de un músico cabe aquí: la
 * humanización de la banda (`humanizarBanda`) desplaza como mucho `MAX_DESVIO_BEATS` = 0,06 y el prompt del músico
 * pide hasta ±0,04, así que 0,1 tolera ambos sumados. Nota de diseño: la rejilla admitida es la unión de
 * semicorcheas, tresillos de corchea y sextillos, cuyo punto más lejano de cualquiera de ellas está a 1/12 ≈ 0,083
 * beats; con un margen ≥ 0,084 esta comprobación solo se dispara con ritmos que no son de ninguna rejilla y nunca
 * por el desvío humano que introducimos (comprobado en `humanizar-banda.test.ts`).
 */
const MARGEN_REJILLA = 0.1
/** Fracción de compases idénticos a otro a partir de la cual se avisa («varía velocidades, adornos o reparto»). */
export const UMBRAL_COPIAS = 0.4
/** Un compás cuenta como cubierto por una nota anterior que lo atraviesa si la solapa al menos esta fracción. */
const FRACCION_SOLAPE_COMPAS = 0.4
const MAX_DETALLES = 14
/** A partir de cuántas notas juzgamos si una parte suena robótica (todo igual). */
const MIN_NOTAS_VIDA = 16

const pc = (n: number) => ((n % 12) + 12) % 12

/** «Re mayor», «Si menor», «D», «Bm», «F# minor», «Mi bemol mayor» → fundamental y modo. */
export function parsearTonalidad(t: string): { raiz: number; menor: boolean } | null {
  const s = t.trim()
  let raiz: number | null = null
  let resto = s
  const ingles = /^([A-G])/.exec(s)
  const solfeo = SOLFEO.find(([re]) => re.test(s))
  if (solfeo) {
    raiz = solfeo[1]
    resto = s.replace(/^(do|re|mi|fa|sol|la|si)/i, '')
  } else if (ingles) {
    raiz = LETRA[ingles[1]!]!
    resto = s.slice(ingles[0].length)
  }
  if (raiz == null) return null
  if (/^\s*(#|♯|sostenido)/i.test(resto)) raiz++
  else if (/^\s*(b(?![a-z])|♭|bemol)/i.test(resto)) raiz--
  const menor = /menor|minor|^\s*[#♯b♭]?\s*m(?!a)/i.test(resto)
  return { raiz: pc(raiz), menor }
}

/** Cifrado americano → fundamental, notas del acorde (clases) y bajo. «G/B», «A7sus4», «F#m7b5», «Cadd9». */
export function parsearAcorde(a: string): { raiz: number; notas: Set<number>; bajo: number } | null {
  const m = /^\s*([A-G])([#♯b♭]?)([^/]*?)(?:\/([A-G])([#♯b♭]?))?\s*$/.exec(a)
  if (!m) return null
  const alt = (x?: string) => (x === '#' || x === '♯' ? 1 : x === 'b' || x === '♭' ? -1 : 0)
  const raiz = pc(LETRA[m[1]!]! + alt(m[2]))
  const q = m[3] ?? ''
  const iv = new Set<number>([0])
  const dim = /dim|°/.test(q) || /m7b5|ø/.test(q)
  const aug = /aug|\+/.test(q)
  const menor = !dim && /^m(?!aj)/.test(q)
  if (/sus2/.test(q)) iv.add(2)
  else if (/sus/.test(q)) iv.add(5)
  else if (q.trim() !== '5') iv.add(menor || dim ? 3 : 4)
  iv.add(dim ? 6 : aug ? 8 : 7)
  if (/maj7|M7|Δ/.test(q)) iv.add(11)
  else if (/dim7|°7/.test(q)) iv.add(9)
  else if (/7|9|11|13/.test(q.replace(/add\d+/, ''))) iv.add(10)
  if (/6|13/.test(q)) iv.add(9)
  if (/9|add2/.test(q)) iv.add(2)
  if (/11|add4/.test(q)) iv.add(5)
  if (/b9/.test(q)) iv.add(1)
  if (/#11/.test(q)) iv.add(6)
  if (/b5/.test(q)) iv.add(6)
  const bajo = m[4] ? pc(LETRA[m[4]]! + alt(m[5])) : raiz
  return { raiz, notas: new Set([...iv].map((i) => pc(raiz + i)).concat(bajo)), bajo }
}

/** «3, 5–7, 12» (compases 1-based). */
function rangos(compases: number[]): string {
  const s = [...new Set(compases)].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < s.length; ) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j]! + 1) j++
    out.push(j > i ? `${s[i]}–${s[j]}` : `${s[i]}`)
    i = j + 1
  }
  return out.length > 8 ? `${out.slice(0, 8).join(', ')}…` : out.join(', ')
}

const enRejilla = (b: number) => {
  const r16 = Math.abs(b * 4 - Math.round(b * 4)) / 4
  const r3 = Math.abs(b * 3 - Math.round(b * 3)) / 3
  const r6 = Math.abs(b * 6 - Math.round(b * 6)) / 6
  return Math.min(r16, r3, r6) <= MARGEN_REJILLA
}

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Sección de la hoja de ruta con sus compases (0-based, [desde, hasta)). */
export type SeccionCompases = { nombre: string; desde: number; hasta: number }

export function seccionesConCompases(hoja: HojaCoherencia): SeccionCompases[] {
  let compas = 0
  return hoja.secciones.map((s) => {
    const r = { nombre: s.nombre, desde: compas, hasta: compas + s.compases }
    compas += s.compases
    return r
  })
}

/** Instrumentos que no tocan sin parar (lead, melodía, voz, efectos): se les pide cubrir secciones, no cada compás. */
const NO_CONTINUA = /lead|melod|solo|voz|vocal|fx|efecto|riser|impact/i
const SOLO_CERCA = /\b(solo|solamente|unicamente|exclusivamente)\b/

/**
 * Secciones que el encargo limita EXPLÍCITAMENTE («solo en el puente», «únicamente en el coro»): la palabra
 * restrictiva debe estar a ≤ 30 caracteres de la mención. Nombrar una sección sin más NO limita nada (un pianista
 * con «intro suave…» sigue tocando toda la canción: error de la pasada real del e2e 29).
 */
function seccionesLimitadas(encargo: string, secciones: SeccionCompases[]): SeccionCompases[] {
  const t = sinAcentos(encargo)
  return secciones.filter((s) => {
    const base = sinAcentos(s.nombre).replace(/[\s\d]+$/g, '').trim()
    if (base.length < 3) return false
    for (let i = t.indexOf(base); i >= 0; i = t.indexOf(base, i + 1)) {
      if (SOLO_CERCA.test(t.slice(Math.max(0, i - 30), i + base.length + 30))) return true
    }
    return false
  })
}

export type Hueco = { seccion: string; desde: number; hasta: number }

/**
 * Compases sin notas dentro de las secciones exigidas. Un compás está cubierto si empieza en él una nota o lo
 * atraviesa una (≥ 40 % del compás). En pistas continuas se permite un único compás de silencio al FINAL de una
 * sección (respiro o hit) si el resto está cubierto; en las demás basta con que la sección tenga alguna nota.
 */
export function huecosPorCompas(notas: ReadonlyArray<{ inicio: number; duracion: number }>, exigidas: SeccionCompases[], num: number, continua: boolean): Hueco[] {
  const total = Math.max(0, ...exigidas.map((s) => s.hasta))
  const cubierto = new Array<boolean>(total).fill(false)
  for (const n of notas) {
    const b0 = Math.max(0, Math.floor(n.inicio / num + 1e-9))
    const fin = n.inicio + n.duracion
    for (let b = b0; b < total && b * num < fin - 1e-9; b++) {
      const a = b * num
      const empieza = n.inicio >= a - 1e-6 && n.inicio < a + num - 1e-6
      const solape = Math.min(a + num, fin) - Math.max(a, n.inicio)
      if (empieza || solape >= FRACCION_SOLAPE_COMPAS * num) cubierto[b] = true
    }
  }
  const huecos: Hueco[] = []
  for (const s of exigidas) {
    const vacios: number[] = []
    for (let b = s.desde; b < s.hasta; b++) if (!cubierto[b]) vacios.push(b)
    if (!vacios.length) continue
    const todos = vacios.length === s.hasta - s.desde
    if (!continua && !todos) continue
    if (continua && !todos && vacios.length === 1 && vacios[0] === s.hasta - 1) continue
    for (let i = 0; i < vacios.length; ) {
      let j = i
      while (j + 1 < vacios.length && vacios[j + 1] === vacios[j]! + 1) j++
      huecos.push({ seccion: s.nombre, desde: vacios[i]!, hasta: vacios[j]! + 1 })
      i = j + 1
    }
  }
  return huecos
}

const textoHueco = (h: Hueco, num: number) => `${h.seccion} (${h.hasta - h.desde === 1 ? `compás ${h.desde + 1}` : `compases ${h.desde + 1}–${h.hasta}`}, beat ${h.desde * num}, ${(h.hasta - h.desde) * num} beats)`
const COLA_FALTANTES = '. Si el tramo está libre, crea un clip que empiece en su beat con la duración indicada; si cae DENTRO de un clip que ya existe (otro clip ahí se rechaza), añade las notas a ese clip con midi.notes.patch o amplíalo, sin crear uno nuevo.'

/**
 * Cobertura de la parte de un músico frente a la hoja de ruta, o null si está completa (mensaje accionable con
 * los rangos de compases vacíos, su beat de inicio y su duración en beats).
 * Qué se le exige: toda la canción salvo la intro y el outro (la base rítmica, también el outro); si el encargo dice
 * «solo/únicamente/exclusivamente/solamente» junto a una sección, solo esa. Se mide POR COMPÁS: en batería, bajo,
 * piano, guitarra, pads y cuerdas ningún compás de una sección exigida puede quedar sin notas (un compás de
 * respiro al final de la sección se tolera); los leads y melodías solo necesitan notas en cada sección exigida.
 */
export function seccionesFaltantes(st: ReturnType<TiendaDAW['obtenerEstado']>, hoja: HojaCoherencia, o: { pista: string; encargo: string }): string | null {
  const q = o.pista.trim().toLowerCase()
  const pista = ((st.project?.tracks ?? []) as unknown as Array<Pista & { id: string }>).find((t) => t.id === o.pista || t.nombre.trim().toLowerCase() === q)
  if (!pista) return null
  const num = Math.max(1, Math.round(hoja.numerador || Number(st.project?.timeSignature?.numerador ?? 4) || 4))
  const secciones = seccionesConCompases(hoja)
  if (secciones.length < 2) return null
  const texto = `${pista.nombre} ${(pista.plugins ?? []).map((p) => p.nombre ?? '').join(' ')}`
  const base = /bater|drum|percus|kit|bajo|bass/i.test(texto)
  const limitadas = base ? [] : seccionesLimitadas(o.encargo, secciones)
  const exigidas = limitadas.length ? limitadas : base ? secciones.slice(1) : secciones.slice(1, -1)
  const notas: Nota[] = []
  for (const c of pista.clips ?? []) for (const n of c.notas ?? []) notas.push({ pitch: n.pitch, inicio: c.inicio + n.inicio, duracion: n.duracion })
  const huecos = huecosPorCompas(notas, exigidas, num, !NO_CONTINUA.test(texto))
  if (!huecos.length) return null
  return `en «${pista.nombre}» no hay notas en: ${huecos.map((h) => textoHueco(h, num)).join('; ')}${COLA_FALTANTES}`
}

/** Firma estructural de un compás (alturas, posición y duración a 1/32 de beat). */
function firmasPorCompas(notas: ReadonlyArray<Nota>, num: number): Map<number, string> {
  const q = (x: number) => Math.round(x * 32)
  const porCompas = new Map<number, string[]>()
  for (const n of notas) {
    const c = Math.floor(n.inicio / num + 1e-9)
    porCompas.set(c, [...(porCompas.get(c) ?? []), `${n.pitch}@${q(n.inicio - c * num)}/${q(n.duracion)}`])
  }
  const out = new Map<number, string>()
  for (const [c, l] of porCompas) if (l.length >= 3) out.set(c, l.sort().join('|'))
  return out
}

/** Compases con ≥ 3 notas que son copia exacta (alturas, posiciones y duraciones) de otro compás de la misma lista. */
export function copiasExactas(notas: ReadonlyArray<Nota>, num: number): { copias: number; compases: number } {
  const firmas = firmasPorCompas(notas, num)
  const cuenta = new Map<string, number>()
  for (const f of firmas.values()) cuenta.set(f, (cuenta.get(f) ?? 0) + 1)
  let copias = 0
  for (const f of firmas.values()) if ((cuenta.get(f) ?? 0) > 1) copias++
  return { copias, compases: firmas.size }
}

export function analizarCoherencia(st: ReturnType<TiendaDAW['obtenerEstado']>, hoja: HojaCoherencia): MedicionQA {
  const num = Math.max(1, Math.round(hoja.numerador || Number(st.project?.timeSignature?.numerador ?? 4) || 4))
  // Acorde de cada compás e inicio de cada sección.
  const acordes: Array<ReturnType<typeof parsearAcorde>> = []
  const nombres: string[] = []
  const inicios: Array<{ nombre: string; compas: number }> = []
  for (const s of hoja.secciones) {
    inicios.push({ nombre: s.nombre, compas: acordes.length })
    for (let i = 0; i < s.compases; i++) {
      const simbolo = s.acordes[i % Math.max(1, s.acordes.length)] ?? ''
      nombres.push(simbolo)
      acordes.push(parsearAcorde(simbolo))
    }
  }
  /** «41–42, 45 (41: Bm, 42: A/C#, 45: G)»: el arreglista sabe qué acorde va en cada compás señalado. */
  const conAcordes = (compases: number[]) => {
    const unicos = [...new Set(compases)].sort((a, b) => a - b)
    const muestra = unicos.slice(0, 6).map((c) => `${c}: ${nombres[c - 1] || '?'}`)
    return `${rangos(compases)} (${muestra.join(', ')}${unicos.length > 6 ? '…' : ''})`
  }
  const totalCompases = acordes.length
  const finBeats = totalCompases * num
  if (!totalCompases) return { ok: true, detalles: [] }
  const ton = parsearTonalidad(hoja.tonalidad)
  const escala = ton ? new Set((ton.menor ? MENOR : MAYOR).map((i) => pc(ton.raiz + i))) : null
  const seccionDe = (compas: number) => [...inicios].reverse().find((s) => s.compas <= compas)?.nombre ?? ''

  const detalles: string[] = []
  const pistas = ((st.project?.tracks ?? []) as unknown as Pista[])
    .map((t) => {
      const notas: Nota[] = []
      const clips = t.clips ?? []
      for (const c of clips) {
        for (const n of c.notas ?? []) {
          if (n.inicio >= c.duracion || n.inicio < 0) continue
          notas.push({ pitch: n.pitch, inicio: c.inicio + n.inicio, duracion: Math.min(n.duracion, c.duracion - n.inicio), velocidad: n.velocidad })
        }
      }
      const texto = `${t.nombre} ${(t.plugins ?? []).map((p) => p.nombre ?? '').join(' ')}`
      const bateria = /bater|drum|percus|kit/i.test(texto)
      const bajo = !bateria && /bajo|bass/i.test(texto)
      return { t, clips, notas: notas.sort((a, b) => a.inicio - b.inicio), bateria, bajo }
    })
    .filter((p) => p.notas.length > 0)

  for (const p of pistas) {
    const nombre = `«${p.t.nombre}»`
    const compasDe = (b: number) => Math.floor(b / num) + 1

    // Tiempo
    const fueraDeBarra = p.clips.filter((c) => (c.notas ?? []).length && Math.abs(c.inicio / num - Math.round(c.inicio / num)) > 1e-6)
    if (fueraDeBarra.length) detalles.push(`${nombre}: ${fueraDeBarra.length === 1 ? 'un clip empieza' : `${fueraDeBarra.length} clips empiezan`} a mitad de compás (beat ${fueraDeBarra.map((c) => c.inicio).slice(0, 4).join(', ')}); cada clip empieza en el beat de su sección.`)
    const tarde = p.notas.filter((n) => n.inicio >= finBeats - 1e-6)
    if (tarde.length) detalles.push(`${nombre}: ${tarde.length} notas suenan después del final de la canción (beat ${finBeats}, compás ${totalCompases}).`)
    const ultima = Math.max(...p.notas.map((n) => n.inicio + n.duracion))
    const inicioUltima = (inicios[inicios.length - 1]?.compas ?? 0) * num
    if (ultima <= inicioUltima + 1e-6) detalles.push(`${nombre}: deja de sonar en el compás ${compasDe(Math.max(0, ultima - 1e-6))} y la canción sigue hasta el ${totalCompases}; falta tocar ${inicios.filter((s) => s.compas * num >= ultima - 1e-6).map((s) => s.nombre).join(', ')}.`)
    else if (p.bateria || p.bajo) {
      // La base no deja compases vacíos (salvo la primera sección: la intro puede empezar sin ella).
      const huecos = huecosPorCompas(p.notas, seccionesConCompases(hoja).slice(1), num, true)
      if (huecos.length) detalles.push(`${nombre}: sin notas en los compases ${huecos.slice(0, 5).map((h) => `${h.hasta - h.desde === 1 ? h.desde + 1 : `${h.desde + 1}–${h.hasta}`} (${h.seccion})`).join(', ')}${huecos.length > 5 ? '…' : ''}; la base rítmica sostiene toda la canción.`)
    }
    const fueraRejilla = p.notas.filter((n) => !enRejilla(n.inicio))
    if (fueraRejilla.length > Math.max(2, p.notas.length * 0.15)) {
      detalles.push(`${nombre}: ${fueraRejilla.length} de ${p.notas.length} notas lejos de la rejilla (semicorcheas o tresillos, más de ${MARGEN_REJILLA} beats) en los compases ${rangos(fueraRejilla.map((n) => compasDe(n.inicio)))}; acércalas a la rejilla conservando un desvío humano pequeño.`)
    }

    // Vida: una parte en la que todas las notas duran lo mismo o pegan igual suena a máquina.
    if (p.notas.length >= MIN_NOTAS_VIDA) {
      const duraciones = new Set(p.notas.map((n) => Math.round(n.duracion * 8) / 8))
      const velocidades = p.notas.map((n) => n.velocidad).filter((v): v is number => typeof v === 'number')
      const rangoVel = velocidades.length >= MIN_NOTAS_VIDA ? Math.max(...velocidades) - Math.min(...velocidades) : null
      const quejas: string[] = []
      if (duraciones.size <= 1 && !p.bateria) quejas.push(`todas sus ${p.notas.length} notas duran lo mismo (${[...duraciones][0]} beats)`)
      if (rangoVel != null && rangoVel < 8) quejas.push(`todas pegan casi igual (velocidades entre ${Math.min(...velocidades)} y ${Math.max(...velocidades)})`)
      if (quejas.length) detalles.push(`${nombre}: suena robótica: ${quejas.join(' y ')}. Esto no se cuantiza ni se arregla nota a nota: devuélvela a su músico para que la toque con vida (duraciones variadas, síncopas, arpegios y adornos, velocidades humanas${p.bateria ? ', ghost notes y acentos' : ' y micro-tiempo'}).`)
    }

    if (p.bateria) continue
    // Armonía
    const fueraTono: number[] = []
    const fueraAcorde: number[] = []
    const bajoMal: number[] = []
    for (const n of p.notas) {
      const c = Math.floor(n.inicio / num)
      if (c >= totalCompases) continue
      const acorde = acordes[c]
      const clase = pc(n.pitch)
      // Las extensiones (9.ª y 6.ª/13.ª) cuentan como color del acorde en los instrumentos armónicos y melódicos.
      const delAcorde = acorde
        ? acorde.notas.has(clase) ||
          (!p.bajo && (clase === pc(acorde.raiz + 2) || clase === pc(acorde.raiz + 9) || (acorde.notas.has(pc(acorde.raiz + 3)) && clase === pc(acorde.raiz + 5))))
        : true
      if (escala && !escala.has(clase) && !delAcorde && n.duracion >= 0.5) fueraTono.push(c + 1)
      const tiempoFuerte = n.inicio - c * num < 0.125
      if (acorde && tiempoFuerte && n.duracion >= 1 && !delAcorde) fueraAcorde.push(c + 1)
    }
    if (p.bajo) {
      for (let c = 0; c < totalCompases; c++) {
        const acorde = acordes[c]
        if (!acorde) continue
        const enUno = p.notas.filter((n) => n.inicio >= c * num - 1e-6 && n.inicio < c * num + 0.25)
        if (!enUno.length) continue
        const grave = enUno.reduce((a, b) => (b.pitch < a.pitch ? b : a))
        if (pc(grave.pitch) !== acorde.bajo && pc(grave.pitch) !== acorde.raiz) bajoMal.push(c + 1)
      }
    }
    if (new Set(fueraTono).size >= 2) detalles.push(`${nombre}: notas largas fuera de ${hoja.tonalidad} en los compases ${conAcordes(fueraTono)}.`)
    if (new Set(fueraAcorde).size >= 2) detalles.push(`${nombre}: en el primer tiempo suenan notas que no son del acorde del compás en los compases ${conAcordes(fueraAcorde)}, en ${seccionDe(fueraAcorde[0]! - 1)}.`)
    if (bajoMal.length >= 2) detalles.push(`${nombre}: en el primer tiempo no toca la fundamental del acorde (o la nota tras «/») en los compases ${conAcordes(bajoMal)}.`)
  }

  // Ritmo: el bajo se apoya en el bombo.
  const bombos = pistas.filter((p) => p.bateria).flatMap((p) => p.notas.filter((n) => n.pitch === 35 || n.pitch === 36).map((n) => n.inicio))
  for (const b of pistas.filter((p) => p.bajo)) {
    if (bombos.length < 8) break
    const ataques = b.notas.map((n) => n.inicio)
    const juntos = bombos.filter((k) => ataques.some((a) => Math.abs(a - k) <= 0.1)).length
    if (juntos / bombos.length < 0.3) detalles.push(`«${b.t.nombre}»: solo coincide con el ${Math.round((juntos / bombos.length) * 100)} % de los golpes de bombo; el bajo debe apoyarse en el bombo (ataques juntos en los tiempos fuertes).`)
  }

  return { ok: detalles.length === 0, detalles: detalles.slice(0, MAX_DETALLES) }
}

/**
 * Diagnóstico inmediato de la pista de un músico, para el resultado de cada escritura (como los errores del
 * compilador en un IDE): qué secciones de la hoja de ruta le faltan, cuántas duraciones y velocidades distintas
 * tiene (aviso de parte «cuadrada») y los defectos de tiempo, armonía y rejilla de SU pista. Determinista y corto
 * (≤ ~700 caracteres): el modelo corrige en el mismo paso y no hacen falta rondas de QA ni de arreglista por esto.
 */
export function diagnosticoEscritura(st: ReturnType<TiendaDAW['obtenerEstado']>, hoja: HojaCoherencia, o: { pista: string; encargo: string }): string | null {
  const q = o.pista.trim().toLowerCase()
  const tracks = (st.project?.tracks ?? []) as unknown as Array<Pista & { id: string }>
  const pista = tracks.find((t) => t.id === o.pista || t.nombre.trim().toLowerCase() === q)
  if (!pista) return null
  const notas = (pista.clips ?? []).flatMap((c) => (c.notas ?? []) as Array<{ duracion: number; velocidad?: number }>)
  if (!notas.length) return null
  const falta = seccionesFaltantes(st, hoja, o)
  const duraciones = new Set(notas.map((n) => Math.round(n.duracion * 8) / 8)).size
  const vel = notas.map((n) => n.velocidad).filter((v): v is number => typeof v === 'number')
  const stats = `${notas.length} notas, ${duraciones} duraciones distintas${vel.length ? `, velocidades ${Math.min(...vel)}–${Math.max(...vel)}` : ''}`
  const solo = { ...st, project: { ...st.project, tracks: [pista] } } as unknown as typeof st
  const defectos = analizarCoherencia(solo, hoja).detalles.slice(0, 3)
  const cuadrada = duraciones <= 2 && notas.length >= 12
  // Copias exactas (plan S): compases idénticos a otro, en la pista entera y dentro de cada clip. Los pads y cuerdas
  // sostienen el mismo acorde cada vez que se repite la progresión: ahí una copia es lo esperable y no se avisa.
  const num = Math.max(1, Math.round(hoja.numerador || Number(st.project?.timeSignature?.numerador ?? 4) || 4))
  const sostenida = /pad|atmos|ambient|cuerd|string/i.test(`${pista.nombre} ${(pista.plugins ?? []).map((p) => p.nombre ?? '').join(' ')}`)
  const absolutas: Nota[] = (pista.clips ?? []).flatMap((c) => (c.notas ?? []).map((n) => ({ pitch: n.pitch, inicio: c.inicio + n.inicio, duracion: n.duracion })))
  const enPista = copiasExactas(absolutas, num)
  let copiasTxt: string | null = null
  if (!sostenida && enPista.compases >= 4 && enPista.copias / enPista.compases > UMBRAL_COPIAS) {
    copiasTxt = `${enPista.copias} de ${enPista.compases} compases son copia exacta de otro (${Math.round((enPista.copias / enPista.compases) * 100)} %): varía velocidades, adornos o reparto.`
  } else if (!sostenida) {
    for (const c of pista.clips ?? []) {
      const r = copiasExactas((c.notas ?? []).map((n) => ({ pitch: n.pitch, inicio: n.inicio, duracion: n.duracion })), num)
      if (r.compases >= 4 && r.copias / r.compases > UMBRAL_COPIAS) {
        copiasTxt = `en el clip «${c.nombre ?? 'sin nombre'}» ${r.copias} de ${r.compases} compases son copia exacta: varía velocidades, adornos o reparto.`
        break
      }
    }
  }
  // Sin defectos: una línea corta (el resultado se queda en el historial del agente hasta el final de su turno).
  if (!falta && !defectos.length && !cuadrada && !copiasTxt) return `Diagnóstico: sin defectos medidos (${stats}); todas las secciones exigidas cubiertas.`
  const lineas = [`Diagnóstico de tu pista (${stats}):`]
  if (falta) lineas.push(`faltan secciones: ${falta.replace(/^en «[^»]*» no hay notas en: /, '').replace(/\. Cada (tramo|sección) es un clip.*$/, '')}.`)
  if (cuadrada) lineas.push('parte «cuadrada»: varía duraciones y velocidades.')
  if (copiasTxt) lineas.push(copiasTxt)
  for (const d of defectos) lineas.push(d.length > 240 ? `${d.slice(0, 239)}…` : d)
  return lineas.join(' ').slice(0, 900)
}

export { MAYOR, MENOR }
