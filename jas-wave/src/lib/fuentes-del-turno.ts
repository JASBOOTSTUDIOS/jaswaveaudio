/**
 * Fuentes consultadas en internet durante el turno de la IA (K6).
 *
 * Cada herramienta web (`web.buscar`, `web.leer`, `youtube.*`, `referencia.*`) registra aquí los enlaces que
 * usó; al cerrar el turno, quien compone la respuesta final llama a `anexarFuentesAlTexto` para garantizar la
 * lista «Fuentes:» aunque el modelo no la haya escrito. Las tarjetas del chat se dibujan a partir de esas URLs.
 */

export type FuenteDelTurno = {
  url: string
  titulo?: string
  /** Herramienta que la aportó (web.leer, youtube.ficha…). */
  herramienta: string
}

const MAX_FUENTES = 24
let fuentes: FuenteDelTurno[] = []

function normalizarUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}

/** Registra un enlace consultado (idempotente por URL; conserva el primer título no vacío). */
export function registrarFuenteDelTurno(f: FuenteDelTurno): void {
  const url = normalizarUrl(f.url)
  if (!url) return
  const previa = fuentes.find((x) => x.url === url)
  if (previa) {
    if (!previa.titulo && f.titulo) previa.titulo = f.titulo
    return
  }
  if (fuentes.length >= MAX_FUENTES) return
  fuentes.push({ url, titulo: f.titulo?.trim().slice(0, 160) || undefined, herramienta: f.herramienta })
}

export function fuentesDelTurno(): FuenteDelTurno[] {
  return fuentes.map((f) => ({ ...f }))
}

/** Vacía el registro (al empezar un turno nuevo). */
export function limpiarFuentesDelTurno(): void {
  fuentes = []
}

/** Devuelve las fuentes y vacía el registro: para consumirlas al cerrar el turno. */
export function tomarFuentesDelTurno(): FuenteDelTurno[] {
  const out = fuentesDelTurno()
  fuentes = []
  return out
}

const RE_URL = /https?:\/\/[^\s<>()"'`\][]+/g

/** URLs http(s) de un texto (sin duplicados, sin puntuación final). */
export function extraerUrls(texto: string): string[] {
  const out: string[] = []
  for (const m of String(texto ?? '').match(RE_URL) ?? []) {
    const limpia = m.replace(/[.,;:!?»”’)]+$/g, '')
    const url = normalizarUrl(limpia)
    if (url && !out.includes(url)) out.push(url)
  }
  return out
}

function hostLegible(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Bloque «Fuentes:» en Markdown (una viñeta por enlace). */
export function formatearFuentes(lista: FuenteDelTurno[]): string {
  if (!lista.length) return ''
  return ['Fuentes:', ...lista.map((f) => `- [${f.titulo || hostLegible(f.url)}](${f.url})`)].join('\n')
}

/**
 * Si el turno usó internet y la respuesta no cita ya todos los enlaces, añade la lista «Fuentes:» al final.
 * Los enlaces que el texto ya contiene no se repiten.
 */
export function anexarFuentesAlTexto(texto: string, lista: FuenteDelTurno[] = fuentesDelTurno()): string {
  if (!lista.length) return texto
  const yaCitadas = new Set(extraerUrls(texto))
  const faltan = lista.filter((f) => !yaCitadas.has(f.url))
  if (!faltan.length) return texto
  const base = String(texto ?? '').replace(/\s+$/, '')
  return `${base}${base ? '\n\n' : ''}${formatearFuentes(faltan)}`
}

/**
 * Puente para el módulo asistente (paquete aparte, no importa de `src/lib`): expone el registro en `globalThis`.
 * El módulo lo lee con `plugins/com.jaswave.modulo.asistente-ia/src/motor/turno/fuentes-turno.ts`.
 */
;(globalThis as { __jaswaveFuentesTurno?: unknown }).__jaswaveFuentesTurno = {
  limpiar: limpiarFuentesDelTurno,
  anexar: (texto: string) => anexarFuentesAlTexto(texto),
}
