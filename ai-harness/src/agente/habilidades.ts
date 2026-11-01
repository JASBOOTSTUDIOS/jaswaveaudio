/**
 * Habilidades de los agentes (skills): conocimiento de oficio empaquetado que cada agente carga solo cuando lo
 * necesita, igual que un ingeniero consulta su chuleta antes de una tarea concreta.
 *
 * Una habilidad es un documento corto (Markdown): nombre, cuándo usarla y el método paso a paso con las
 * herramientas reales del DAW. El agente ve en su sistema la lista (nombre + cuándo) y lee el contenido
 * completo con `leer_habilidad` solo si el encargo encaja: así el prompt no crece con lo que no aplica
 * (revelación progresiva) y cada rol —baterista, bajista, mezcla, máster…— trabaja con método propio.
 *
 * Hay habilidades de serie (por rol e instrumento) y habilidades del usuario (archivos en su carpeta de
 * configuración, asignadas a un agente). Las del usuario mandan si repiten id.
 */
import type { HerramientaAgente, LlamadaAgente, ResultadoHerramienta } from './tipos'

export type HabilidadAgente = {
  /** Único dentro del agente (p. ej. `bateria-groove`). */
  id: string
  nombre: string
  /** Cuándo usarla: es lo que el agente lee para decidir si la abre. */
  descripcion: string
  /** Instrucciones completas (método, herramientas, comprobación). */
  contenido: string
  origen?: 'base' | 'usuario'
}

export const H_LEER_HABILIDAD = 'leer_habilidad'
/** Habilidades que se listan en el sistema (las demás siguen disponibles por nombre). */
const MAX_LISTADAS = 24
const MAX_CONTENIDO = 12_000

const normal = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

export function slugHabilidad(nombre: string): string {
  return normal(nombre)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/**
 * Lee una habilidad en Markdown. Acepta dos cabeceras:
 *   `# Nombre` + `> cuándo usarla`   (formato de la carpeta del asistente)
 *   `---` nombre/name, descripcion/description `---` (frontmatter)
 * El resto es el contenido. Devuelve null si no hay nombre ni contenido.
 */
export function habilidadDesdeMarkdown(texto: string, o: { id?: string; nombrePorDefecto?: string; origen?: HabilidadAgente['origen'] } = {}): HabilidadAgente | null {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n')
  let nombre = ''
  let descripcion = ''
  let i = 0
  if (lineas[0]?.trim() === '---') {
    for (i = 1; i < lineas.length && lineas[i]!.trim() !== '---'; i++) {
      const m = /^\s*([\w-]+)\s*:\s*(.*)$/.exec(lineas[i]!)
      if (!m) continue
      const clave = m[1]!.toLowerCase()
      const valor = m[2]!.trim().replace(/^["']|["']$/g, '')
      if (clave === 'nombre' || clave === 'name') nombre = valor
      else if (clave === 'descripcion' || clave === 'descripción' || clave === 'description' || clave === 'cuando') descripcion = valor
    }
    i = Math.min(lineas.length, i + 1)
  }
  const cuerpo: string[] = []
  let cabecera = true
  for (; i < lineas.length; i++) {
    const l = lineas[i]!
    if (cabecera && !nombre && /^#\s+/.test(l)) nombre = l.replace(/^#\s+/, '').trim()
    else if (cabecera && !descripcion && /^>\s*/.test(l)) descripcion = l.replace(/^>\s*/, '').trim()
    else if (cabecera && /^<!--.*-->$/.test(l.trim())) continue
    else if (cabecera && !l.trim()) continue
    else {
      cabecera = false
      cuerpo.push(l)
    }
  }
  nombre = (nombre || o.nombrePorDefecto || '').trim().slice(0, 80)
  const contenido = cuerpo.join('\n').trim().slice(0, MAX_CONTENIDO)
  if (!nombre || !contenido) return null
  return { id: o.id || slugHabilidad(nombre), nombre, descripcion: descripcion.slice(0, 300), contenido, ...(o.origen ? { origen: o.origen } : {}) }
}

/** Une listas sin repetir id: la última que aparece gana (las del usuario van después de las de serie). */
export function unirHabilidades(...listas: Array<readonly HabilidadAgente[] | undefined>): HabilidadAgente[] {
  const porId = new Map<string, HabilidadAgente>()
  for (const lista of listas) for (const h of lista ?? []) porId.set(h.id, h)
  return [...porId.values()]
}

export function buscarHabilidad(habilidades: readonly HabilidadAgente[], nombre: string): HabilidadAgente | undefined {
  const q = normal(nombre)
  if (!q) return undefined
  return (
    habilidades.find((h) => normal(h.nombre) === q || h.id === q || slugHabilidad(h.nombre) === slugHabilidad(nombre)) ??
    habilidades.find((h) => normal(h.nombre).includes(q) || q.includes(normal(h.nombre))) ??
    porPalabras(habilidades, q)
  )
}

/**
 * Último recurso: el modelo escribe el nombre con un carácter corrupto («Groove de bater໚») o abreviado. Se comparan
 * las palabras (≥ 4 letras, por sus 5 primeras letras); gana la habilidad que más palabras comparte, si es única.
 */
function porPalabras(habilidades: readonly HabilidadAgente[], q: string): HabilidadAgente | undefined {
  const raiz = (t: string) => t.slice(0, 5)
  const palabras = (t: string) => t.split(/[^a-z0-9]+/).filter((w) => w.length >= 4).map(raiz)
  const buscadas = new Set(palabras(q))
  if (!buscadas.size) return undefined
  // Parecido (Jaccard) con el NOMBRE de la habilidad; el id solo desempata cuando el nombre no comparte nada. Antes
  // «Groove de bater?» empataba con «Biblioteca de grooves» porque su id («bateria-biblioteca-de-grooves») también
  // contiene esas palabras.
  const mejorPor = (propias: (h: HabilidadAgente) => Set<string>): HabilidadAgente | undefined => {
    let mejor: HabilidadAgente | undefined
    let puntos = 0
    let empate = false
    for (const h of habilidades) {
      const p = propias(h)
      const comunes = [...buscadas].filter((w) => p.has(w)).length
      const jaccard = comunes / (buscadas.size + p.size - comunes)
      if (jaccard > puntos) [mejor, puntos, empate] = [h, jaccard, false]
      else if (jaccard === puntos && jaccard > 0) empate = true
    }
    return puntos > 0 && !empate ? mejor : undefined
  }
  return mejorPor((h) => new Set(palabras(normal(h.nombre)))) ?? mejorPor((h) => new Set(palabras(h.id)))
}

/** Bloque para el sistema del agente: qué sabe hacer y cómo abrirlo. */
export function listadoHabilidades(habilidades: readonly HabilidadAgente[]): string {
  if (!habilidades.length) return ''
  return [
    'Tus habilidades (conocimiento de oficio). Antes de actuar, lee con `leer_habilidad` la que encaje con tu encargo y sigue su método; no leas las que no apliquen:',
    ...habilidades.slice(0, MAX_LISTADAS).map((h) => `- ${h.nombre}: ${h.descripcion || 'sin descripción'}`),
  ].join('\n')
}

export function herramientaLeerHabilidad(habilidades: readonly HabilidadAgente[]): HerramientaAgente {
  return {
    nombre: H_LEER_HABILIDAD,
    descripcion: 'Lee las instrucciones completas de una de tus habilidades (por su nombre). Hazlo antes de la tarea a la que aplica y sigue sus pasos.',
    parametros: {
      type: 'object',
      properties: { nombre: { type: 'string', enum: habilidades.slice(0, 40).map((h) => h.nombre) } },
      required: ['nombre'],
    },
    clase: 'lectura',
    titulo: 'Consultando una habilidad',
    etiquetas: ['habilidad', 'skill', 'metodo', 'instrucciones'],
  }
}

export function ejecutarLeerHabilidad(l: LlamadaAgente, habilidades: readonly HabilidadAgente[]): ResultadoHerramienta {
  const nombre = String(l.argumentos.nombre ?? '').trim()
  const h = buscarHabilidad(habilidades, nombre)
  if (!h) return { ok: false, error: `No tienes ninguna habilidad «${nombre}». Disponibles: ${habilidades.map((x) => x.nombre).join(', ')}` }
  return { ok: true, resumen: `Habilidad «${h.nombre}»`, datos: { nombre: h.nombre, instrucciones: h.contenido } }
}
