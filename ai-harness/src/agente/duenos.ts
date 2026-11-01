/**
 * Dueño para cada pista (plan S). El director solo encarga las pistas que se acuerda de repartir; en una pasada real
 * las «Cuerdas» se quedaron sin músico y vacías. Tras la dirección se calculan las pistas del proyecto sin encargo y
 * cada una se asigna al músico más afín por familia de instrumento (determinista, sin modelo).
 */
import type { Encargo, ParticipanteProduccion } from './produccion'

/** Pista del proyecto (no máster ni bus) tal como la ve la producción. `notas` = cuántas notas MIDI tiene. */
export type PistaProyecto = { id: string; nombre: string; tipo?: string; notas?: number }

export type AsignacionPista = { pista: string; nombre: string; participante: string; /** Encargo nuevo (true) o añadido al encargo que ya tenía. */ nuevo: boolean }

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const igual = (a: string, b: string) => sinAcentos(a).trim() === sinAcentos(b).trim()

/** Familias de instrumento, de la más específica a la más general, con las palabras del músico que la prefieren. */
const FAMILIAS: Array<{ nombre: string; pista: RegExp; musico: RegExp[] }> = [
  { nombre: 'bateria', pista: /bater|drum|percus|kit|cajon|shaker|pandero/, musico: [/bater|drum|percus/] },
  { nombre: 'bajo', pista: /\bbajo|bass/, musico: [/bajo|bass/] },
  { nombre: 'guitarra', pista: /guitar|ukelele|banjo|acustic.*(gtr|guit)/, musico: [/guitar/] },
  { nombre: 'cuerdas', pista: /cuerd|string|violin|viola|cello|chelo|orquest|ensemble/, musico: [/cuerd|string|violin|orquest/, /pian|teclad|key/, /sint|synth|pad/] },
  { nombre: 'pad', pista: /\bpads?\b|atmos|ambient|ambiente|textur|drone|choir|coro\b|voces|vocal/, musico: [/sint|synth|pad|atmos|ambient/, /pian|teclad|key/] },
  { nombre: 'teclas', pista: /pian|teclad|key|organ|rhodes|wurli|clav/, musico: [/pian|teclad|key|organ/, /sint|synth/] },
  { nombre: 'lead', pista: /lead|solo|melod|sinte|synth|arp/, musico: [/sint|synth|lead/, /guitar/, /pian|teclad|key/] },
]

export function familiaDePista(p: PistaProyecto): string | null {
  const t = sinAcentos(`${p.nombre} ${p.tipo ?? ''}`)
  return FAMILIAS.find((f) => f.pista.test(t))?.nombre ?? null
}

/** Texto de rol del encargo de una pista huérfana. */
export function encargoDeRol(p: PistaProyecto, pedido: string): string {
  const familia = familiaDePista(p)
  const rol: Record<string, string> = {
    bateria: 'lleva el pulso: patrón de batería con variaciones, ghost notes y un fill cada 4 u 8 compases',
    bajo: 'apoya la fundamental en el tiempo fuerte y se mueve con el bombo, con notas de paso y síncopas',
    guitarra: 'acompaña con arpegios o rasgueos de acordes variados y respira entre frases',
    cuerdas: 'sostiene la armonía con notas largas y contramelodías suaves en el registro medio-agudo',
    pad: 'sostiene los acordes con notas largas y ligadas, llenando el fondo sin tapar a los demás',
    teclas: 'acompaña con acordes y arpegios de extensiones (add9, sus, maj7) y adornos',
    lead: 'canta una melodía en la tonalidad con frases y silencios',
  }
  return `Pista «${p.nombre}» (id ${p.id}): ${familia ? rol[familia] : 'toca la parte que le corresponde a este instrumento'}. Toca en TODA la canción: cada sección de la hoja de ruta con su acorde por compás (solo la intro y el outro son opcionales, salvo que el instrumento sea base rítmica), un clip por sección, sin compases vacíos y sin copiar el mismo compás una y otra vez. Pedido del usuario: «${pedido.slice(0, 200)}».`
}

/** ¿Algún encargo ya es dueño de esta pista (por su campo `pista` o porque su texto la nombra con id o entre comillas)? */
function tieneDueno(p: PistaProyecto, encargos: Encargo[], resolver?: (ref: string) => { id: string; nombre: string } | null): boolean {
  return encargos.some((e) => {
    if (e.pista) {
      const r = resolver?.(e.pista) ?? { id: e.pista, nombre: e.pista }
      if (r.id === p.id || igual(e.pista, p.id) || igual(r.nombre, p.nombre)) return true
    }
    const t = sinAcentos(e.encargo)
    if (p.id.length >= 3 && t.includes(sinAcentos(p.id))) return true
    const n = sinAcentos(p.nombre).trim()
    return n.length >= 3 && [`«${n}»`, `"${n}"`, `'${n}'`, `“${n}”`].some((q) => t.includes(q))
  })
}

/** Pistas de instrumento sin encargo, en el orden del proyecto. */
export function pistasHuerfanas(pistas: PistaProyecto[], encargos: Encargo[], resolver?: (ref: string) => { id: string; nombre: string } | null): PistaProyecto[] {
  return pistas.filter((p) => !tieneDueno(p, encargos, resolver))
}

/** El músico más afín a la pista; sin afinidad, el que tiene menos pistas. */
export function elegirDueno(p: PistaProyecto, musicos: ParticipanteProduccion[], carga: Map<string, number>): ParticipanteProduccion | null {
  if (!musicos.length) return null
  const familia = FAMILIAS.find((f) => f.nombre === familiaDePista(p))
  const texto = (m: ParticipanteProduccion) => sinAcentos(`${m.id} ${m.nombre} ${m.descripcion}`)
  if (familia) {
    for (const re of familia.musico) {
      const candidatos = musicos.filter((m) => re.test(texto(m)))
      if (candidatos.length) return candidatos.reduce((a, b) => ((carga.get(b.id) ?? 0) < (carga.get(a.id) ?? 0) ? b : a))
    }
  }
  return musicos.reduce((a, b) => ((carga.get(b.id) ?? 0) < (carga.get(a.id) ?? 0) ? b : a))
}

/**
 * Asigna cada pista huérfana. Si el músico elegido aún no tiene encargo, recibe uno nuevo con esa pista; si ya lo
 * tiene (un músico solo puede tener una pista «principal»), el encargo se amplía con el texto de la pista extra y
 * esta se anota en `pistasExtra` (también escribe en ella y se mide su completitud).
 */
export function asignarPistasHuerfanas(
  encargos: Encargo[],
  musicos: ParticipanteProduccion[],
  pistas: PistaProyecto[],
  pedido: string,
  resolver?: (ref: string) => { id: string; nombre: string } | null,
): { encargos: Encargo[]; asignaciones: AsignacionPista[] } {
  const huerfanas = pistasHuerfanas(pistas, encargos, resolver)
  if (!huerfanas.length || !musicos.length) return { encargos, asignaciones: [] }
  const salida = encargos.map((e) => ({ ...e, ...(e.pistasExtra ? { pistasExtra: [...e.pistasExtra] } : {}) }))
  const carga = new Map<string, number>()
  for (const e of salida) carga.set(e.participante, (carga.get(e.participante) ?? 0) + 1 + (e.pistasExtra?.length ?? 0))
  const asignaciones: AsignacionPista[] = []
  for (const p of huerfanas) {
    const m = elegirDueno(p, musicos, carga)
    if (!m) continue
    const texto = encargoDeRol(p, pedido)
    const previo = salida.find((e) => e.participante === m.id)
    if (previo) {
      previo.encargoBase ??= previo.encargo
      previo.textosExtra = { ...(previo.textosExtra ?? {}), [p.id]: texto }
      previo.encargo = `${previo.encargo}\n\nAdemás llevas otra pista: ${texto}`
      if (previo.pista) previo.pistasExtra = [...(previo.pistasExtra ?? []), p.id]
      else previo.pista = p.id
    } else salida.push({ participante: m.id, encargo: texto, pista: p.id })
    carga.set(m.id, (carga.get(m.id) ?? 0) + 1)
    asignaciones.push({ pista: p.id, nombre: p.nombre, participante: m.id, nuevo: !previo })
  }
  return { encargos: salida, asignaciones }
}

/**
 * Un encargo con pistas extra se reparte en un turno por pista: el principal conserva su texto original y cada extra
 * es un encargo propio del mismo músico con su pista. Así ninguna pista depende de que la anterior termine a tiempo.
 */
export function separarPistasExtra(encargos: Encargo[]): Encargo[] {
  const salida: Encargo[] = []
  for (const e of encargos) {
    if (!e.pistasExtra?.length) {
      salida.push(e)
      continue
    }
    const { pistasExtra, encargoBase, textosExtra, ...resto } = e
    salida.push({ ...resto, encargo: encargoBase ?? e.encargo })
    for (const p of pistasExtra) {
      salida.push({
        participante: e.participante,
        encargo: textosExtra?.[p] ?? `Graba también la pista ${p}: toca la parte que le corresponde a este instrumento en toda la canción.`,
        pista: p,
      })
    }
  }
  return salida
}
