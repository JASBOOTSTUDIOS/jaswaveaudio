/**
 * Descripciones humanas de acciones DAW para la UI (aprobación, checklist, progreso del agente).
 *
 * Regla de oro: lo que devuelve este módulo lo lee un músico, no un programador. Nunca se
 * muestran tipos internos (`track.delete`), ids (`pistaId=…`, uuids), JSON ni rutas.
 */
import type { DAWState, DawAction } from '@jaswave/host-sdk'

export type ActionDescription = {
  /** Frase corta en español natural («Eliminar la pista «Bajo»»). */
  label: string
  /** Texto opcional legible para el usuario (nunca técnico). */
  detail?: string
}

/** Clase de riesgo de una herramienta (lectura, escritura o destructiva). */
export type ClaseHerramienta = 'lectura' | 'escritura' | 'destructiva'

// ─── utilidades de texto ─────────────────────────────────────────────────────

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** ¿Parece un identificador interno y no un nombre puesto por una persona? */
function pareceId(s: string): boolean {
  if (UUID_RE.test(s)) return true
  if (/^[0-9a-f]{12,}$/i.test(s)) return true
  // «track-1700000000000», «clip_3f2a9c», «t1»
  if (/^(track|pista|clip|plugin|nota|note|t|c)[-_]?[0-9a-f]{1,}$/i.test(s)) return true
  if (/^[a-z]+[-_][0-9a-z]{6,}$/i.test(s) && /\d/.test(s)) return true
  return false
}

/** Limpia un nombre que vamos a mostrar: sin saltos de línea, recortado y sin ids. */
function nombreVisible(v: unknown, max = 40): string {
  if (typeof v !== 'string') return ''
  const s = v.replace(/\s+/g, ' ').trim()
  if (!s || pareceId(s)) return ''
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`
}

const NOMBRES_NOTA = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si']

/** Nombre de nota en español (60 → «Do4»). */
export function nombreNota(pitch: number): string {
  const p = Math.round(pitch)
  return `${NOMBRES_NOTA[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`
}

const ROLES_INSTRUMENTO: Record<string, string> = {
  drums: 'Batería',
  percussion: 'Percusión',
  bass: 'Bajo',
  guitar: 'Guitarra',
  piano: 'Piano',
  keys: 'Teclados',
  pad: 'Colchón (pad)',
  pads: 'Colchón (pad)',
  lead: 'Melodía principal',
  strings: 'Cuerdas',
  brass: 'Metales',
  woodwind: 'Vientos',
  choir: 'Coro',
  synth: 'Sintetizador',
  fx: 'Efectos',
  vocals: 'Voz',
  vocal: 'Voz',
  unknown: 'Instrumento',
}

/** Nombre legible del rol de un instrumento («bass» → «Bajo»). */
export function nombreRolInstrumento(rol: unknown): string {
  const r = typeof rol === 'string' ? rol.trim() : ''
  if (!r) return 'Instrumento'
  const conocido = ROLES_INSTRUMENTO[r.toLowerCase()]
  if (conocido) return conocido
  const t = r.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_.]+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
}

/** «2 notas (de Do4 a Mi4)» */
function resumenNotas(notas: unknown): string {
  if (!Array.isArray(notas) || !notas.length) return ''
  const pitches = notas
    .map((n) => (n && typeof n === 'object' ? Number((n as { pitch?: number }).pitch) : NaN))
    .filter((p) => Number.isFinite(p))
  const base = plural(notas.length, 'nota', 'notas')
  if (!pitches.length) return base
  const lo = Math.min(...pitches)
  const hi = Math.max(...pitches)
  return lo === hi ? `${base} (${nombreNota(lo)})` : `${base} (de ${nombreNota(lo)} a ${nombreNota(hi)})`
}

function numero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '').replace('.', ',')
}

// ─── resolución de nombres con el estado del proyecto ────────────────────────

type PistaLite = { id?: unknown; nombre?: unknown; clips?: unknown }
type ClipLite = { id?: unknown; nombre?: unknown }

function pistasDe(estado: DAWState | null | undefined): PistaLite[] {
  try {
    const tracks = (estado as { project?: { tracks?: unknown } } | null | undefined)?.project?.tracks
    return Array.isArray(tracks) ? (tracks as PistaLite[]) : []
  } catch {
    return []
  }
}

function nombrePista(p: Record<string, unknown>, estado?: DAWState | null): string {
  const directo =
    nombreVisible(p.trackName) || nombreVisible(p.pistaNombre) || nombreVisible(p.nombrePista)
  if (directo) return directo
  const id = p.pistaId ?? p.trackId
  if (id == null || id === '') return ''
  const pista = pistasDe(estado).find((t) => t && String(t.id) === String(id))
  return pista ? nombreVisible(pista.nombre) : ''
}

function nombreClip(p: Record<string, unknown>, estado?: DAWState | null): string {
  const directo = nombreVisible(p.clipName) || nombreVisible(p.nombreClip)
  if (directo) return directo
  const id = p.clipId
  if (id == null || id === '') return ''
  for (const t of pistasDe(estado)) {
    const clips = Array.isArray(t?.clips) ? (t.clips as ClipLite[]) : []
    const c = clips.find((x) => x && String(x.id) === String(id))
    if (c) return nombreVisible(c.nombre)
  }
  return nombreVisible(p.nombre)
}

const laPista = (n: string) => (n ? `la pista «${n}»` : 'una pista')
const elClip = (n: string) => (n ? `el clip «${n}»` : 'un clip')
const enPista = (n: string) => (n ? ` en «${n}»` : '')
/** « del clip «Intro»» o « en «Bajo»» o «» */
const dondeNotas = (clip: string, pista: string) =>
  clip ? ` del clip «${clip}»` : pista ? ` en «${pista}»` : ''

/** «el plan» / «el documento «Letra de la canción»» */
function nombreDocumento(slug: unknown): string {
  const raw = typeof slug === 'string' ? slug.trim() : ''
  const base = (raw.split(/[/\\]/).pop() ?? '').replace(/\.(md|txt|json)$/i, '')
  if (!base || /^plan$/i.test(base)) return 'el plan'
  const legible = base.replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim()
  const n = nombreVisible(legible)
  return n ? `el documento «${n.charAt(0).toUpperCase()}${n.slice(1)}»` : 'un documento del proyecto'
}

function nombreArchivo(v: unknown): string {
  if (typeof v !== 'string') return ''
  const file = v.split(/[/\\]/).pop() ?? ''
  return nombreVisible(file.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' '))
}

// ─── reglas genéricas por prefijo/verbo ─────────────────────────────────────

function tokens(type: string): string[] {
  return String(type ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9áéíóúñü]+/)
    .filter(Boolean)
}

type Regla = {
  si: (t: string[], prefijo: string) => boolean
  /** Infinitivo para tarjetas («Crear una pista»). */
  accion: string
  /** Gerundio para el progreso del agente («Creando una pista»). */
  progreso: string
}

const tiene = (t: string[], ...ws: string[]) => ws.some((w) => t.includes(w))
const LECTURA = ['get', 'list', 'read', 'summary', 'search', 'lookup', 'probe', 'compare', 'status', 'inspect', 'describe', 'query', 'find', 'audition']
const BORRAR = ['delete', 'remove', 'clear', 'wipe', 'eliminar', 'borrar', 'quitar']
const CREAR = ['create', 'add', 'new', 'insert', 'crear']
const MEZCLA = ['mixer', 'mix', 'send', 'bus', 'master', 'volume', 'volumen', 'pan', 'gain', 'ganancia', 'fader', 'loudness', 'normalizar']

const REGLAS: Regla[] = [
  { si: (t) => tiene(t, 'tools', 'tool', 'herramientas', 'herramienta', 'capabilities'), accion: 'Buscar herramientas', progreso: 'Buscando herramientas' },
  { si: (t, p) => p === 'web' || (tiene(t, 'web') && tiene(t, 'search')), accion: 'Buscar información', progreso: 'Buscando información' },
  { si: (t) => tiene(t, 'bpm', 'tempo'), accion: 'Cambiar el tempo', progreso: 'Cambiando el tempo' },
  { si: (t) => tiene(t, 'signature', 'compas'), accion: 'Cambiar el compás', progreso: 'Cambiando el compás' },

  // Pistas
  { si: (t, p) => p === 'track' && tiene(t, ...CREAR) && !tiene(t, 'layer'), accion: 'Crear una pista', progreso: 'Creando una pista' },
  { si: (t, p) => p === 'track' && tiene(t, ...BORRAR), accion: 'Eliminar una pista', progreso: 'Eliminando una pista' },
  { si: (t, p) => p === 'track' && tiene(t, ...LECTURA) && tiene(t, 'fx', 'chain', 'plugin'), accion: 'Revisar los efectos de una pista', progreso: 'Revisando los efectos de una pista' },
  { si: (t, p) => p === 'track' && tiene(t, ...LECTURA), accion: 'Revisar las pistas', progreso: 'Revisando las pistas' },
  { si: (t, p) => p === 'track' && tiene(t, 'fx', 'chain', 'vst', 'layer', 'plugin', 'snapshot'), accion: 'Ajustar los efectos de una pista', progreso: 'Ajustando los efectos de una pista' },
  { si: (t, p) => p === 'track' && tiene(t, 'mute'), accion: 'Silenciar o activar una pista', progreso: 'Silenciando una pista' },
  { si: (t, p) => p === 'track' && tiene(t, 'solo'), accion: 'Escuchar una pista en solo', progreso: 'Poniendo una pista en solo' },
  { si: (t, p) => p === 'track' && tiene(t, 'arm', 'record', 'monitor'), accion: 'Preparar una pista para grabar', progreso: 'Preparando una pista para grabar' },
  { si: (t, p) => p === 'track' && tiene(t, 'unfreeze'), accion: 'Descongelar una pista', progreso: 'Descongelando una pista' },
  { si: (t, p) => p === 'track' && tiene(t, 'freeze'), accion: 'Congelar una pista', progreso: 'Congelando una pista' },
  { si: (t, p) => p === 'track' && tiene(t, ...MEZCLA), accion: 'Ajustar la mezcla', progreso: 'Ajustando la mezcla' },
  { si: (t, p) => p === 'track' || p === 'pista' || p === 'tracks', accion: 'Editar una pista', progreso: 'Editando una pista' },

  // MIDI
  { si: (t, p) => p === 'midi' && tiene(t, ...LECTURA, 'md'), accion: 'Revisar las notas MIDI', progreso: 'Revisando las notas MIDI' },
  { si: (t, p) => p === 'midi' && tiene(t, ...BORRAR, 'dedupe'), accion: 'Borrar notas MIDI', progreso: 'Borrando notas MIDI' },
  { si: (t, p) => p === 'midi' && tiene(t, 'quantize'), accion: 'Ajustar las notas al ritmo', progreso: 'Ajustando las notas al ritmo' },
  { si: (t, p) => p === 'midi' && tiene(t, 'transpose'), accion: 'Cambiar el tono de las notas', progreso: 'Cambiando el tono de las notas' },
  { si: (t, p) => p === 'midi' && tiene(t, ...CREAR, 'set', 'generate', 'patch', 'pattern', 'write'), accion: 'Escribir notas MIDI', progreso: 'Escribiendo notas MIDI' },
  { si: (t, p) => p === 'midi', accion: 'Editar notas MIDI', progreso: 'Editando notas MIDI' },

  // Clips
  { si: (t, p) => p === 'clip' && tiene(t, ...CREAR), accion: 'Crear un clip', progreso: 'Creando un clip' },
  { si: (t, p) => p === 'clip' && tiene(t, ...BORRAR), accion: 'Eliminar un clip', progreso: 'Eliminando un clip' },
  { si: (t, p) => p === 'clip' && tiene(t, ...LECTURA), accion: 'Revisar los clips', progreso: 'Revisando los clips' },
  { si: (t, p) => p === 'clip', accion: 'Editar un clip', progreso: 'Editando un clip' },

  // Efectos e instrumentos
  { si: (t, p) => (p === 'plugin' || p === 'fx' || p === 'instrument') && tiene(t, ...LECTURA, 'parameters'), accion: 'Revisar un efecto o instrumento', progreso: 'Revisando los efectos e instrumentos' },
  { si: (t, p) => (p === 'plugin' || p === 'fx' || p === 'instrument') && tiene(t, ...BORRAR), accion: 'Quitar un efecto o instrumento', progreso: 'Quitando un efecto o instrumento' },
  { si: (t, p) => (p === 'plugin' || p === 'fx' || p === 'instrument') && tiene(t, ...CREAR, 'duplicate'), accion: 'Añadir un efecto o instrumento', progreso: 'Añadiendo un efecto o instrumento' },
  { si: (t, p) => p === 'plugin' || p === 'fx' || p === 'instrument' || p === 'vst', accion: 'Ajustar un efecto o instrumento', progreso: 'Ajustando un efecto o instrumento' },
  { si: (t, p) => p === 'library' && tiene(t, ...LECTURA), accion: 'Buscar sonidos guardados', progreso: 'Buscando sonidos guardados' },
  { si: (t, p) => p === 'library' && tiene(t, 'save', 'promote'), accion: 'Guardar un sonido', progreso: 'Guardando un sonido' },
  { si: (t, p) => p === 'library' || p === 'preset', accion: 'Aplicar un sonido guardado', progreso: 'Aplicando un sonido guardado' },

  // Mezcla
  { si: (t, p) => MEZCLA.includes(p) || tiene(t, 'eq', 'compress', 'limit'), accion: 'Ajustar la mezcla', progreso: 'Ajustando la mezcla' },

  // Análisis y exportación
  { si: (t, p) => p === 'analysis' || p === 'analisis' || p === 'audit', accion: 'Analizar el proyecto', progreso: 'Analizando el proyecto' },
  { si: (t, p) => p === 'export' && tiene(t, 'midi'), accion: 'Exportar MIDI', progreso: 'Exportando MIDI' },
  { si: (t, p) => (p === 'render' || p === 'export') && tiene(t, 'cancel'), accion: 'Cancelar la exportación', progreso: 'Cancelando la exportación' },
  { si: (t, p) => (p === 'render' || p === 'export') && tiene(t, ...LECTURA), accion: 'Revisar la exportación', progreso: 'Revisando la exportación' },
  { si: (t, p) => p === 'render' || p === 'export' || p === 'bounce', accion: 'Exportar audio', progreso: 'Exportando audio' },

  // Transporte, proyecto y vista
  { si: (t, p) => p === 'transport' || p === 'playback', accion: 'Controlar la reproducción', progreso: 'Controlando la reproducción' },
  { si: (t, p) => p === 'project' && tiene(t, 'save'), accion: 'Guardar el proyecto', progreso: 'Guardando el proyecto' },
  { si: (t, p) => p === 'project' && tiene(t, 'new'), accion: 'Crear un proyecto nuevo', progreso: 'Creando un proyecto nuevo' },
  { si: (t, p) => p === 'project' && tiene(t, 'load', 'open'), accion: 'Abrir un proyecto', progreso: 'Abriendo un proyecto' },
  { si: (t, p) => p === 'project' && tiene(t, 'close'), accion: 'Cerrar el proyecto', progreso: 'Cerrando el proyecto' },
  { si: (t, p) => p === 'project' && tiene(t, ...LECTURA), accion: 'Revisar el proyecto', progreso: 'Revisando el proyecto' },
  { si: (t, p) => p === 'project', accion: 'Actualizar el proyecto', progreso: 'Actualizando el proyecto' },
  { si: (t, p) => (p === 'doc' || p === 'docs' || p === 'plan' || p === 'knowledge') && tiene(t, ...LECTURA, 'evaluate'), accion: 'Consultar el plan', progreso: 'Consultando el plan' },
  { si: (t, p) => p === 'doc' || p === 'docs' || p === 'plan' || p === 'knowledge', accion: 'Actualizar el plan', progreso: 'Actualizando el plan' },
  { si: (t, p) => p === 'audio' && tiene(t, 'import'), accion: 'Importar audio', progreso: 'Importando audio' },
  { si: (t, p) => p === 'audio' && tiene(t, 'device', 'devices', 'arm', 'native', 'ensure', 'quarantine'), accion: 'Configurar el audio', progreso: 'Configurando el audio' },
  { si: (t, p) => p === 'audio', accion: 'Procesar audio', progreso: 'Procesando audio' },
  { si: (t, p) => p === 'automation', accion: 'Editar la automatización', progreso: 'Editando la automatización' },
  { si: (t, p) => p === 'marker', accion: 'Añadir un marcador', progreso: 'Añadiendo un marcador' },
  { si: (t, p) => p === 'selection' && tiene(t, ...LECTURA), accion: 'Revisar la selección', progreso: 'Revisando la selección' },
  { si: (t, p) => p === 'selection', accion: 'Cambiar la selección', progreso: 'Cambiando la selección' },
  { si: (t, p) => p === 'ui' || p === 'view', accion: 'Ajustar la vista', progreso: 'Ajustando la vista' },

  // Composición y agente
  { si: (t, p) => p === 'daw' && tiene(t, 'wipe'), accion: 'Vaciar el proyecto', progreso: 'Vaciando el proyecto' },
  { si: (t, p) => p === 'daw' && tiene(t, 'compose', 'build', 'generate', 'song'), accion: 'Componer el arreglo', progreso: 'Componiendo el arreglo' },
  { si: (t, p) => p === 'daw' && tiene(t, 'master'), accion: 'Preparar el máster', progreso: 'Preparando el máster' },
  { si: (t, p) => (p === 'agent' || p === 'chat') && tiene(t, 'ask', 'user', 'clarify'), accion: 'Hacerte una pregunta', progreso: 'Preparando una pregunta' },
  { si: (t, p) => p === 'agent' || p === 'chat' || p === 'reasoning', accion: 'Preparar la respuesta', progreso: 'Preparando la respuesta' },
  { si: (t, p) => p === 'harness' || tiene(t, 'review', 'verify', 'certify', 'evaluate'), accion: 'Revisar el resultado', progreso: 'Revisando el resultado' },
  { si: (t) => tiene(t, ...LECTURA), accion: 'Revisar el proyecto', progreso: 'Revisando el proyecto' },
  { si: (t) => tiene(t, ...BORRAR), accion: 'Eliminar elementos del proyecto', progreso: 'Eliminando elementos del proyecto' },
]

function reglaPara(type: string): Regla | null {
  const t = tokens(type)
  const prefijo = t[0] ?? ''
  for (const r of REGLAS) {
    if (r.si(t, prefijo)) return r
  }
  return null
}

/**
 * Frase en gerundio para mostrar el progreso del agente mientras usa una herramienta
 * («Revisando las pistas», «Creando una pista», «Cambiando el tempo»…).
 * Nunca devuelve el nombre técnico de la herramienta.
 */
export function tituloHerramientaParaUsuario(type: string, clase?: ClaseHerramienta): string {
  const r = reglaPara(type)
  if (r) return r.progreso
  if (clase === 'lectura') return 'Revisando el proyecto'
  if (clase === 'destructiva') return 'Eliminando elementos del proyecto'
  if (clase === 'escritura') return 'Haciendo cambios en el proyecto'
  return 'Trabajando en el proyecto'
}

/** Infinitivo genérico para tipos sin descripción específica. */
function accionGenerica(type: string): string {
  return reglaPara(type)?.accion ?? 'Hacer un cambio en el proyecto'
}

// ─── descripción principal ──────────────────────────────────────────────────

/**
 * Descripción legible para aprobar/rechazar en el chat.
 * @param estado estado del DAW (opcional) para mostrar nombres de pistas y clips en vez de ids.
 */
export function describeActionForUser(a: DawAction, estado?: DAWState | null): ActionDescription {
  const p = ((a?.payload ?? {}) as Record<string, unknown>) || {}
  const type = String(a?.type ?? '')
  const pista = nombrePista(p, estado)
  const clip = nombreClip(p, estado)
  const notas = resumenNotas(p.notas)
  const soloVistaPrevia = p.aplicar === false || p.apply === false
  const vp = soloVistaPrevia ? 'Solo vista previa, todavía no se aplica.' : undefined

  switch (type) {
    case 'project.setBpm':
    case 'tempo.set': {
      const bpm = numero(p.bpm ?? p.tempo)
      return { label: bpm != null ? `Cambiar el tempo a ${fmtNum(bpm)} BPM` : 'Cambiar el tempo' }
    }
    case 'project.setTimeSignature': {
      const num = numero(p.numerador ?? p.numerator)
      const den = numero(p.denominador ?? p.denominator)
      return { label: num != null && den != null ? `Cambiar el compás a ${num}/${den}` : 'Cambiar el compás' }
    }
    case 'daw.musicBuild': {
      const idea = nombreVisible(p.prompt ?? p.nombre, 56)
      return { label: idea ? `Crear un arreglo: «${idea}»` : 'Crear un arreglo completo', detail: vp }
    }
    case 'daw.wipeProject':
      return { label: 'Vaciar el proyecto (se borran todas las pistas)' }
    case 'daw.composeProject':
    case 'daw.composeWorship': {
      const n = nombreVisible(p.nombre)
      return { label: n ? `Componer la canción «${n}»` : 'Componer una canción nueva', detail: vp }
    }
    case 'daw.generateMidiSong': {
      const n = nombreVisible(p.nombre)
      return {
        label: `Generar música MIDI${n ? ` «${n}»` : ''}${enPista(pista)}`,
        detail: [notas, vp].filter(Boolean).join('. ') || undefined,
      }
    }
    case 'midi.clip.create': {
      const n = nombreVisible(p.nombre)
      return {
        label: `Crear un clip MIDI${n ? ` «${n}»` : ''}${notas ? ` con ${notas}` : ''}${enPista(pista)}`,
        detail: vp,
      }
    }
    case 'midi.notes.set':
      return {
        label: `${notas ? `Reemplazar las notas por ${notas}` : 'Reemplazar las notas MIDI'}${dondeNotas(clip, pista)}`,
        detail: vp,
      }
    case 'midi.notes.dedupe':
      return { label: `Quitar notas duplicadas${dondeNotas(clip, pista)}` }
    case 'midi.clip.md.read':
      return { label: `Leer las notas${dondeNotas(clip, pista)}` }
    case 'midi.clip.md.upsert':
      return { label: `Proponer notas nuevas${dondeNotas(clip, pista)}`, detail: 'Vista previa: podrás revisarlas antes de aplicarlas.' }
    case 'midi.clip.md.apply':
      return { label: `Aplicar las notas propuestas${dondeNotas(clip, pista)}` }
    case 'midi.notes.compare':
      return { label: `Comparar las notas${dondeNotas(clip, pista)}` }
    case 'midi.notes.get':
    case 'midi.getNotes':
      return { label: `Revisar las notas${dondeNotas(clip, pista)}` }
    case 'midi.getClipSummary':
      return { label: `Revisar ${elClip(clip)}` }
    case 'midi.transpose': {
      const st = numero(p.semitonos ?? p.semitones)
      const cuanto =
        st == null
          ? 'Cambiar el tono de las notas'
          : st === 0
            ? 'Mantener el tono de las notas'
            : `${st > 0 ? 'Subir' : 'Bajar'} ${plural(Math.abs(st), 'semitono', 'semitonos')} las notas`
      return { label: `${cuanto}${dondeNotas(clip, pista)}` }
    }
    case 'midi.quantize':
      return { label: `Ajustar las notas al ritmo${dondeNotas(clip, pista)}` }
    case 'midi.humanize':
      return { label: `Dar un toque más humano a las notas${dondeNotas(clip, pista)}` }
    case 'midi.setVelocity': {
      const v = numero(p.velocity)
      const f = numero(p.relativeFactor)
      const que =
        v != null
          ? `Ajustar la intensidad de las notas a ${fmtNum(v)}`
          : f != null
            ? f >= 1
              ? 'Tocar las notas más fuerte'
              : 'Tocar las notas más suave'
            : 'Ajustar la intensidad de las notas'
      return { label: `${que}${dondeNotas(clip, pista)}` }
    }
    case 'midi.deleteNotes':
      return {
        label: `${Array.isArray(p.noteIds) ? `Borrar ${plural(p.noteIds.length, 'nota', 'notas')}` : 'Borrar notas'}${dondeNotas(clip, pista)}`,
      }
    case 'midi.createNotes':
      return { label: `${notas ? `Añadir ${notas}` : 'Añadir notas'}${dondeNotas(clip, pista)}` }
    case 'midi.clip.splitIntoSections': {
      const piezas = (Array.isArray(p.cuts) ? p.cuts.length : 0) + 1
      return { label: `Partir ${elClip(clip)} en ${piezas} secciones${clip ? '' : enPista(pista)}` }
    }
    case 'clip.create': {
      const n = nombreVisible(p.nombre)
      return { label: `Crear un clip de audio${n ? ` «${n}»` : ''}${enPista(pista)}` }
    }
    case 'clip.delete':
      return { label: `Eliminar ${elClip(clip)}${clip ? '' : enPista(pista)}` }
    case 'clip.move': {
      const ini = numero(p.inicio)
      return { label: `Mover ${elClip(clip)}${ini != null ? ` al tiempo ${fmtNum(ini)}` : ''}${enPista(pista)}` }
    }
    case 'clip.split': {
      const t = numero(p.tiempo)
      return { label: `Dividir ${elClip(clip)}${t != null ? ` en el tiempo ${fmtNum(t)}` : ''}` }
    }
    case 'clip.merge': {
      const n = Array.isArray(p.clipIds) ? p.clipIds.length : 0
      return { label: `${n > 1 ? `Unir ${n} clips` : 'Unir clips'}${enPista(pista)}` }
    }
    case 'project.update': {
      const datos = ((p.datos ?? p) || {}) as Record<string, unknown>
      const cambios: string[] = []
      const n = nombreVisible(datos.nombre, 32)
      if (n) cambios.push(`nombre «${n}»`)
      if (datos.tonalidad) cambios.push('tonalidad')
      if (Array.isArray(datos.tonalidadRegiones) && datos.tonalidadRegiones.length) {
        cambios.push(plural(datos.tonalidadRegiones.length, 'cambio de tonalidad', 'cambios de tonalidad'))
      }
      return { label: cambios.length ? `Actualizar el proyecto: ${cambios.join(', ')}` : 'Actualizar el proyecto' }
    }
    case 'track.create': {
      const n = nombreVisible(p.nombre ?? p.name)
      return { label: n ? `Crear la pista «${n}»` : 'Crear una pista' }
    }
    case 'track.delete':
      return { label: `Eliminar ${laPista(pista)}` }
    case 'track.update':
      return { label: `Actualizar ${laPista(pista)}` }
    case 'track.toggleMute':
      return { label: `Silenciar o activar ${laPista(pista)}` }
    case 'track.toggleSolo':
      return { label: `Poner en solo ${laPista(pista)}` }
    case 'plugin.insert': {
      const n = nombreVisible(p.nombre ?? p.pluginName)
      return { label: `Añadir ${n ? `«${n}»` : 'un efecto o instrumento'}${enPista(pista)}` }
    }
    case 'plugin.remove':
      return { label: `Quitar un efecto o instrumento${enPista(pista)}` }
    case 'plugin.bypass':
      return {
        label: `${p.bypass === false ? 'Volver a activar' : 'Desactivar temporalmente'} un efecto${enPista(pista)}`,
      }
    case 'plugin.setParameter': {
      const n = nombreVisible(p.name ?? p.parameterName ?? p.nombreParametro)
      const v = numero(p.normalizedValue)
      const pct = v != null ? ` al ${Math.round(Math.max(0, Math.min(1, v)) * 100)} %` : ''
      return { label: `Ajustar ${n ? `«${n}»` : 'un control del efecto'}${pct}${enPista(pista)}` }
    }
    case 'library.preset.apply': {
      const n = nombreVisible(p.nombre)
      return { label: `Aplicar el sonido ${n ? `«${n}»` : 'guardado'}${enPista(pista)}` }
    }
    case 'doc.write':
    case 'doc.create':
      return { label: `Actualizar ${nombreDocumento(p.slug)}` }
    case 'doc.append':
      return { label: `Añadir notas a ${nombreDocumento(p.slug)}` }
    case 'doc.read':
      return { label: `Leer ${nombreDocumento(p.slug)}` }
    case 'doc.list':
      return { label: 'Ver los documentos del proyecto' }
    case 'audio.import': {
      const f = nombreArchivo(p.filePath) || nombreVisible(p.nombre)
      return { label: `Importar el audio${f ? ` «${f}»` : ''}${enPista(pista)}` }
    }
    case 'ui.setZoom':
      return { label: 'Ajustar el zoom' }
    case 'transport.toggle':
      return { label: 'Reproducir o pausar' }
    case 'transport.stop':
      return { label: 'Detener la reproducción' }
    case 'transport.toggleMetronome':
      return { label: 'Activar o desactivar el metrónomo' }
    case 'transport.toggleLoop':
      return { label: 'Activar o desactivar la repetición en bucle' }
    case 'project.save':
      return { label: 'Guardar el proyecto' }
    default: {
      const base = accionGenerica(type)
      // Si la acción menciona una pista o clip con nombre, lo añadimos.
      const extra = clip ? ` (clip «${clip}»)` : pista ? ` (pista «${pista}»)` : ''
      return { label: `${base}${extra}`, detail: vp }
    }
  }
}

export function labelForAction(a: DawAction, estado?: DAWState | null): string {
  return describeActionForUser(a, estado).label
}
