/**
 * Envoltorio del renderer sobre `window.electron.webTools` (K6). La red siempre sale del proceso main; en el
 * navegador (sin Electron) solo queda el respaldo de búsqueda en Wikipedia con `fetch`.
 *
 * Todo lo que vuelve de internet es DATO no confiable: `envolverResultadoWeb` lo delimita con
 * `wrapUntrustedToolResult` y añade la instrucción de citar la fuente; además registra los enlaces en
 * `fuentes-del-turno.ts` para la lista «Fuentes:» y las tarjetas del chat.
 */

import { wrapUntrustedToolResult } from '@jaswave/ai-harness'
import { registrarFuenteDelTurno } from './fuentes-del-turno'

export type ResultadoBusqueda = { titulo: string; url: string; resumen: string; fuente: 'duckduckgo' | 'wikipedia' }
export type PaginaLeida = { url: string; titulo: string; autor?: string; fecha?: string; idioma?: string; texto: string; caracteres: number; truncado: boolean }
export type VideoYoutube = { videoId: string; titulo: string; canal: string; duracion: string; url: string }
export type CapituloYoutube = { tiempoSeg: number; titulo: string }
export type FichaYoutube = {
  videoId: string
  url: string
  titulo: string
  canal: string
  duracionSeg?: number
  descripcion: string
  capitulos: CapituloYoutube[]
  miniatura: string
  transcripcion?: string
  transcripcionIdioma?: string
  transcripcionTruncada?: boolean
}
export type ReferenciaDescargada = {
  videoId: string
  url: string
  titulo: string
  ruta: string
  sampleRate: number
  duracionSeg: number
  desdeSeg: number
  duracionTotalSeg: number
  pcm16: Int16Array
}

type RespuestaWeb<T> = { ok: true; datos: T } | { ok: false; error: string }

function webTools() {
  return typeof window !== 'undefined' ? window.electron?.webTools : undefined
}

export function internetDisponible(): boolean {
  return Boolean(webTools())
}

function desenvolver<T>(r: unknown, contexto: string): T {
  const resp = r as RespuestaWeb<T> | null | undefined
  if (!resp || typeof resp !== 'object') throw new Error(`${contexto}: respuesta vacía del proceso principal`)
  if (resp.ok) return resp.datos
  throw new Error(resp.error || `${contexto}: error desconocido`)
}

/** Respaldo sin Electron: búsqueda en Wikipedia en español. */
async function buscarWikipediaWeb(q: string, max: number): Promise<ResultadoBusqueda[]> {
  const url = `https://es.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&origin=*&srlimit=${max}&srsearch=${encodeURIComponent(q)}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Wikipedia respondió ${r.status}`)
  const json = (await r.json()) as { query?: { search?: Array<{ title?: string; snippet?: string }> } }
  return (json.query?.search ?? []).flatMap((s) =>
    typeof s.title === 'string'
      ? [{ titulo: s.title, url: `https://es.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`, resumen: String(s.snippet ?? '').replace(/<[^>]+>/g, ''), fuente: 'wikipedia' as const }]
      : [],
  )
}

export async function webBuscar(q: string, max = 8): Promise<ResultadoBusqueda[]> {
  const wt = webTools()
  const consulta = String(q ?? '').trim()
  if (consulta.length < 2) throw new Error('La búsqueda necesita al menos 2 caracteres')
  const resultados = wt ? desenvolver<ResultadoBusqueda[]>(await wt.buscar(consulta, max), 'web.buscar') : await buscarWikipediaWeb(consulta, max)
  for (const r of resultados) registrarFuenteDelTurno({ url: r.url, titulo: r.titulo, herramienta: 'web.buscar' })
  return resultados
}

export async function webLeer(url: string, maxChars?: number): Promise<PaginaLeida> {
  const wt = webTools()
  if (!wt) throw new Error('Leer páginas solo está disponible en la app de escritorio')
  const pagina = desenvolver<PaginaLeida>(await wt.leer(String(url ?? ''), maxChars), 'web.leer')
  registrarFuenteDelTurno({ url: pagina.url, titulo: pagina.titulo, herramienta: 'web.leer' })
  return pagina
}

export async function youtubeBuscar(q: string, max = 8): Promise<VideoYoutube[]> {
  const wt = webTools()
  if (!wt) throw new Error('Buscar en YouTube solo está disponible en la app de escritorio')
  const videos = desenvolver<VideoYoutube[]>(await wt.youtubeBuscar(String(q ?? ''), max), 'youtube.buscar')
  for (const v of videos) registrarFuenteDelTurno({ url: v.url, titulo: v.titulo, herramienta: 'youtube.buscar' })
  return videos
}

export async function youtubeFicha(urlOId: string): Promise<FichaYoutube> {
  const wt = webTools()
  if (!wt) throw new Error('La ficha de YouTube solo está disponible en la app de escritorio')
  const ficha = desenvolver<FichaYoutube>(await wt.youtubeFicha(String(urlOId ?? '')), 'youtube.ficha')
  registrarFuenteDelTurno({ url: ficha.url, titulo: ficha.titulo, herramienta: 'youtube.ficha' })
  return ficha
}

export async function youtubeMiniatura(videoId: string): Promise<string | null> {
  const wt = webTools()
  if (!wt) return null
  try {
    return desenvolver<string>(await wt.youtubeMiniatura(videoId), 'youtube.miniatura')
  } catch {
    return null
  }
}

export async function referenciaDescargar(url: string): Promise<ReferenciaDescargada> {
  const wt = webTools()
  if (!wt) throw new Error('Analizar referencias solo está disponible en la app de escritorio')
  const ref = desenvolver<ReferenciaDescargada>(await wt.referenciaAnalizar(String(url ?? '')), 'referencia.analizar')
  registrarFuenteDelTurno({ url: ref.url, titulo: ref.titulo, herramienta: 'referencia.analizar' })
  return ref
}

export async function referenciaEscuchar(url: string, titulo?: string): Promise<{ videoId: string }> {
  const wt = webTools()
  if (!wt) throw new Error('Escuchar referencias solo está disponible en la app de escritorio')
  const r = desenvolver<{ videoId: string }>(await wt.referenciaEscuchar(String(url ?? ''), titulo), 'referencia.escuchar')
  registrarFuenteDelTurno({ url: String(url), titulo, herramienta: 'referencia.escuchar' })
  return r
}

export async function internetPermitido(): Promise<boolean> {
  const wt = webTools()
  return wt ? Boolean(await wt.internetPermitido()) : false
}

export async function fijarInternetPermitido(activo: boolean): Promise<boolean> {
  const wt = webTools()
  if (!wt) return false
  return Boolean(await wt.fijarInternetPermitido(activo))
}

// ── Texto para el modelo ────────────────────────────────────────────────────────

export const INSTRUCCION_CITAR = 'Cita la fuente (enlace) de cada dato que uses de este resultado y termina la respuesta con una lista «Fuentes:».'

/** Delimita un resultado web como dato no confiable y añade la instrucción de citar. */
export function envolverResultadoWeb(herramienta: string, texto: string, maxChars = 16_000): string {
  return `${wrapUntrustedToolResult(herramienta, texto, maxChars)}\n${INSTRUCCION_CITAR}`
}

export function formatearBusquedaParaAgente(q: string, resultados: ResultadoBusqueda[]): string {
  if (!resultados.length) return `Sin resultados para «${q}».`
  return [`Resultados para «${q}» (${resultados.length}):`, ...resultados.map((r, i) => `${i + 1}. ${r.titulo}\n   ${r.url}${r.resumen ? `\n   ${r.resumen}` : ''}`)].join('\n')
}

export function formatearPaginaParaAgente(p: PaginaLeida): string {
  const cab = [`Página: ${p.titulo || p.url}`, `URL: ${p.url}`]
  if (p.autor) cab.push(`Autor: ${p.autor}`)
  if (p.fecha) cab.push(`Fecha: ${p.fecha}`)
  if (p.idioma) cab.push(`Idioma: ${p.idioma}`)
  cab.push(`Caracteres: ${p.caracteres}${p.truncado ? ' (texto recortado)' : ''}`)
  return `${cab.join('\n')}\n\n${p.texto}`
}

export function formatearVideosParaAgente(q: string, videos: VideoYoutube[]): string {
  if (!videos.length) return `Sin vídeos para «${q}».`
  return [`Vídeos de YouTube para «${q}» (${videos.length}):`, ...videos.map((v, i) => `${i + 1}. ${v.titulo} — ${v.canal || 'canal desconocido'}${v.duracion ? ` (${v.duracion})` : ''}\n   ${v.url}`)].join('\n')
}

function mmss(seg: number): string {
  const s = Math.round(seg)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

export function formatearFichaParaAgente(f: FichaYoutube): string {
  const lineas = [`Vídeo: ${f.titulo}`, `Canal: ${f.canal || 'desconocido'}`, `URL: ${f.url}`]
  if (f.duracionSeg) lineas.push(`Duración: ${mmss(f.duracionSeg)}`)
  if (f.capitulos.length) lineas.push(`Capítulos: ${f.capitulos.map((c) => `${mmss(c.tiempoSeg)} ${c.titulo}`).join(' · ')}`)
  if (f.descripcion) lineas.push(`Descripción:\n${f.descripcion.slice(0, 1500)}`)
  if (f.transcripcion) lineas.push(`Transcripción (${f.transcripcionIdioma ?? '?'}${f.transcripcionTruncada ? ', recortada' : ''}):\n${f.transcripcion}`)
  else lineas.push('Transcripción: no disponible')
  return lineas.join('\n')
}
