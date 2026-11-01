/**
 * Menciones «@agente» del chat: lógica pura (sin React) para que se pueda probar.
 *
 * En el compositor una mención es una pastilla (chip) y no texto; al enviar se serializa como `@"Nombre"`
 * (forma sin ambigüedad con espacios) y en el historial se vuelve a ver como pastilla, nunca como `@id`.
 */

export type AgenteMencionable = {
  id: string
  nombre: string
  rol?: string
  instrumento?: string
  color?: string
}

/** Una mención elegida en el compositor, pendiente de enviarse. */
export type ChipMencion = {
  /** Id del elemento del menú (`agent:bajista`, `track:t1`…). */
  id: string
  kind: string
  /** Nombre completo tal como se resuelve contra el proyecto. */
  etiqueta: string
  /** Si es un agente, su id (para dirigirle la indicación). */
  agenteId?: string
  color?: string
}

export type SegmentoMencion = {
  etiqueta: string
  /** Nombre corto para mostrar («Pianista» y no «Pianista / Teclista»). */
  visible: string
  agente?: AgenteMencionable
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** «Pianista / Teclista» → «Pianista»; «QA / Auditor de Calidad Musical» → «QA». */
export function nombreCorto(nombre: string): string {
  const primero = nombre.split(/\s+\/\s+/)[0]?.trim()
  return primero || nombre.trim()
}

/** Texto con el que la mención viaja en el mensaje. */
export function tokenMencion(etiqueta: string): string {
  return `@"${etiqueta.replace(/"/g, "'")}"`
}

/** Une etiqueta de modo, menciones y texto en el mensaje tal como lo recibe el motor. */
export function componerMensaje(comandoToken: string | undefined, chips: ChipMencion[], texto: string): string {
  return [comandoToken ?? '', ...chips.map((c) => tokenMencion(c.etiqueta)), texto].filter((p) => p.trim()).join(' ')
}

/** ¿Este nombre/token (sin @) corresponde a un agente? Por nombre completo, corto o id. */
export function buscarAgente(nombre: string, agentes: AgenteMencionable[]): AgenteMencionable | undefined {
  const n = norm(nombre)
  if (!n) return undefined
  return (
    agentes.find((a) => norm(a.nombre) === n) ??
    agentes.find((a) => a.id.toLowerCase() === n) ??
    agentes.find((a) => norm(nombreCorto(a.nombre)) === n)
  )
}

const FIN_PALABRA = /[\s,.;:!?)\]]/

/**
 * Localiza las menciones del texto y devuelve el texto «limpio»: las menciones al comienzo se quitan
 * (se muestran como pastillas aparte) y las del medio quedan como el nombre en claro, sin «@».
 * Reconoce `@"Nombre"`, `@«Nombre»` y `@Nombre` solo si es un agente conocido. `@msg:…` no se toca.
 */
export function separarMenciones(
  texto: string,
  agentes: AgenteMencionable[],
): { menciones: SegmentoMencion[]; texto: string } {
  const menciones: SegmentoMencion[] = []
  const vistas = new Set<string>()
  const porLargo = [...agentes].sort((a, b) => b.nombre.length - a.nombre.length)
  let limpio = ''
  let i = 0
  /** Solo hay menciones (y espacios) antes de esta posición. */
  let alInicio = true

  const anotar = (etiqueta: string, agente?: AgenteMencionable): SegmentoMencion => {
    const seg: SegmentoMencion = { etiqueta, visible: agente ? nombreCorto(agente.nombre) : etiqueta, ...(agente ? { agente } : {}) }
    const clave = norm(etiqueta)
    if (!vistas.has(clave)) {
      vistas.add(clave)
      menciones.push(seg)
    }
    return seg
  }

  while (i < texto.length) {
    const c = texto[i]!
    if (c !== '@' || (i > 0 && !/\s/.test(texto[i - 1]!))) {
      if (!/\s/.test(c)) alInicio = false
      limpio += c
      i++
      continue
    }
    const resto = texto.slice(i + 1)
    let consumido = 0
    let etiqueta = ''
    const entrecomillada = /^(?:"([^"\n]{1,80})"|«([^»\n]{1,80})»)/.exec(resto)
    if (entrecomillada) {
      consumido = entrecomillada[0].length
      etiqueta = (entrecomillada[1] ?? entrecomillada[2] ?? '').trim()
    } else if (!resto.startsWith('msg:')) {
      const hit = porLargo.find((a) => {
        for (const cand of [a.nombre, nombreCorto(a.nombre), a.id]) {
          if (norm(resto.slice(0, cand.length)) === norm(cand) && (resto.length === cand.length || FIN_PALABRA.test(resto[cand.length]!))) {
            consumido = cand.length
            etiqueta = a.nombre
            return true
          }
        }
        return false
      })
      if (!hit) {
        alInicio = false
        limpio += c
        i++
        continue
      }
    } else {
      alInicio = false
      limpio += c
      i++
      continue
    }
    const agente = buscarAgente(etiqueta, agentes)
    const seg = anotar(agente ? agente.nombre : etiqueta, agente)
    if (!alInicio) limpio += seg.visible
    i += 1 + consumido
    // Los espacios que seguían a una mención inicial se pierden con ella.
    if (alInicio) while (i < texto.length && /[ \t]/.test(texto[i]!)) i++
  }
  return { menciones, texto: limpio.replace(/[ \t]{2,}/g, ' ').trim() }
}

export type ParticipanteLike = { id: string; nombre: string }

/**
 * A quién de la producción en curso va una indicación con menciones. `para` son ids de participantes;
 * `ausentes` los agentes mencionados que no forman parte de la producción (para avisar al usuario).
 */
export function destinosDeMenciones(
  texto: string,
  agentes: AgenteMencionable[],
  participantes: ParticipanteLike[],
): { texto: string; para: Array<{ id: string; nombre: string }>; ausentes: string[] } {
  const { menciones, texto: limpio } = separarMenciones(texto, agentes)
  const para: Array<{ id: string; nombre: string }> = []
  const ausentes: string[] = []
  for (const m of menciones) {
    if (!m.agente) continue
    const p = participantes.find((x) => x.id === m.agente!.id) ?? participantes.find((x) => norm(x.nombre) === norm(m.agente!.nombre))
    if (p) {
      if (!para.some((x) => x.id === p.id)) para.push({ id: p.id, nombre: p.nombre })
    } else ausentes.push(m.visible)
  }
  return { texto: limpio, para, ausentes }
}

/** Frase para el chat: «Se lo paso a Bajista y Pianista…». */
export function listaNatural(nombres: string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? ''
  return `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}`
}

/** Agentes a mostrar en el menú «@»: los de la producción en curso si la hay; si no, los activos. */
export function agentesParaMenu(
  especialistas: Array<{ id: string; nombre: string; role?: string; instrumento?: string; color?: string; activo?: boolean }>,
  participantes: Array<{ id: string; nombre: string; rol?: string; color?: string }>,
): AgenteMencionable[] {
  if (participantes.length) {
    return participantes
      .filter((p) => p.id !== 'usuario')
      .map((p) => {
        const e = especialistas.find((x) => x.id === p.id)
        return { id: p.id, nombre: p.nombre, rol: p.rol ?? e?.role, instrumento: e?.instrumento, color: p.color ?? e?.color }
      })
  }
  return especialistas
    .filter((e) => e.activo !== false)
    .map((e) => ({ id: e.id, nombre: e.nombre, rol: e.role, instrumento: e.instrumento, color: e.color }))
}

const ROL_LEGIBLE: Record<string, string> = {
  planificador: 'Planificación',
  director: 'Dirección',
  musico: 'Músico',
  mezcla: 'Mezcla',
  mastering: 'Máster',
  qa: 'Calidad',
}

/** Descripción corta del agente para el menú: «Músico · Bajo». */
export function descripcionAgente(a: AgenteMencionable): string {
  const rol = a.rol ? (ROL_LEGIBLE[a.rol] ?? a.rol) : ''
  return [rol, a.instrumento].filter(Boolean).join(' · ') || 'Agente de la banda'
}
