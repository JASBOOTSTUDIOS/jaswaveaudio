/**
 * Coordinación vertical determinista de la banda (plan S). Cada pista respeta el acorde y la tonalidad por separado
 * (`armonia-banda.ts`), pero juntas pueden rozar: en una pasada real el 32 % de los tiempos tenían una segunda menor
 * entre pistas distintas (piano do♯ contra pad re sobre A/C#), el pad seguía sosteniendo la nota del acorde anterior
 * y el bajo tocaba sol♯ sobre A/C#. Esta función pura, sin modelo, lo resuelve al terminar los músicos:
 *
 *  1. Bajo: en el primer tiempo toca el bajo de la barra (la nota tras «/», o la fundamental); las notas de 0,5 beat o
 *     más fuera de acorde y tonalidad pasan a la nota del acorde más cercana (las cromáticas solo como paso < 0,5).
 *  2. Pad y cuerdas siguen al acorde: una nota que no es del acorde de su compás pasa a la nota del acorde más cercana;
 *     una nota sostenida que cruza a un compás cuyo acorde no la contiene se corta en el cambio (más el solape legato).
 *  3. Tiempo fuerte y notas largas de los instrumentos armónicos: del acorde (más 9.ª y 6.ª como color), como en la guardia.
 *  4. Choques entre pistas distintas (segunda menor o séptima mayor, ≥ E2) en ventanas de 1 beat: la nota de menor prioridad
 *     (lead > piano > guitarra > cuerdas > pad) cambia de octava o de nota del acorde sin crear otro choque; si no hay
 *     alternativa se acorta o se quita. Bajo y batería no se tocan (salvo el paso 1).
 *  5. Registro: el pad por debajo del piano y la guitarra cuando se puede, y dos pistas no duplican la misma nota a la vez.
 *
 * Solo mueve alturas a notas del acorde (o color) y recorta o quita: nunca añade notas ni introduce alturas fuera de
 * acorde/escala. No muta la entrada y es reproducible.
 */
import type { FamiliaBanda } from './humanizar-banda'

export interface NotaVertical {
  pitch: number
  /** Beats desde el inicio de la canción. */
  inicio: number
  duracion: number
  velocidad?: number
}

export interface AcordeVertical {
  /** Clases de nota (0–11) del acorde, incluido el bajo. */
  notas: ReadonlySet<number> | readonly number[]
  raiz: number
  bajo: number
}

export interface PistaVertical<T extends NotaVertical = NotaVertical> {
  id: string
  familia: FamiliaBanda
  notas: readonly T[]
}

export interface OpcionesCoordinarVoces {
  /** Acorde de cada compás (índice absoluto, 0-based); null = desconocido. */
  acordes: ReadonlyArray<AcordeVertical | null>
  /** Clases de la tonalidad. */
  escala?: ReadonlySet<number> | null
  numerador?: number
  bpm: number
}

export interface NotaCoordinada<T extends NotaVertical = NotaVertical> {
  nota: T
  /** Índice en la lista de entrada de la pista. */
  origen: number
  cambiada: boolean
}

export interface ResumenCoordinarVoces {
  /** Tiempos con choque antes y después, y tiempos medidos (con ≥ 2 pistas afinadas sonando). */
  choquesAntes: number
  choquesDespues: number
  tiemposMedidos: number
  porcentajeAntes: number
  porcentajeDespues: number
  movidas: number
  cortadas: number
  quitadas: number
  bajoCorregido: number
  padSeguido: number
}

const MIN_CHOQUE = 40 // E2
const EPS = 1e-6
const SOLAPE_MIN = 0.25
const PRIORIDAD: Record<FamiliaBanda, number> = { lead: 5, piano: 4, guitarra: 3, otro: 3, cuerdas: 2, pad: 1, bajo: 0, bateria: 0 }
const pc = (n: number) => ((n % 12) + 12) % 12

const esAfinada = (f: FamiliaBanda) => f !== 'bateria' && f !== 'bajo'

function clasesDe(a: AcordeVertical): Set<number> {
  return new Set([...a.notas, a.bajo, a.raiz].map(pc))
}
/** Acorde + color (9.ª, 6.ª y 11.ª en menores): lo permitido en tiempo fuerte y notas largas. */
function clasesConColor(a: AcordeVertical): Set<number> {
  const s = clasesDe(a)
  const menor = s.has(pc(a.raiz + 3))
  for (const x of [a.raiz + 2, a.raiz + 9, ...(menor ? [a.raiz + 5] : [])]) s.add(pc(x))
  return s
}

const esChoque = (a: number, b: number) => {
  const d = Math.abs(a - b)
  return a >= MIN_CHOQUE && b >= MIN_CHOQUE && (d === 1 || d === 11)
}

type Viva<T extends NotaVertical> = { nota: T; origen: number; pista: number; cambiada: boolean; quitada: boolean }

const solapa = (a: { inicio: number; duracion: number }, b: { inicio: number; duracion: number }) => Math.min(a.inicio + a.duracion, b.inicio + b.duracion) - Math.max(a.inicio, b.inicio)

/** Tiempos (ventanas de 1 beat) con algún choque entre pistas afinadas distintas, y cuántos tiempos se midieron. */
export function medirChoques(pistas: ReadonlyArray<{ id: string; familia: FamiliaBanda; notas: readonly NotaVertical[] }>, hastaBeat?: number): { choques: number; tiempos: number } {
  const afinadas = pistas.map((p, i) => ({ i, p })).filter((x) => esAfinada(x.p.familia))
  let fin = hastaBeat ?? 0
  if (hastaBeat == null) for (const { p } of afinadas) for (const n of p.notas) fin = Math.max(fin, n.inicio + n.duracion)
  let choques = 0
  let tiempos = 0
  for (let t = 0; t < fin - EPS; t++) {
    const sonando: Array<{ i: number; pitch: number }> = []
    for (const { i, p } of afinadas) for (const n of p.notas) if (n.inicio < t + 1 - EPS && n.inicio + n.duracion > t + EPS && Math.min(n.inicio + n.duracion, t + 1) - Math.max(n.inicio, t) >= SOLAPE_MIN) sonando.push({ i, pitch: n.pitch })
    if (new Set(sonando.map((s) => s.i)).size < 2) continue
    tiempos++
    if (sonando.some((a, x) => sonando.some((b, y) => y > x && a.i !== b.i && esChoque(a.pitch, b.pitch)))) choques++
  }
  return { choques, tiempos }
}

export function coordinarVoces<T extends NotaVertical>(pistas: ReadonlyArray<PistaVertical<T>>, o: OpcionesCoordinarVoces): { pistas: Array<{ id: string; notas: Array<NotaCoordinada<T>>; quitadas: number[] }>; resumen: ResumenCoordinarVoces } {
  const num = Math.max(1, Math.round(o.numerador ?? 4))
  const escala = o.escala ?? null
  const solapePadBeats = (1000 * o.bpm) / 60000
  const solapeBeats = (500 * o.bpm) / 60000
  const vivas: Viva<T>[][] = pistas.map((p, pista) => p.notas.map((n, origen) => ({ nota: { ...n }, origen, pista, cambiada: false, quitada: false })))
  const antes = medirChoques(pistas.map((p) => ({ id: p.id, familia: p.familia, notas: p.notas })))
  const r: ResumenCoordinarVoces = { choquesAntes: antes.choques, choquesDespues: 0, tiemposMedidos: antes.tiempos, porcentajeAntes: 0, porcentajeDespues: 0, movidas: 0, cortadas: 0, quitadas: 0, bajoCorregido: 0, padSeguido: 0 }

  const acordeEn = (beat: number) => o.acordes[Math.floor(beat / num + 1e-9)] ?? null
  const setPitch = (v: Viva<T>, p: number) => {
    if (p === v.nota.pitch) return
    v.nota = { ...v.nota, pitch: p }
    v.cambiada = true
    r.movidas++
  }
  /** Nota con clase en `clases` más cercana a `p` (empate: el bajo de la barra primero, luego la más grave). */
  const cercana = (p: number, clases: Set<number>, preferida?: number): number => {
    let mejor = p
    let dist = 99
    for (let d = 0; d <= 11; d++) {
      for (const q of [p - d, p + d]) {
        if (q < 0 || q > 127 || !clases.has(pc(q))) continue
        const mejora = d < dist || (d === dist && preferida != null && pc(q) === preferida && pc(mejor) !== preferida)
        if (mejora) {
          mejor = q
          dist = d
        }
      }
      if (dist <= d && d > dist) break
    }
    return mejor
  }

  // 1) Bajo.
  pistas.forEach((p, i) => {
    if (p.familia !== 'bajo') return
    for (const v of vivas[i]!) {
      const a = acordeEn(v.nota.inicio)
      if (!a) continue
      const off = v.nota.inicio - Math.floor(v.nota.inicio / num + 1e-9) * num
      const antesP = v.nota.pitch
      if (off < 0.25) {
        if (pc(antesP) !== pc(a.bajo)) setPitch(v, cercana(antesP, new Set([pc(a.bajo)])))
      } else if (v.nota.duracion >= 0.5 - EPS) {
        const ok = clasesDe(a)
        if (!ok.has(pc(antesP)) && !(escala && escala.has(pc(antesP)))) setPitch(v, cercana(antesP, ok, pc(a.bajo)))
      }
      if (v.nota.pitch !== antesP) r.bajoCorregido++
    }
  })

  // 2) Pad y cuerdas siguen al acorde.
  pistas.forEach((p, i) => {
    if (p.familia !== 'pad' && p.familia !== 'cuerdas') return
    const solape = p.familia === 'pad' ? solapePadBeats : solapeBeats
    for (const v of vivas[i]!) {
      const a = acordeEn(v.nota.inicio)
      if (a && !clasesConColor(a).has(pc(v.nota.pitch))) {
        setPitch(v, cercana(v.nota.pitch, clasesDe(a)))
        r.padSeguido++
      }
      const fin = v.nota.inicio + v.nota.duracion
      for (let b = Math.floor(v.nota.inicio / num + 1e-9) + 1; b * num < fin - EPS; b++) {
        const nuevo = o.acordes[b]
        if (!nuevo || clasesConColor(nuevo).has(pc(v.nota.pitch))) continue
        // Se corta en el cambio de acorde, dejando solo el solape de legato permitido.
        const dur = Math.max(1 / 16, b * num + Math.min(solape, 0.99 * num) - v.nota.inicio)
        if (dur < v.nota.duracion - EPS) {
          v.nota = { ...v.nota, duracion: dur }
          v.cambiada = true
          r.cortadas++
          r.padSeguido++
        }
        break
      }
    }
  })

  // 3) Tiempo fuerte y notas largas armónicas: del acorde (o color).
  pistas.forEach((p, i) => {
    if (!esAfinada(p.familia) || p.familia === 'pad' || p.familia === 'cuerdas') return
    for (const v of vivas[i]!) {
      const a = acordeEn(v.nota.inicio)
      if (!a) continue
      const off = v.nota.inicio - Math.floor(v.nota.inicio / num + 1e-9) * num
      if ((off < 0.125 || v.nota.duracion >= 1) && !clasesConColor(a).has(pc(v.nota.pitch))) setPitch(v, cercana(v.nota.pitch, clasesDe(a)))
    }
  })

  // Índice por compás para buscar rápido lo que suena a la vez.
  const porCompas = new Map<number, Viva<T>[]>()
  const indexar = () => {
    porCompas.clear()
    for (const lista of vivas)
      for (const v of lista) {
        if (v.quitada || !esAfinada(pistas[v.pista]!.familia)) continue
        for (let b = Math.floor(v.nota.inicio / num + 1e-9); b * num < v.nota.inicio + v.nota.duracion - EPS; b++) porCompas.set(b, [...(porCompas.get(b) ?? []), v])
      }
  }
  indexar()
  const vecinas = (v: Viva<T>, nota: T): Viva<T>[] => {
    const out = new Set<Viva<T>>()
    for (let b = Math.floor(nota.inicio / num + 1e-9); b * num < nota.inicio + nota.duracion - EPS; b++) for (const w of porCompas.get(b) ?? []) if (w !== v && !w.quitada && w.pista !== v.pista && solapa(w.nota, nota) >= SOLAPE_MIN) out.add(w)
    return [...out]
  }
  const chocaCon = (v: Viva<T>, nota: T) => vecinas(v, nota).filter((w) => esChoque(w.nota.pitch, nota.pitch))
  const prioridad = (v: Viva<T>) => PRIORIDAD[pistas[v.pista]!.familia]

  /** Alturas alternativas del acorde (o color) para una nota: primero las mismas notas en otra octava, luego la nota más cercana. */
  const candidatas = (v: Viva<T>): number[] => {
    const a = acordeEn(v.nota.inicio)
    const clases = a ? clasesConColor(a) : new Set([pc(v.nota.pitch)])
    const p0 = v.nota.pitch
    const lista: number[] = []
    for (const d of [12, -12, 24, -24]) lista.push(p0 + d)
    const resto: number[] = []
    for (let d = 1; d <= 7; d++) for (const q of [p0 - d, p0 + d]) if (clases.has(pc(q))) resto.push(q)
    return [...lista.filter((q) => clases.has(pc(q))), ...resto].filter((q) => q >= MIN_CHOQUE && q <= 108)
  }

  // 4) Choques: la nota de menor prioridad se mueve, se acorta o se quita.
  const resolver = (v: Viva<T>, otras: Viva<T>[]) => {
    for (const q of candidatas(v)) {
      const probe = { ...v.nota, pitch: q }
      if (!chocaCon(v, probe).length) {
        setPitch(v, q)
        indexar()
        return
      }
    }
    // Sin alternativa: se acorta hasta donde empieza la otra, o se quita.
    const o2 = otras.reduce((a, b) => (b.nota.inicio < a.nota.inicio ? b : a))
    const corte = o2.nota.inicio - v.nota.inicio
    if (corte >= 0.25) {
      v.nota = { ...v.nota, duracion: corte }
      v.cambiada = true
      r.cortadas++
    } else {
      v.quitada = true
      v.cambiada = true
      r.quitadas++
    }
    indexar()
  }
  const orden = vivas.flat().filter((v) => esAfinada(pistas[v.pista]!.familia)).sort((a, b) => prioridad(a) - prioridad(b) || a.nota.inicio - b.nota.inicio)
  for (let pasada = 0; pasada < 2; pasada++) {
    for (const v of orden) {
      if (v.quitada) continue
      const malas = chocaCon(v, v.nota).filter((w) => prioridad(w) > prioridad(v))
      if (malas.length) resolver(v, malas)
    }
  }

  // 5) Registro: el pad por debajo del piano y la guitarra; nadie duplica la misma nota a la vez.
  for (const v of orden) {
    if (v.quitada) continue
    const fam = pistas[v.pista]!.familia
    if (fam === 'pad') {
      const arriba = vecinas(v, v.nota).filter((w) => (pistas[w.pista]!.familia === 'piano' || pistas[w.pista]!.familia === 'guitarra') && w.nota.pitch < v.nota.pitch)
      const q = v.nota.pitch - 12
      if (arriba.length && q >= 48 && !chocaCon(v, { ...v.nota, pitch: q }).length) {
        setPitch(v, q)
        indexar()
      }
    }
    const dup = vecinas(v, v.nota).filter((w) => w.nota.pitch === v.nota.pitch && Math.abs(w.nota.inicio - v.nota.inicio) < 0.125 && prioridad(w) > prioridad(v))
    if (dup.length) {
      const alt = [12, -12].map((d) => v.nota.pitch + d).find((q) => q >= MIN_CHOQUE && q <= 108 && !vecinas(v, { ...v.nota, pitch: q }).some((w) => w.nota.pitch === q) && !chocaCon(v, { ...v.nota, pitch: q }).length)
      if (alt != null) setPitch(v, alt)
      else {
        v.quitada = true
        v.cambiada = true
        r.quitadas++
      }
      indexar()
    }
  }

  const salida = pistas.map((p, i) => ({
    id: p.id,
    notas: vivas[i]!.filter((v) => !v.quitada).map((v) => ({ nota: v.nota, origen: v.origen, cambiada: v.cambiada })),
    quitadas: vivas[i]!.filter((v) => v.quitada).map((v) => v.origen),
  }))
  const despues = medirChoques(pistas.map((p, i) => ({ id: p.id, familia: p.familia, notas: salida[i]!.notas.map((x) => x.nota) })))
  r.choquesDespues = despues.choques
  r.porcentajeAntes = antes.tiempos ? Math.round((antes.choques / antes.tiempos) * 1000) / 10 : 0
  r.porcentajeDespues = despues.tiempos ? Math.round((despues.choques / despues.tiempos) * 1000) / 10 : 0
  return { pistas: salida, resumen: r }
}
