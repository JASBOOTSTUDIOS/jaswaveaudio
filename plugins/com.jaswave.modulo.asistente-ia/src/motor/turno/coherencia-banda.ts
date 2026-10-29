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
/** Margen humano respecto de la rejilla (beats): ~40 ms a 120 BPM. El micro-tiempo de un músico cabe aquí. */
const MARGEN_REJILLA = 0.08
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
      // La base no deja secciones vacías (salvo la primera: la intro puede empezar sin ella).
      const vacias = inicios.slice(1).filter((s, i) => {
        const ini = s.compas * num
        const fin = (inicios[i + 2]?.compas ?? totalCompases) * num
        return !p.notas.some((n) => n.inicio < fin && n.inicio + n.duracion > ini)
      })
      if (vacias.length) detalles.push(`${nombre}: no toca en ${vacias.map((s) => s.nombre).join(', ')}; la base rítmica sostiene toda la canción.`)
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
      const delAcorde = acorde ? acorde.notas.has(clase) || (!p.bajo && (clase === pc(acorde.raiz + 2) || clase === pc(acorde.raiz + 9))) : true
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
