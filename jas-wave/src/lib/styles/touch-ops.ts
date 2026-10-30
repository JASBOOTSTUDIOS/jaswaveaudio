/**
 * «Toque» del intérprete (micro-timing, microdinámica, dispersión de acordes, articulación, ataque):
 * recolección de notas (clips o captura del teclado MIDI), biblioteca de perfiles y aplicación con undo.
 *
 * Persistencia: biblioteca GLOBAL del usuario en {userData}/library/touch-profiles.json, junto a
 * library/styles.json (el toque es de la persona, no del proyecto). Sin Electron: localStorage / memoria.
 *
 * Acciones del agente: analysis.touch · style.touch.learn · style.touch.apply · style.touch.list.
 */

import type { MidiClip, MidiNote } from '@jaswave/shared'
import {
  agruparAtaques,
  aplicarPerfilToque,
  aprenderPerfilToque,
  describirPerfilToque,
  hashSemilla,
  normalizarPerfilToque,
  notasValidas,
  safeProjectBpm,
  type EventoPedalToque,
  type NotaToque,
  type PerfilToque,
} from '../../../../shared/src'
import type { TiendaDAW } from '../../../../shared/src/state/tienda'
import { bufferEscuchaMidi, controlDeEventos, notasDeEventos, type EventoEscucha, type Toma } from '../midi-example-analyzer'

export type PerfilToqueGuardado = {
  id: string
  nombre: string
  instrumento?: string
  perfil: PerfilToque
  /** Informe legible (para el prompt / UI). */
  resumen: string
  origen: { tipo: 'clips' | 'captura' | 'toma'; trackId?: string; clipIds?: string[]; segundos?: number }
  createdAt: number
  updatedAt: number
  version: 1
}

export type OrigenToque = {
  trackId?: string
  clipIds?: string[]
  segundos?: number
  instrumento?: string
  /** Analizar la toma grabada con «Grabar toma» (la actual o la última terminada) en vez de los últimos segundos. */
  toma?: boolean
}

type Recoleccion = {
  notas: NotaToque[]
  bpm: number
  beatsPorCompas: number
  instrumento?: string
  origen: PerfilToqueGuardado['origen']
  descripcion: string
  /** Pedal de sustain (CC64) de la captura, en beats del mismo eje que las notas. */
  pedal?: EventoPedalToque[]
  /** Transporte al que se alineó la captura (solo tomas grabadas con el transporte en marcha). */
  transporte?: { posicionBeats: number; bpm: number }
}

/**
 * Notas y pedal de unos eventos escuchados, en beats. Con el transporte en marcha al empezar la toma, el eje
 * es el del proyecto (la posición del transporte en `inicioNs` y su BPM); si no, la primera nota es el
 * tiempo fuerte (la captura no tiene otra referencia).
 */
function desdeEventos(
  eventos: readonly EventoEscucha[],
  o: { bpm: number; inicioNs?: number; transporte?: Toma['transporte'] },
): { notas: NotaToque[]; pedal: EventoPedalToque[]; bpm: number; transporte?: { posicionBeats: number; bpm: number } } {
  const escuchadas = notasDeEventos(eventos)
  const alineada = Boolean(o.transporte?.reproduciendo && o.transporte.bpm > 0 && o.inicioNs != null)
  const bpm = alineada ? o.transporte!.bpm : o.bpm
  const msPorBeat = 60000 / bpm
  const origenMs = alineada ? o.inicioNs! / 1e6 : (escuchadas[0]?.inicioMs ?? 0)
  const base = alineada ? o.transporte!.posicionBeats : 0
  const aBeats = (ms: number) => base + (ms - origenMs) / msPorBeat
  const notas: NotaToque[] = escuchadas.map((n) => ({
    pitch: n.pitch,
    inicio: aBeats(n.inicioMs),
    duracion: n.duracionMs / msPorBeat,
    velocidad: n.velocity,
  }))
  const pedal: EventoPedalToque[] = controlDeEventos(eventos, 64).map((p) => ({ inicio: aBeats(p.tMs), valor: p.valor }))
  return { notas, pedal, bpm, ...(alineada ? { transporte: { posicionBeats: base, bpm } } : {}) }
}

function compasDe(tienda: TiendaDAW): number {
  const ts = tienda.obtenerEstado().project?.timeSignature as { numerador?: number; denominador?: number } | undefined
  const num = Number(ts?.numerador) || 4
  const den = Number(ts?.denominador) || 4
  return (num * 4) / den
}

function clipsMidiDe(tienda: TiendaDAW, trackId: string): MidiClip[] {
  const track = tienda.obtenerEstado().project?.tracks?.find((t) => t.id === trackId)
  return ((track?.clips ?? []) as Array<MidiClip | { tipo: string }>).filter((c): c is MidiClip => c.tipo === 'midi')
}

/**
 * Notas de origen del análisis (en beats absolutos del proyecto para que la métrica sea real):
 * clipIds > trackId (todos sus clips MIDI) > captura del teclado (últimos `segundos`, 30 por defecto).
 * Si llegan `segundos` explícitos sin clipIds manda la captura (trackId solo nombra el instrumento).
 */
export function recolectarNotasToque(tienda: TiendaDAW, o: OrigenToque): Recoleccion | { error: string } {
  const st = tienda.obtenerEstado()
  const bpm = safeProjectBpm(st)
  const beatsPorCompas = compasDe(tienda)
  const tracks = st.project?.tracks ?? []
  const nombrePista = o.trackId ? tracks.find((t) => t.id === o.trackId)?.nombre : undefined
  const instrumento = o.instrumento?.trim() || nombrePista

  const clipIds = (o.clipIds ?? []).map(String).filter(Boolean)
  if (o.toma && clipIds.length === 0) {
    const t = bufferEscuchaMidi.tomaActual()
    if (!t) return { error: 'No hay ninguna toma grabada: pulsa «Grabar toma», toca, y vuelve a pulsar para terminarla' }
    const d = desdeEventos(t.eventos, { bpm, inicioNs: t.inicioNs, transporte: t.transporte })
    const fin = t.finNs ?? (typeof performance !== 'undefined' ? performance.now() * 1e6 : t.inicioNs)
    const segundos = Math.max(0, Math.round((fin - t.inicioNs) / 1e8) / 10)
    return {
      notas: d.notas,
      bpm: d.bpm,
      beatsPorCompas,
      instrumento,
      origen: { tipo: 'toma', segundos, ...(o.trackId ? { trackId: o.trackId } : {}) },
      descripcion: `la toma grabada (${segundos} s${t.finNs === undefined ? ', aún en curso' : ''}${d.transporte ? `, alineada al transporte desde el beat ${Math.round(d.transporte.posicionBeats * 100) / 100} a ${d.bpm} BPM` : ''})`,
      pedal: d.pedal,
      ...(d.transporte ? { transporte: d.transporte } : {}),
    }
  }
  const usarCaptura = clipIds.length === 0 && (o.segundos != null || !o.trackId)
  if (!usarCaptura) {
    const clips: MidiClip[] = []
    if (clipIds.length) {
      for (const t of tracks) {
        if (o.trackId && t.id !== o.trackId) continue
        for (const c of t.clips ?? []) if (clipIds.includes(c.id) && (c as MidiClip).tipo === 'midi') clips.push(c as MidiClip)
      }
      if (!clips.length) return { error: `No se encontraron clips MIDI: ${clipIds.join(', ')}` }
    } else {
      if (!tracks.some((t) => t.id === o.trackId)) return { error: `Pista no encontrada: ${o.trackId}` }
      clips.push(...clipsMidiDe(tienda, o.trackId!))
      if (!clips.length) return { error: 'La pista no tiene clips MIDI' }
    }
    const notas: NotaToque[] = clips.flatMap((c) =>
      (c.notas ?? [])
        .filter((n) => !n.mute)
        .map((n) => ({ pitch: n.pitch, inicio: Number(c.inicio) + n.inicio, duracion: n.duracion, velocidad: n.velocidad })),
    )
    return {
      notas,
      bpm,
      beatsPorCompas,
      instrumento,
      origen: { tipo: 'clips', ...(o.trackId ? { trackId: o.trackId } : {}), clipIds: clips.map((c) => c.id) },
      descripcion: `${clips.length} clip(s) MIDI`,
    }
  }

  const segundos = Math.max(1, Math.min(600, Number(o.segundos ?? 30) || 30))
  const ahora = typeof performance !== 'undefined' ? performance.now() * 1e6 : undefined
  // La captura no tiene rejilla de referencia: la primera nota se toma como tiempo fuerte.
  const d = desdeEventos(bufferEscuchaMidi.ultimos(segundos, ahora), { bpm })
  return {
    notas: d.notas,
    bpm,
    beatsPorCompas,
    instrumento,
    origen: { tipo: 'captura', segundos, ...(o.trackId ? { trackId: o.trackId } : {}) },
    descripcion: `lo tocado en los últimos ${segundos} s`,
    pedal: d.pedal,
  }
}

function aprenderDe(rec: Recoleccion, rejillaBeats?: number): PerfilToque {
  return aprenderPerfilToque(rec.notas, {
    bpm: rec.bpm,
    beatsPorCompas: rec.beatsPorCompas,
    instrumento: rec.instrumento,
    ...(rejillaBeats && rejillaBeats > 0 ? { rejillaBeats } : {}),
    ...(rec.pedal?.length ? { pedal: rec.pedal } : {}),
  })
}

const sinNotas = (rec: Recoleccion) =>
  rec.origen.tipo === 'clips' ? 'Sin notas que analizar' : `No se tocó nada en el teclado MIDI (${rec.descripcion})`

/** analysis.touch: analiza sin guardar. */
export function touchAnalyze(
  tienda: TiendaDAW,
  o: OrigenToque & { rejillaBeats?: number },
): { ok: boolean; message: string; perfil?: PerfilToque; resumen?: string } {
  const rec = recolectarNotasToque(tienda, o)
  if ('error' in rec) return { ok: false, message: rec.error }
  if (rec.notas.length === 0) return { ok: false, message: sinNotas(rec) }
  const perfil = aprenderDe(rec, o.rejillaBeats)
  const resumen = describirPerfilToque(perfil)
  return { ok: true, message: `Toque de ${rec.descripcion}:\n${resumen}`, perfil, resumen }
}

// ── analysis.performance ──────────────────────────────────────────────────────

export type AcordeTocado = {
  /** Inicio del ataque (beats, mismo eje que las notas). */
  inicio: number
  /** Pitches MIDI del ataque, de grave a agudo. */
  pitches: number[]
  velocidades: number[]
  /** Nombre cromático (p. ej. «Dm7/F») o null si no se reconoce o solo hay una nota. */
  nombre: string | null
  /** Dispersión del ataque en ms (0 = plaqué). */
  spanMs: number
}

export type DatosPerformance = {
  origen: PerfilToqueGuardado['origen']
  descripcion: string
  bpm: number
  beatsPorCompas: number
  transporte?: { posicionBeats: number; bpm: number }
  notas: number
  duracionBeats: number
  pedal: { eventos: number; medido: boolean }
  perfil: PerfilToque
  acordes: AcordeTocado[]
}

type NombrarAcorde = (pitches: readonly number[], opts?: { anotarOmisiones?: boolean }) => string | null
let nombrarAcordeCargado: NombrarAcorde | null | undefined

/** `nombrarAcorde` de la biblioteca de acordes, si está disponible (nunca rompe el análisis si falta). */
async function cargarNombrarAcorde(): Promise<NombrarAcorde | null> {
  if (nombrarAcordeCargado !== undefined) return nombrarAcordeCargado
  try {
    const m = (await import(/* @vite-ignore */ '../../../../shared/src/music/acordes')) as Record<string, unknown>
    const f = m.nombrarAcorde
    nombrarAcordeCargado = typeof f === 'function' ? (f as NombrarAcorde) : null
  } catch {
    nombrarAcordeCargado = null
  }
  return nombrarAcordeCargado
}

/** Acordes tocados: cada ataque (notas casi simultáneas) con sus pitches de grave a agudo. */
export function acordesTocados(notas: readonly NotaToque[], bpm: number, nombrar: NombrarAcorde | null, maximo = 400): AcordeTocado[] {
  const ordenadas = notasValidas(notas).map((x) => x.nota)
  const msPorBeat = 60000 / bpm
  const grupos = agruparAtaques(ordenadas.map((n) => n.inicio), msPorBeat)
  const out: AcordeTocado[] = []
  for (const g of grupos) {
    if (out.length >= maximo) break
    const ns = g.idx.map((i) => ordenadas[i]!).sort((a, b) => a.pitch - b.pitch)
    const pitches = ns.map((n) => n.pitch)
    const span = Math.max(...g.idx.map((i) => ordenadas[i]!.inicio)) - g.ancla
    let nombre: string | null = null
    if (nombrar && new Set(pitches.map((p) => p % 12)).size >= 2) {
      try {
        nombre = nombrar(pitches) ?? null
      } catch {
        nombre = null
      }
    }
    out.push({
      inicio: Math.round(g.ancla * 1000) / 1000,
      pitches,
      velocidades: ns.map((n) => Math.round(Number(n.velocidad) || 0)),
      nombre,
      spanMs: Math.round(span * msPorBeat * 10) / 10,
    })
  }
  return out
}

const NOTA = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const nombreNota = (p: number) => `${NOTA[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`

function lineaAcordes(acordes: AcordeTocado[], beatsPorCompas: number): string {
  const conNombre = acordes.filter((a) => a.nombre)
  if (!conNombre.length) return 'Acordes: no se reconocieron acordes (notas sueltas o intervalos sin nombre).'
  const vistos: string[] = []
  for (const a of conNombre) if (vistos[vistos.length - 1] !== a.nombre) vistos.push(a.nombre!)
  const compas = (b: number) => Math.floor(b / beatsPorCompas) + 1
  const primeros = conNombre.slice(0, 16).map((a) => `${a.nombre} (c. ${compas(a.inicio)}, ${a.pitches.map(nombreNota).join(' ')})`)
  return `Acordes (${conNombre.length} reconocidos, ${vistos.length} cambios): ${vistos.slice(0, 24).join(' → ')}${vistos.length > 24 ? ' …' : ''}\nPrimeros ataques: ${primeros.join(' · ')}${conNombre.length > 16 ? ' …' : ''}`
}

/**
 * analysis.performance: informe completo de una interpretación (toma actual, últimos N s, o clips):
 * el toque (micro-tiempo, dinámica, voces, manos, rubato, pedal) y los acordes tocados como pitches agrupados.
 */
export async function performanceAnalyze(
  tienda: TiendaDAW,
  o: OrigenToque & { rejillaBeats?: number },
): Promise<{ ok: boolean; message: string; informe?: string; datos?: DatosPerformance }> {
  const rec = recolectarNotasToque(tienda, o)
  if ('error' in rec) return { ok: false, message: rec.error }
  if (rec.notas.length === 0) return { ok: false, message: sinNotas(rec) }
  const perfil = aprenderDe(rec, o.rejillaBeats)
  const acordes = acordesTocados(rec.notas, rec.bpm, await cargarNombrarAcorde())
  const inicio = Math.min(...rec.notas.map((n) => n.inicio))
  const fin = Math.max(...rec.notas.map((n) => n.inicio + n.duracion))
  const duracionBeats = Math.round((fin - inicio) * 100) / 100
  const cabecera = [
    `Interpretación de ${rec.descripcion}: ${rec.notas.length} notas en ${Math.round(duracionBeats / rec.beatsPorCompas)} compases (${duracionBeats} beats a ${rec.bpm} BPM)`,
    rec.transporte ? `Alineada al transporte (beat ${Math.round(rec.transporte.posicionBeats * 100) / 100}): la métrica es la del proyecto.` : 'Sin transporte: la primera nota se toma como tiempo fuerte (la métrica es aproximada).',
    rec.pedal?.length ? `Pedal de sustain: ${rec.pedal.length} eventos CC64 capturados.` : 'Pedal de sustain: no llegó CC64 en esta captura.',
  ]
  const informe = [...cabecera, lineaAcordes(acordes, rec.beatsPorCompas), '', describirPerfilToque(perfil)].join('\n')
  const datos: DatosPerformance = {
    origen: rec.origen,
    descripcion: rec.descripcion,
    bpm: rec.bpm,
    beatsPorCompas: rec.beatsPorCompas,
    ...(rec.transporte ? { transporte: rec.transporte } : {}),
    notas: rec.notas.length,
    duracionBeats,
    pedal: { eventos: rec.pedal?.length ?? 0, medido: Boolean(perfil.pedal?.medido) },
    perfil,
    acordes,
  }
  return { ok: true, message: informe, informe, datos }
}

// ── biblioteca ────────────────────────────────────────────────────────────────

const CLAVE_LOCAL = 'jaswave.touchProfiles.v1'
let cache: PerfilToqueGuardado[] | null = null

async function rutaGlobal(): Promise<string | null> {
  if (typeof window === 'undefined' || !window.electron?.userDataPath) return null
  try {
    const base = await window.electron.userDataPath()
    return base ? `${base.replace(/[/\\]+$/, '')}/library/touch-profiles.json` : null
  } catch {
    return null
  }
}

function parsear(raw: string | null | undefined): PerfilToqueGuardado[] {
  if (!raw) return []
  try {
    const p = JSON.parse(raw) as { profiles?: PerfilToqueGuardado[] } | PerfilToqueGuardado[]
    const lista = Array.isArray(p) ? p : p?.profiles
    // Perfiles guardados con la versión 1: se completan con los campos nuevos (sin datos) al leerlos.
    return Array.isArray(lista)
      ? lista.filter((x) => x && typeof x.id === 'string' && x.perfil).map((x) => ({ ...x, perfil: normalizarPerfilToque(x.perfil) }))
      : []
  } catch {
    return []
  }
}

async function cargar(): Promise<PerfilToqueGuardado[]> {
  if (cache) return cache
  const ruta = await rutaGlobal()
  if (ruta && window.electron?.fileRead) {
    try {
      cache = parsear(await window.electron.fileRead(ruta))
      return cache
    } catch {
      /* cae a localStorage */
    }
  }
  try {
    cache = typeof localStorage !== 'undefined' ? parsear(localStorage.getItem(CLAVE_LOCAL)) : []
  } catch {
    cache = []
  }
  return cache
}

async function guardarLista(lista: PerfilToqueGuardado[]): Promise<void> {
  cache = lista
  const json = JSON.stringify({ version: 1, profiles: lista }, null, 2)
  const ruta = await rutaGlobal()
  if (ruta && window.electron?.fileSave) {
    const r = (await window.electron.fileSave(ruta, json)) as { success?: boolean; error?: string } | undefined
    if (r && r.success === false) throw new Error(r.error || `No se pudo guardar ${ruta}`)
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(CLAVE_LOCAL, json)
  } catch {
    /* cuota */
  }
}

/** Solo tests: vacía la caché en memoria. */
export function reiniciarBibliotecaToques(): void {
  cache = null
}

export async function touchList(): Promise<PerfilToqueGuardado[]> {
  return [...(await cargar())].sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function touchResolve(ref: { perfilId?: string; nombre?: string }): Promise<PerfilToqueGuardado | undefined> {
  const lista = await cargar()
  const id = ref.perfilId?.trim()
  if (id) {
    const porId = lista.find((p) => p.id === id)
    if (porId) return porId
  }
  const nombre = (ref.nombre ?? id ?? '').trim().toLowerCase()
  return nombre ? lista.find((p) => p.nombre.toLowerCase() === nombre) : undefined
}

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'toque'
}

/** style.touch.learn: analiza y guarda (mismo nombre → actualiza el perfil existente). */
export async function touchLearn(
  tienda: TiendaDAW,
  o: OrigenToque & { nombre: string; rejillaBeats?: number },
): Promise<{ ok: boolean; message: string; perfilId?: string; nombre?: string; resumen?: string; perfil?: PerfilToque }> {
  const nombre = String(o.nombre ?? '').trim().slice(0, 60)
  if (!nombre) return { ok: false, message: 'Falta nombre para guardar el toque' }
  const rec = recolectarNotasToque(tienda, o)
  if ('error' in rec) return { ok: false, message: rec.error }
  if (rec.notas.length < 4) return { ok: false, message: `Muy pocas notas para aprender el toque (${rec.notas.length}) en ${rec.descripcion}` }
  const perfil = aprenderDe(rec, o.rejillaBeats)
  const resumen = describirPerfilToque(perfil)
  const lista = await cargar()
  const previo = lista.find((p) => p.nombre.toLowerCase() === nombre.toLowerCase())
  const ahora = Date.now()
  const guardado: PerfilToqueGuardado = {
    id: previo?.id ?? `toque-${slug(nombre)}-${(hashSemilla(ahora, nombre) % 0xffffff).toString(36)}`,
    nombre,
    ...(rec.instrumento ? { instrumento: rec.instrumento } : {}),
    perfil,
    resumen,
    origen: rec.origen,
    createdAt: previo?.createdAt ?? ahora,
    updatedAt: ahora,
    version: 1,
  }
  await guardarLista(previo ? lista.map((p) => (p.id === previo.id ? guardado : p)) : [...lista, guardado])
  return {
    ok: true,
    message: `Toque «${nombre}» ${previo ? 'actualizado' : 'guardado'} (${guardado.id}) desde ${rec.descripcion}:\n${resumen}`,
    perfilId: guardado.id,
    nombre,
    resumen,
    perfil,
  }
}

/** Notas del clip con el toque aplicado (puro: no ejecuta nada). */
export function notasConToque(
  clip: MidiClip,
  perfil: PerfilToque,
  o: { bpm: number; beatsPorCompas: number; intensidad?: number; semilla?: number },
): MidiNote[] {
  return aplicarPerfilToque(clip.notas ?? [], perfil, {
    bpm: o.bpm,
    beatsPorCompas: o.beatsPorCompas,
    offsetBeats: Number(clip.inicio) || 0,
    intensidad: o.intensidad ?? 1,
    semilla: hashSemilla(o.semilla ?? 1, clip.id),
  })
}

/**
 * Aplica un perfil (ya resuelto) a los clips MIDI de una pista: un único lote `midi.notes.set` → un solo
 * paso de undo. Lo usan `style.touch.apply` y la banda (estilo del usuario tras cada músico).
 */
export async function aplicarToqueAClips(
  tienda: TiendaDAW,
  perfil: PerfilToque,
  o: { trackId: string; clipIds?: string[]; intensidad?: number; semilla?: number; nombre?: string },
): Promise<{ ok: boolean; message: string; clipIds?: string[]; notas?: number }> {
  const st = tienda.obtenerEstado()
  const pista = st.project?.tracks?.find((t) => t.id === o.trackId)
  if (!pista) return { ok: false, message: `Pista no encontrada: ${o.trackId}` }
  if ((pista as { bloqueada?: boolean }).bloqueada) return { ok: false, message: `La pista «${pista.nombre}» está bloqueada: no se toca` }
  const todos = clipsMidiDe(tienda, o.trackId)
  const filtro = o.clipIds?.length ? o.clipIds : null
  const clips = filtro ? todos.filter((c) => filtro.includes(c.id)) : todos
  if (!clips.length) return { ok: false, message: filtro ? `Clip MIDI no encontrado en la pista: ${filtro.join(', ')}` : 'La pista no tiene clips MIDI' }
  const intensidad = Math.max(0, Math.min(1, Number.isFinite(Number(o.intensidad)) ? Number(o.intensidad) : 1))
  const bpm = safeProjectBpm(st)
  const beatsPorCompas = compasDe(tienda)
  const comandos = clips
    .filter((c) => (c.notas ?? []).length > 0)
    .map((c) => ({
      type: 'midi.notes.set',
      payload: {
        pistaId: o.trackId,
        clipId: c.id,
        notas: notasConToque(c, perfil, { bpm, beatsPorCompas, intensidad, semilla: o.semilla }),
      },
    }))
  if (!comandos.length) return { ok: false, message: 'Los clips no tienen notas' }
  const r = await tienda.executor.batch(comandos)
  if (!r.success) return { ok: false, message: r.error?.message ?? 'midi.notes.set falló' }
  const notas = comandos.reduce((a, c) => a + c.payload.notas.length, 0)
  return {
    ok: true,
    message: `Toque${o.nombre ? ` «${o.nombre}»` : ''} aplicado a ${comandos.length} clip(s) (${notas} notas, intensidad ${intensidad})`,
    clipIds: comandos.map((c) => c.payload.clipId),
    notas,
  }
}

/**
 * style.touch.apply: reescribe las notas del clip (o de todos los clips MIDI de la pista) con el toque.
 * Un único lote `midi.notes.set` → un solo paso de undo.
 */
export async function touchApply(
  tienda: TiendaDAW,
  o: { perfilId?: string; nombre?: string; trackId: string; clipId?: string; clipIds?: string[]; intensidad?: number; semilla?: number },
): Promise<{ ok: boolean; message: string; clipIds?: string[]; perfilId?: string }> {
  const guardado = await touchResolve({ perfilId: o.perfilId, nombre: o.nombre })
  if (!guardado) return { ok: false, message: `Perfil de toque no encontrado: ${o.perfilId ?? o.nombre ?? '(sin perfilId/nombre)'}` }
  const clipIds = o.clipIds?.length ? o.clipIds : o.clipId ? [o.clipId] : undefined
  const r = await aplicarToqueAClips(tienda, guardado.perfil, { trackId: o.trackId, clipIds, intensidad: o.intensidad, semilla: o.semilla, nombre: guardado.nombre })
  return r.ok ? { ok: true, message: r.message, clipIds: r.clipIds, perfilId: guardado.id } : { ok: false, message: r.message }
}

export function formatTouchList(lista: PerfilToqueGuardado[], limite = 12): string {
  if (!lista.length) return '(sin perfiles de toque guardados; usa style.touch.learn)'
  return lista
    .slice(0, limite)
    .map(
      (p, i) =>
        `${i + 1}. [${p.id}] ${p.nombre}${p.instrumento ? ` · ${p.instrumento}` : ''} · ${p.perfil.muestras.notas} notas · confianza ${p.perfil.confianza}`,
    )
    .join('\n')
}
