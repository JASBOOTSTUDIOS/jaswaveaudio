/**
 * Humanización al escribir (plan S), junto a las guardias de armonía y legato: tras validar la armonía y ANTES del
 * legato worship, las notas que un músico manda a su pista pasan por `humanizarBanda` (shared): micro-timing
 * gaussiano por instrumento, acentos y ganancia por compás, y variación determinista entre compases que son copia
 * exacta de otro (también de otro clip de la misma pista: la memoria `MemoriaHumanizado` vive lo que dura la
 * producción). Alturas intactas: la armonía ya validada no se toca. El tiempo va antes que el legato para que las
 * notas largas sigan sin huecos (el legato se calcula sobre los ataques ya movidos).
 *
 * Ajuste del usuario: `localStorage['jaswave-banda-humanizar']` = 'siempre' | 'suave' | 'nunca' (defecto 'suave').
 *  - suave: micro-timing y dinámica en todo; variación estructural solo en las copias exactas.
 *  - siempre: lo anterior más amplitud 25 % mayor y variación también en compases que no son copia.
 *  - nunca: no se toca nada.
 *
 * Límites: la guardia ve las notas de ESTA llamada. En `midi.notes.patch` (retoques nota a nota) no actúa; si el
 * músico relee su clip y lo reescribe con `midi.notes.set`, el tiempo se vuelve a mover un poco (mismo desvío,
 * misma semilla) y los fantasmas ya presentes cuentan para el objetivo de 2–3 por compás, de modo que no se acumulan.
 *
 * Por qué no `midi.humanize` / `style.touch.apply`: aquel aplica un desvío uniforme al clip entero y este el perfil
 * de interpretación aprendido del teclado del usuario; ninguno distingue instrumentos ni varía las copias, y los dos
 * actúan sobre el proyecto ya escrito (con undo propio) en vez de en la escritura. Pueden convivir: el perfil del
 * usuario se aplica después, al terminar cada músico.
 */
import { clasificarFamiliaBanda, humanizarBanda } from '@jaswave/host-sdk'
import { camposNota, comoListaDeNotas, tonoMidi } from '../agent-tool-runner'
import type { HojaCoherencia } from './coherencia-banda'

export type ModoHumanizarBandaAjuste = 'siempre' | 'suave' | 'nunca'
export const CLAVE_HUMANIZAR = 'jaswave-banda-humanizar'

export function modoHumanizarBanda(): ModoHumanizarBandaAjuste {
  try {
    const v = String(globalThis.localStorage?.getItem(CLAVE_HUMANIZAR) ?? '').replace(/^"|"$/g, '').trim().toLowerCase()
    return v === 'siempre' || v === 'nunca' || v === 'suave' ? v : 'suave'
  } catch {
    return 'suave'
  }
}

/** Compases ya vistos de cada pista (firma → compases absolutos): detecta copias entre clips de la misma pista. */
export type MemoriaHumanizado = Map<string, Map<string, Set<number>>>
export const crearMemoriaHumanizado = (): MemoriaHumanizado => new Map()

const HERRAMIENTAS = /^midi\.(clip\.create|createNotes|notes\.set|notes\.add)$/
const ALIAS_PITCH = ['pitch', 'nota', 'tono', 'note', 'midi', 'key', 'altura']
const ALIAS_INICIO = ['inicio', 'start', 'tiempo', 'time', 'beat', 'posicion', 'posición', 'comienzo', 'offset']
const ALIAS_DURACION = ['duracion', 'duración', 'duration', 'dur', 'length', 'largo']
const ALIAS_VELOCIDAD = ['velocidad', 'velocity', 'vel', 'dinamica', 'dinámica']
const clave = (o: Record<string, unknown>, alias: readonly string[], porDefecto: string) => alias.find((k) => o[k] != null) ?? porDefecto

export type ResultadoHumanizarBanda = { args: Record<string, unknown>; avisos: string[] }

type OpcionesGuardia = {
  familia: ReturnType<typeof clasificarFamiliaBanda>
  bpm: number
  numerador: number
  semilla: string
  inicioClip: number
  finClip?: number
  modo: 'siempre' | 'suave'
  vistos?: Map<string, Set<number>>
  compasesProtegidos?: ReadonlySet<number>
}

/** Aplica la humanización a la lista de notas de una escritura MIDI. Sin lista legible: no toca nada. */
export function guardiaHumanizar(tool: string, args: Record<string, unknown>, o: OpcionesGuardia): ResultadoHumanizarBanda {
  if (!HERRAMIENTAS.test(tool) || !(o.bpm > 0)) return { args, avisos: [] }
  const k = (['upsert', 'notas', 'notes', 'cambios'] as const).find((x) => args[x] != null)
  if (!k) return { args, avisos: [] }
  const crudo = comoListaDeNotas(args[k])
  if (!crudo || crudo.length < 2) return { args, avisos: [] }
  const items = crudo as unknown[]
  const idx: number[] = []
  const notas: Array<{ pitch: number; inicio: number; duracion: number; velocidad?: number }> = []
  items.forEach((it, i) => {
    if (!it || typeof it !== 'object') return
    const c = camposNota(it as Record<string, unknown>)
    const pitch = tonoMidi(c.pitchCrudo)
    const inicio = Number(c.inicio)
    const duracion = Number(c.duracion)
    if (pitch == null || !Number.isFinite(inicio) || !Number.isFinite(duracion) || duracion <= 0) return
    const vel = Number(c.velocidad)
    idx.push(i)
    notas.push({ pitch, inicio, duracion, ...(c.velocidad != null && Number.isFinite(vel) ? { velocidad: vel } : {}) })
  })
  if (notas.length < 2) return { args, avisos: [] }
  const { notas: res, resumen } = humanizarBanda(notas, {
    familia: o.familia,
    bpm: o.bpm,
    numerador: o.numerador,
    modo: o.modo,
    semilla: o.semilla,
    inicioClip: o.inicioClip,
    finClip: o.finClip,
    vistos: o.vistos,
    compasesProtegidos: o.compasesProtegidos,
  })
  const salida: unknown[] = []
  const escribir = (base: Record<string, unknown>, n: (typeof res)[number]) => {
    const copia: Record<string, unknown> = { ...base }
    copia[clave(base, ALIAS_INICIO, 'inicio')] = n.inicio
    copia[clave(base, ALIAS_DURACION, 'duracion')] = n.duracion
    copia[clave(base, ALIAS_VELOCIDAD, 'velocidad')] = n.velocidad
    return copia
  }
  for (const n of res) {
    const fuente = items[idx[n.origen >= 0 ? n.origen : n.plantilla]!] as Record<string, unknown>
    if (n.origen >= 0) salida.push(escribir(fuente, n))
    else {
      const nueva = escribir(fuente, n)
      delete nueva.id
      nueva[clave(fuente, ALIAS_PITCH, 'pitch')] = n.pitch
      salida.push(nueva)
    }
  }
  // Lo que no se pudo leer como nota se conserva tal cual.
  items.forEach((it, i) => {
    if (!idx.includes(i)) salida.push(it)
  })
  const partes = [
    `${resumen.movidas} notas con micro-timing`,
    resumen.variados ? `${resumen.variados} compases variados${resumen.copias ? ` (${resumen.copias} eran copia exacta)` : ''}` : '',
    resumen.fantasmas ? `${resumen.fantasmas} ghost notes` : '',
    resumen.fills ? `${resumen.fills} fills` : '',
  ].filter(Boolean)
  return { args: { ...args, [k]: salida }, avisos: [`humanización: ${partes.join(', ')}`] }
}

type EstadoHumanizar = {
  project?: {
    bpm?: unknown
    timeSignature?: { numerador?: unknown }
    tracks?: Array<{ id: string; nombre: string; plugins?: ReadonlyArray<{ nombre?: string }>; clips?: Array<{ id: string; inicio: number; duracion?: number }> }>
  }
}

/** Compases absolutos (0-based) en los que empieza cada sección de la hoja de ruta. */
export function compasesDeInicioDeSeccion(hoja: HojaCoherencia | null): Set<number> {
  const out = new Set<number>()
  let c = 0
  for (const s of hoja?.secciones ?? []) {
    out.add(c)
    c += s.compases
  }
  return out
}

/** Guardia sobre el estado del proyecto: localiza pista, clip y bpm. Inactiva con el ajuste en «nunca». */
export function guardarEscrituraHumanizar(
  st: EstadoHumanizar,
  hoja: HojaCoherencia | null,
  llamada: { nombre: string; argumentos?: Record<string, unknown> },
  memoria: MemoriaHumanizado,
  modo: ModoHumanizarBandaAjuste = modoHumanizarBanda(),
): ResultadoHumanizarBanda {
  const args = llamada.argumentos ?? {}
  if (modo === 'nunca' || !HERRAMIENTAS.test(llamada.nombre)) return { args, avisos: [] }
  const pista = (st.project?.tracks ?? []).find((t) => t.id === String(args.pistaId ?? args.trackId ?? ''))
  if (!pista) return { args, avisos: [] }
  const clip = pista.clips?.find((c) => c.id === String(args.clipId ?? ''))
  const creando = llamada.nombre === 'midi.clip.create'
  const durCreate = Number(args.duracion ?? args.duration ?? args.length)
  const finClip = creando ? (Number.isFinite(durCreate) && durCreate > 0 ? durCreate : undefined) : clip?.duracion
  const inicioClip = creando ? Number(args.inicio ?? 0) || 0 : (clip?.inicio ?? 0)
  const vistos = memoria.get(pista.id) ?? new Map<string, Set<number>>()
  memoria.set(pista.id, vistos)
  return guardiaHumanizar(llamada.nombre, args, {
    familia: clasificarFamiliaBanda(pista.nombre, pista.plugins ?? []),
    bpm: Number(st.project?.bpm),
    numerador: Math.max(1, Math.round(hoja?.numerador || Number(st.project?.timeSignature?.numerador ?? 4) || 4)),
    semilla: pista.id,
    inicioClip,
    finClip,
    modo,
    vistos,
    compasesProtegidos: compasesDeInicioDeSeccion(hoja),
  })
}

const NOMBRE_GENERICO = /^\s*(clip(\s*midi)?|nuevo\s+clip|midi(\s+clip)?|sin\s+nombre|untitled(\s+clip)?)\s*\d*\s*$/i

/**
 * Nombre de clip «<Pista> - <Sección>» cuando el músico no le puso nombre o dejó el genérico («Clip MIDI»), con la
 * sección de la hoja de ruta que contiene el beat de inicio del clip.
 */
export function nombrarClipGenerico(
  st: EstadoHumanizar,
  hoja: HojaCoherencia | null,
  llamada: { nombre: string; argumentos?: Record<string, unknown> },
): Record<string, unknown> {
  const args = llamada.argumentos ?? {}
  if (llamada.nombre !== 'midi.clip.create' || !hoja) return args
  const actual = String(args.nombre ?? args.name ?? '').trim()
  if (actual && !NOMBRE_GENERICO.test(actual)) return args
  const pista = (st.project?.tracks ?? []).find((t) => t.id === String(args.pistaId ?? args.trackId ?? ''))
  if (!pista) return args
  const num = Math.max(1, Math.round(hoja.numerador || Number(st.project?.timeSignature?.numerador ?? 4) || 4))
  const beat = Number(args.inicio ?? 0) || 0
  let compas = 0
  let seccion: string | undefined
  for (const s of hoja.secciones) {
    if (beat >= compas * num - 1e-6 && beat < (compas + s.compases) * num - 1e-6) {
      seccion = s.nombre
      break
    }
    compas += s.compases
  }
  if (!seccion) return args
  return { ...args, nombre: `${pista.nombre} - ${seccion}` }
}
