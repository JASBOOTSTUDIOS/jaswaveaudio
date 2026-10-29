/**
 * Cliente de la biblioteca de grooves MIDI (M) en el renderer: carga el índice crudo del proceso main, lo
 * convierte con la lógica pura de `shared/src/grooves` y expone listar / leer notas / insertar en el proyecto.
 * La inserción es un `midi.clip.create` (comando con undo y auditoría); no escribe nada fuera de los comandos.
 */

import type { TiendaDAW } from '../../../../shared/src/state/tienda'
import { leerSmf } from '../../../../shared/src/midi/smf'
import {
  construirNotasDeGroove,
  datosDeCancion,
  desduplicarIds,
  elegirGroove,
  filtrarGrooves,
  fusionarMetadatos,
  inferirMetadatos,
  ordenarGrooves,
  type EntradaGroove,
  type FiltroGrooves,
  type NotaGroove,
  type OpcionesInsercion,
} from '../../../../shared/src/grooves'

export type ResultadoSyncUi = {
  ok: boolean
  sinConexion?: boolean
  error?: string
  sinCambios?: boolean
  revision?: number
  descargados: number
  actualizados: number
  retirados: number
  conservados: string[]
  errores: Array<{ nombre: string; error: string }>
  fecha: string
}
export type EstadoSyncUi = {
  auto: boolean
  compartir: boolean
  ultima: string | null
  ultimoResultado: ResultadoSyncUi | null
  novedades: Array<{ tipo: string; nombre: string; fecha: string }>
  propuestos: string[]
}
export type EventoSyncUi = { tipo: 'inicio' | 'progreso' | 'fin'; hecho?: number; total?: number; nombre?: string; resultado?: ResultadoSyncUi }
export type MetaPropuestaUi = { nombre: string; estilo: string; tipo?: string; compas?: string; tempo?: number; compases?: number; intensidad?: number; etiquetas?: string[]; autor?: string }

export type GroovesApi = {
  carpeta(): Promise<string>
  listar(): Promise<{
    ok: boolean
    error?: string
    raiz?: string
    grooves?: Array<{
      ruta: string
      sha256: string
      resumen: { bpm: number; compas?: { numerador: number; denominador: number }; duracionBeats: number; notas: number }
      carpeta?: unknown
      sidecar?: unknown
    }>
    carpetas?: string[]
    favoritos?: string[]
  }>
  leer(ruta: string): Promise<{ ok: boolean; error?: string; bytes?: Uint8Array }>
  importarBytes(nombre: string, bytes: Uint8Array, estilo: string, subestilo?: string): Promise<{ ok: boolean; error?: string; ruta?: string }>
  importarDialogo(estilo: string, subestilo?: string): Promise<{ ok: boolean; error?: string; importados?: string[]; errores?: Array<{ archivo: string; error: string }>; cancelado?: boolean }>
  importarArchivos(rutas: string[], estilo: string, subestilo?: string): Promise<{ ok: boolean; error?: string; importados?: string[]; errores?: Array<{ archivo: string; error: string }> }>
  crearEstilo(estilo: string, subestilo?: string): Promise<{ ok: boolean; error?: string; ruta?: string }>
  renombrarEstilo(actual: string, nuevo: string): Promise<{ ok: boolean; error?: string; ruta?: string }>
  borrar(ruta: string): Promise<{ ok: boolean; error?: string }>
  borrarEstilo(ruta: string): Promise<{ ok: boolean; error?: string }>
  favorito(id: string, valor?: boolean): Promise<{ ok: boolean; error?: string; favoritos?: string[] }>
  abrirCarpeta(): Promise<{ ok: boolean; error?: string }>
  onCambio(cb: () => void): () => void
  syncAhora(apiBase: string, token: string): Promise<ResultadoSyncUi>
  syncEstado(): Promise<{ ok: boolean; error?: string; estado?: EstadoSyncUi }>
  syncAjustes(ajustes: { auto?: boolean; compartir?: boolean }): Promise<{ ok: boolean; error?: string; estado?: EstadoSyncUi }>
  proponer(apiBase: string, token: string, ruta: string, meta: MetaPropuestaUi, consentimiento: { aceptado: boolean; version: string }): Promise<{ ok: boolean; error?: string; repetida?: boolean; mensaje?: string; estado?: string }>
  onSync(cb: (e: EventoSyncUi) => void): () => void
}

export function apiGrooves(): GroovesApi | null {
  if (typeof window === 'undefined') return null
  return ((window as unknown as { electron?: { grooves?: GroovesApi } }).electron?.grooves ?? null) as GroovesApi | null
}

export type IndiceGrooves = { disponible: boolean; raiz: string; lista: EntradaGroove[]; carpetas: string[]; error?: string }

let cacheIndice: Promise<IndiceGrooves> | null = null
const cacheNotas = new Map<string, NotaGroove[]>()
const oyentes = new Set<() => void>()
let desuscribirMain: (() => void) | null = null

export function invalidarGrooves(): void {
  cacheIndice = null
  for (const cb of oyentes) cb()
}

/** Avisa cuando la carpeta cambia (importar, borrar, vigilancia del disco). */
export function suscribirGrooves(cb: () => void): () => void {
  oyentes.add(cb)
  if (!desuscribirMain) desuscribirMain = apiGrooves()?.onCambio(() => invalidarGrooves()) ?? null
  return () => {
    oyentes.delete(cb)
    if (!oyentes.size && desuscribirMain) {
      desuscribirMain()
      desuscribirMain = null
    }
  }
}

export function cargarGrooves(forzar = false): Promise<IndiceGrooves> {
  if (!forzar && cacheIndice) return cacheIndice
  const api = apiGrooves()
  if (!api) return Promise.resolve({ disponible: false, raiz: '', lista: [], carpetas: [] })
  cacheIndice = api.listar().then((r): IndiceGrooves => {
    if (!r.ok || !r.grooves) return { disponible: true, raiz: r.raiz ?? '', lista: [], carpetas: [], error: r.error ?? 'No se pudo leer la biblioteca' }
    const favs = new Set(r.favoritos ?? [])
    const lista = r.grooves.map((g): EntradaGroove => {
      const inferidos = inferirMetadatos(g.ruta, g.resumen)
      const meta = fusionarMetadatos({
        ruta: g.ruta,
        inferidos,
        carpeta: (g.carpeta && typeof g.carpeta === 'object' ? g.carpeta : undefined) as never,
        sidecar: (g.sidecar && typeof g.sidecar === 'object' ? g.sidecar : undefined) as never,
        sha256: g.sha256,
      })
      return { ...meta, ruta: g.ruta, notas: g.resumen.notas }
    })
    const unica = desduplicarIds(lista).map((g) => ({ ...g, favorito: favs.has(g.id) }))
    return { disponible: true, raiz: r.raiz ?? '', lista: ordenarGrooves(unica), carpetas: r.carpetas ?? [] }
  })
  cacheIndice.catch(() => {
    cacheIndice = null
  })
  return cacheIndice
}

/** Notas (en beats) del .mid de un groove. */
export async function notasDeGroove(g: Pick<EntradaGroove, 'ruta' | 'sha256'>): Promise<NotaGroove[]> {
  const clave = `${g.ruta}|${g.sha256}`
  const hit = cacheNotas.get(clave)
  if (hit) return hit
  const api = apiGrooves()
  if (!api) throw new Error('La biblioteca de grooves solo está disponible en la app de escritorio')
  const r = await api.leer(g.ruta)
  if (!r.ok || !r.bytes) throw new Error(r.error ?? 'No se pudo leer el groove')
  const notas = datosDeCancion(leerSmf(new Uint8Array(r.bytes))).notas
  if (cacheNotas.size > 300) cacheNotas.clear()
  cacheNotas.set(clave, notas)
  return notas
}

export async function listarGrooves(filtro: FiltroGrooves = {}): Promise<EntradaGroove[]> {
  const { lista } = await cargarGrooves()
  return filtrarGrooves(lista, filtro)
}

// ── Inserción en el proyecto ─────────────────────────────────────────────────

export type PeticionInsertarGroove = {
  grooveId?: string
  /** Si no hay `grooveId`: criterios para elegir uno (tipo «groove» por defecto). */
  criterios?: FiltroGrooves
  pistaId: string
  inicioBeat: number
  compases?: number
  variacion?: 'ninguna' | 'ligera'
  /** Id de un fill de la biblioteca para el último compás (o `true` para elegir uno del mismo estilo). */
  fill?: string | boolean
  escalarAlTempo?: boolean
  /** Cambia el compás del proyecto al del groove (comando aparte, con undo). */
  adaptarCompas?: boolean
  semilla?: number
}

export type ResultadoInsertarGroove = {
  ok: boolean
  mensaje: string
  clipId?: string
  grooveId?: string
  compases?: number
  duracion?: number
  aviso?: string
}

export async function insertarGroove(tienda: TiendaDAW, p: PeticionInsertarGroove): Promise<ResultadoInsertarGroove> {
  const { lista, disponible } = await cargarGrooves()
  if (!disponible) return { ok: false, mensaje: 'La biblioteca de grooves solo está disponible en la app de escritorio' }
  const estado = tienda.obtenerEstado()
  const pista = estado.project.tracks.find((t) => t.id === p.pistaId)
  if (!pista) return { ok: false, mensaje: `Pista no encontrada: ${p.pistaId}` }
  if (pista.tipo !== 'midi' && pista.tipo !== 'instrumento') {
    return { ok: false, mensaje: `La pista «${pista.nombre}» no es MIDI/instrumento: elige la pista de batería.` }
  }
  const g = elegirGroove(lista, { grooveId: p.grooveId, ...(p.criterios ?? {}) }, p.semilla)
  if (!g) return { ok: false, mensaje: p.grooveId ? `Groove no encontrado: ${p.grooveId}` : 'Ningún groove cumple los criterios' }
  const inicio = Number.isFinite(p.inicioBeat) ? Math.max(0, p.inicioBeat) : 0

  let fillFinal: OpcionesInsercion['fillFinal']
  if (p.fill) {
    const f =
      typeof p.fill === 'string'
        ? lista.find((x) => x.id === p.fill)
        : elegirGroove(lista, { estilo: g.estilo, tipo: 'fill', compas: `${g.compas.numerador}/${g.compas.denominador}` }, p.semilla)
    if (f) fillFinal = { notas: await notasDeGroove(f), compases: f.compases }
  }
  const notas = await notasDeGroove(g)
  const tempoProyecto = estado.project.bpm?.valor
  const ts = estado.project.timeSignature
  const construido = construirNotasDeGroove(g, notas, {
    compases: p.compases,
    variacion: p.variacion,
    fillFinal,
    semilla: p.semilla,
    escalarAlTempo: p.escalarAlTempo,
    tempoProyecto,
    compasProyecto: ts ? { numerador: ts.numerador, denominador: ts.denominador } : undefined,
  })
  if (!construido.notas.length) return { ok: false, mensaje: 'El groove no tiene notas' }

  let aviso = construido.aviso
  if (p.adaptarCompas && ts && (ts.numerador !== g.compas.numerador || ts.denominador !== g.compas.denominador)) {
    const r = await tienda.executor.execute('project.setTimeSignature', { numerador: g.compas.numerador, denominador: g.compas.denominador }, 'user')
    if (r.success) aviso = undefined
    else aviso = `${aviso ?? ''} No se pudo cambiar el compás del proyecto: ${r.error?.message ?? 'error'}`.trim()
  }

  const r = await tienda.executor.execute(
    'midi.clip.create',
    {
      pistaId: p.pistaId,
      nombre: g.nombre,
      inicio,
      duracion: construido.duracion,
      notas: construido.notas.map((n) => ({ pitch: n.pitch, inicio: n.inicio, duracion: n.duracion, velocidad: n.velocidad })),
    },
    'user',
  )
  if (!r.success) return { ok: false, mensaje: r.error?.message ?? 'No se pudo crear el clip' }
  const clipId = (r.result as { clipId?: string } | undefined)?.clipId
  return {
    ok: true,
    clipId,
    grooveId: g.id,
    compases: construido.compases,
    duracion: construido.duracion,
    aviso,
    mensaje: `Groove «${g.nombre}» (${g.estilo}) insertado en «${pista.nombre}» en el beat ${inicio}: ${construido.compases} compás(es), ${construido.notas.length} notas.${aviso ? ' ' + aviso : ''}`,
  }
}

/** Posición del playhead en beats. */
export function playheadBeats(tienda: TiendaDAW): number {
  return tienda.obtenerEstado().transport?.posicion?.beats ?? 0
}
