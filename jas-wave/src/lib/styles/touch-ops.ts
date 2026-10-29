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
  aplicarPerfilToque,
  aprenderPerfilToque,
  describirPerfilToque,
  hashSemilla,
  safeProjectBpm,
  type NotaToque,
  type PerfilToque,
} from '../../../../shared/src'
import type { TiendaDAW } from '../../../../shared/src/state/tienda'
import { bufferEscuchaMidi, notasDeEventos } from '../midi-example-analyzer'

export type PerfilToqueGuardado = {
  id: string
  nombre: string
  instrumento?: string
  perfil: PerfilToque
  /** Informe legible (para el prompt / UI). */
  resumen: string
  origen: { tipo: 'clips' | 'captura'; trackId?: string; clipIds?: string[]; segundos?: number }
  createdAt: number
  updatedAt: number
  version: 1
}

export type OrigenToque = {
  trackId?: string
  clipIds?: string[]
  segundos?: number
  instrumento?: string
}

type Recoleccion = {
  notas: NotaToque[]
  bpm: number
  beatsPorCompas: number
  instrumento?: string
  origen: PerfilToqueGuardado['origen']
  descripcion: string
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
  const escuchadas = notasDeEventos(bufferEscuchaMidi.ultimos(segundos, ahora))
  const origen0 = escuchadas[0]?.inicioMs ?? 0
  const msPorBeat = 60000 / bpm
  // La captura no tiene rejilla de referencia: la primera nota se toma como tiempo fuerte.
  const notas: NotaToque[] = escuchadas.map((n) => ({
    pitch: n.pitch,
    inicio: (n.inicioMs - origen0) / msPorBeat,
    duracion: n.duracionMs / msPorBeat,
    velocidad: n.velocity,
  }))
  return {
    notas,
    bpm,
    beatsPorCompas,
    instrumento,
    origen: { tipo: 'captura', segundos, ...(o.trackId ? { trackId: o.trackId } : {}) },
    descripcion: `lo tocado en los últimos ${segundos} s`,
  }
}

/** analysis.touch: analiza sin guardar. */
export function touchAnalyze(
  tienda: TiendaDAW,
  o: OrigenToque & { rejillaBeats?: number },
): { ok: boolean; message: string; perfil?: PerfilToque; resumen?: string } {
  const rec = recolectarNotasToque(tienda, o)
  if ('error' in rec) return { ok: false, message: rec.error }
  if (rec.notas.length === 0) {
    return { ok: false, message: rec.origen.tipo === 'captura' ? `No se tocó nada en el teclado MIDI (${rec.descripcion})` : 'Sin notas que analizar' }
  }
  const perfil = aprenderPerfilToque(rec.notas, {
    bpm: rec.bpm,
    beatsPorCompas: rec.beatsPorCompas,
    instrumento: rec.instrumento,
    ...(o.rejillaBeats && o.rejillaBeats > 0 ? { rejillaBeats: o.rejillaBeats } : {}),
  })
  const resumen = describirPerfilToque(perfil)
  return { ok: true, message: `Toque de ${rec.descripcion}:\n${resumen}`, perfil, resumen }
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
    return Array.isArray(lista) ? lista.filter((x) => x && typeof x.id === 'string' && x.perfil) : []
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
  const perfil = aprenderPerfilToque(rec.notas, {
    bpm: rec.bpm,
    beatsPorCompas: rec.beatsPorCompas,
    instrumento: rec.instrumento,
    ...(o.rejillaBeats && o.rejillaBeats > 0 ? { rejillaBeats: o.rejillaBeats } : {}),
  })
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
 * style.touch.apply: reescribe las notas del clip (o de todos los clips MIDI de la pista) con el toque.
 * Un único lote `midi.notes.set` → un solo paso de undo.
 */
export async function touchApply(
  tienda: TiendaDAW,
  o: { perfilId?: string; nombre?: string; trackId: string; clipId?: string; clipIds?: string[]; intensidad?: number; semilla?: number },
): Promise<{ ok: boolean; message: string; clipIds?: string[]; perfilId?: string }> {
  const guardado = await touchResolve({ perfilId: o.perfilId, nombre: o.nombre })
  if (!guardado) return { ok: false, message: `Perfil de toque no encontrado: ${o.perfilId ?? o.nombre ?? '(sin perfilId/nombre)'}` }
  const st = tienda.obtenerEstado()
  if (!st.project?.tracks?.some((t) => t.id === o.trackId)) return { ok: false, message: `Pista no encontrada: ${o.trackId}` }
  const todos = clipsMidiDe(tienda, o.trackId)
  const filtro = o.clipIds?.length ? o.clipIds : o.clipId ? [o.clipId] : null
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
        notas: notasConToque(c, guardado.perfil, { bpm, beatsPorCompas, intensidad, semilla: o.semilla }),
      },
    }))
  if (!comandos.length) return { ok: false, message: 'Los clips no tienen notas' }
  const r = await tienda.executor.batch(comandos)
  if (!r.success) return { ok: false, message: r.error?.message ?? 'midi.notes.set falló' }
  const notas = comandos.reduce((a, c) => a + c.payload.notas.length, 0)
  return {
    ok: true,
    message: `Toque «${guardado.nombre}» aplicado a ${comandos.length} clip(s) (${notas} notas, intensidad ${intensidad})`,
    clipIds: comandos.map((c) => c.payload.clipId),
    perfilId: guardado.id,
  }
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
