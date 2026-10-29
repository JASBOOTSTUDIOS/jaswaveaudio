/**
 * Internet para la IA del DAW (K6): búsqueda web, lectura legible de páginas, YouTube y referencias
 * musicales (audio de un vídeo medido con los analizadores del DAW).
 *
 * Solo corre en el proceso main; el renderer llega por IPC validado (`security.ts`). Reglas:
 *  - Solo http(s); se rechazan localhost, IPs privadas/de enlace local/metadata y nombres internos, también
 *    tras resolver DNS y en cada redirección (máx. 3). Tiempo de espera 15 s y 2 MB por respuesta.
 *  - Nada de `shell`: yt-dlp y ffmpeg se lanzan con `execFile` y argumentos fijos.
 *  - yt-dlp se descarga bajo demanda de las releases oficiales de GitHub (allowlist de hosts) y solo se
 *    instala si su SHA-256 coincide con el `SHA2-256SUMS` publicado, igual que ffmpeg con el catálogo.
 *  - Todo el texto que vuelve de internet es DATO: el renderer lo envuelve como no confiable (`untrusted.ts`).
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { rmSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { isIP } from 'node:net'
import * as path from 'node:path'

export const USER_AGENT = 'JasWave/0.1 (herramientas web de la IA; Windows)'
export const TIMEOUT_MS = 15_000
export const MAX_BYTES = 2 * 1024 * 1024
export const MAX_REDIRECCIONES = 3
export const MAX_CHARS_LECTURA = 20_000
export const MAX_CHARS_TRANSCRIPCION = 6_000

export type ResultadoBusqueda = { titulo: string; url: string; resumen: string; fuente: 'duckduckgo' | 'wikipedia' }
export type PaginaLeida = {
  url: string
  titulo: string
  autor?: string
  fecha?: string
  idioma?: string
  texto: string
  caracteres: number
  truncado: boolean
}
export type VideoYoutube = { videoId: string; titulo: string; canal: string; duracion: string; url: string }
export type CapituloYoutube = { tiempoSeg: number; titulo: string }
export type PistaSubtitulos = { url: string; idioma: string; automatica: boolean; nombre: string }
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

// ── Validación de URLs públicas ─────────────────────────────────────────────────

const HOST_PROHIBIDO =
  /^(localhost|ip6-localhost|ip6-loopback|metadata\.google\.internal|metadata|instance-data)$|\.(localhost|local|internal|localdomain|home\.arpa|lan|intranet)$/i

function ipv4Privada(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 0 && p[2] === 0) return true
  if (a >= 224) return true
  return false
}

/** IPs que no son de internet: loopback, privadas, enlace local, metadata de nube, multicast, mapeadas. */
export function esIpPrivada(ip: string): boolean {
  const limpia = ip.replace(/^\[|\]$/g, '').toLowerCase()
  const version = isIP(limpia)
  if (version === 4) return ipv4Privada(limpia)
  if (version !== 6) return true
  if (limpia === '::' || limpia === '::1') return true
  const mapeada = /^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(limpia)
  if (mapeada) return ipv4Privada(mapeada[1]!)
  const mapeadaHex = /^(?:0*:)*ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(limpia)
  if (mapeadaHex) {
    const hi = parseInt(mapeadaHex[1]!, 16)
    const lo = parseInt(mapeadaHex[2]!, 16)
    return ipv4Privada(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  if (/^f[cd]/.test(limpia)) return true // fc00::/7 (ULA)
  if (/^fe[89ab]/.test(limpia)) return true // fe80::/10 (enlace local)
  if (/^ff/.test(limpia)) return true // multicast
  if (/^64:ff9b:/.test(limpia)) return true // NAT64
  return false
}

/** Comprueba sintaxis y host de una URL de internet; devuelve la URL normalizada o lanza en español. */
export function validarUrlPublica(raw: unknown): URL {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Falta la URL')
  if (raw.length > 2048) throw new Error('La URL es demasiado larga')
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new Error(`URL no válida: ${raw.slice(0, 120)}`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Solo se permiten direcciones http(s): ${u.protocol}`)
  if (u.username || u.password) throw new Error('No se permiten credenciales en la URL')
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host) throw new Error('La URL no tiene host')
  if (HOST_PROHIBIDO.test(host)) throw new Error(`Host no permitido: ${host}`)
  if (isIP(host) && esIpPrivada(host)) throw new Error(`Dirección IP privada o local no permitida: ${host}`)
  return u
}

export type Resolver = (host: string) => Promise<string[]>

const resolverDns: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address)

/** Valida la URL y además que TODAS las IPs a las que resuelve el host sean públicas (anti SSRF). */
export async function validarUrlResuelta(raw: unknown, resolver: Resolver = resolverDns): Promise<URL> {
  const u = validarUrlPublica(raw)
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return u
  let ips: string[]
  try {
    ips = await resolver(host)
  } catch {
    throw new Error(`No se pudo resolver el host ${host}`)
  }
  if (!ips.length) throw new Error(`El host ${host} no resuelve a ninguna dirección`)
  for (const ip of ips) if (esIpPrivada(ip)) throw new Error(`El host ${host} apunta a una dirección privada (${ip})`)
  return u
}

// ── Descarga segura (redirecciones validadas, tope de bytes, tiempo de espera) ─

export type OpcionesFetchSeguro = {
  fetch?: typeof fetch
  resolver?: Resolver
  timeoutMs?: number
  maxBytes?: number
  maxRedirecciones?: number
  cabeceras?: Record<string, string>
  /** Si se indica, cada salto debe caer en uno de estos hosts (exacto o subdominio). */
  hostsPermitidos?: readonly string[]
  /** Si se indica, se usa en lugar de validar la URL contra IPs privadas (hosts de confianza con DNS propio). */
  binario?: boolean
  alProgreso?: (recibidos: number) => void
}

export type RespuestaSegura = {
  url: string
  status: number
  tipo: string
  cuerpo: string
  bytes: Buffer
  truncado: boolean
}

export function hostPermitido(host: string, lista: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  return lista.some((p) => h === p || h.endsWith(`.${p}`))
}

function decodificarCuerpo(bytes: Buffer, tipo: string): string {
  const m = /charset=["']?([\w-]+)/i.exec(tipo)
  const charset = (m?.[1] ?? 'utf-8').toLowerCase()
  try {
    return new TextDecoder(charset === 'iso-8859-1' || charset === 'latin1' ? 'windows-1252' : charset).decode(bytes)
  } catch {
    return bytes.toString('utf8')
  }
}

/**
 * GET con redirecciones manuales (cada destino se vuelve a validar), tiempo de espera, tope de bytes
 * (se corta y marca `truncado`) y `User-Agent` propio.
 */
export async function fetchSeguro(raw: string, o: OpcionesFetchSeguro = {}): Promise<RespuestaSegura> {
  const f = o.fetch ?? fetch
  const timeoutMs = o.timeoutMs ?? TIMEOUT_MS
  const maxBytes = o.maxBytes ?? MAX_BYTES
  const maxRedir = o.maxRedirecciones ?? MAX_REDIRECCIONES
  let actual = raw
  for (let salto = 0; ; salto++) {
    // Primero la allowlist (sin tocar la red), después sintaxis + DNS contra IPs privadas.
    const sintaxis = validarUrlPublica(actual)
    if (o.hostsPermitidos && !hostPermitido(sintaxis.hostname, o.hostsPermitidos)) {
      throw new Error(`Host fuera de la lista permitida: ${sintaxis.hostname}`)
    }
    const u = await validarUrlResuelta(actual, o.resolver)
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), timeoutMs)
    let r: Response
    try {
      r = await f(u.toString(), {
        redirect: 'manual',
        signal: ac.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json,text/plain,*/*;q=0.8', 'Accept-Language': 'es,en;q=0.7', ...o.cabeceras },
      })
    } catch (e) {
      clearTimeout(t)
      throw new Error(ac.signal.aborted ? `Tiempo de espera agotado (${Math.round(timeoutMs / 1000)} s) al pedir ${u.hostname}` : `No se pudo conectar con ${u.hostname}: ${e instanceof Error ? e.message : String(e)}`)
    }
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      clearTimeout(t)
      const destino = r.headers.get('location')
      if (!destino) throw new Error(`Redirección sin destino desde ${u.hostname}`)
      if (salto >= maxRedir) throw new Error(`Demasiadas redirecciones (más de ${maxRedir})`)
      actual = new URL(destino, u).toString()
      try {
        await r.body?.cancel()
      } catch {
        /* cuerpo ya consumido */
      }
      continue
    }
    const tipo = r.headers.get('content-type') ?? ''
    const trozos: Buffer[] = []
    let recibidos = 0
    let truncado = false
    try {
      if (r.body) {
        const lector = r.body.getReader()
        for (;;) {
          const { done, value } = await lector.read()
          if (done) break
          const resto = maxBytes - recibidos
          if (value.byteLength > resto) {
            trozos.push(Buffer.from(value.subarray(0, Math.max(0, resto))))
            recibidos = maxBytes
            truncado = true
            await lector.cancel().catch(() => undefined)
            break
          }
          trozos.push(Buffer.from(value))
          recibidos += value.byteLength
          o.alProgreso?.(recibidos)
        }
      }
    } catch (e) {
      throw new Error(ac.signal.aborted ? `Tiempo de espera agotado leyendo ${u.hostname}` : `Error leyendo la respuesta de ${u.hostname}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      clearTimeout(t)
    }
    const bytes = Buffer.concat(trozos)
    return { url: u.toString(), status: r.status, tipo, cuerpo: o.binario ? '' : decodificarCuerpo(bytes, tipo), bytes, truncado }
  }
}

// ── HTML → texto ────────────────────────────────────────────────────────────────

const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', iexcl: '¡', iquest: '¿', copy: '©', reg: '®', trade: '™', euro: '€',
  deg: '°', middot: '·', bull: '•', times: '×', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', ccedil: 'ç', Ccedil: 'Ç',
  agrave: 'à', egrave: 'è', ograve: 'ò', auml: 'ä', ouml: 'ö', szlig: 'ß', ordf: 'ª', ordm: 'º',
}

export function decodificarEntidadesHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, cuerpo: string) => {
    if (cuerpo[0] === '#') {
      const code = cuerpo[1]?.toLowerCase() === 'x' ? parseInt(cuerpo.slice(2), 16) : parseInt(cuerpo.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return ENTIDADES[cuerpo] ?? m
  })
}

/** Atributos de una etiqueta respetando comillas (un `>` dentro de `data-mw='{…}'` no cierra la etiqueta). */
const ATRIBUTOS = `(?:\\s+[^\\s=>/]+(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?)*\\s*/?`
const RE_ETIQUETA = new RegExp(`<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<!doctype[^>]*>|</?[a-zA-Z][\\w:-]*${ATRIBUTOS}>`, 'gi')

function etiquetaApertura(tag: string): string {
  return `<${tag}\\b${ATRIBUTOS}>`
}

/** Quita etiquetas, decodifica entidades y compacta espacios. */
export function quitarEtiquetas(html: string): string {
  return decodificarEntidadesHtml(html.replace(RE_ETIQUETA, ' ')).replace(/\s+/g, ' ').trim()
}

function atributoMeta(html: string, selector: RegExp): string | undefined {
  const m = selector.exec(html)
  return m ? quitarEtiquetas(m[1] ?? '') || undefined : undefined
}

function meta(html: string, clave: string): string | undefined {
  const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${clave}["'][^>]*content=["']([^"']*)["']`, 'i')
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${clave}["']`, 'i')
  return atributoMeta(html, re1) ?? atributoMeta(html, re2)
}

const BLOQUES_FUERA = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'canvas', 'video', 'audio', 'object', 'embed', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'select', 'figure']

function quitarBloques(html: string, etiquetas: string[]): string {
  let out = html
  for (const tag of etiquetas) {
    out = out.replace(new RegExp(`${etiquetaApertura(tag)}[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), ' ').replace(new RegExp(etiquetaApertura(tag), 'gi'), ' ')
  }
  return out
}

/**
 * Lector legible propio (al estilo Readability): quita scripts, estilos, navegación y formularios, prefiere
 * `<article>`/`<main>`, conserva títulos (`#`), párrafos y listas, y recorta a `maxChars`.
 */
export function extraerTextoLegible(html: string, url = '', maxChars = MAX_CHARS_LECTURA): PaginaLeida {
  const sinComentarios = html.replace(/<!--[\s\S]*?-->/g, ' ')
  const titulo = meta(sinComentarios, 'og:title') ?? atributoMeta(sinComentarios, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? ''
  const autor = meta(sinComentarios, 'author') ?? meta(sinComentarios, 'article:author') ?? /"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i.exec(sinComentarios)?.[1]
  const fecha =
    meta(sinComentarios, 'article:published_time') ??
    meta(sinComentarios, 'datePublished') ??
    meta(sinComentarios, 'date') ??
    /<time[^>]+datetime=["']([^"']+)["']/i.exec(sinComentarios)?.[1]
  const idioma = /<html[^>]+lang=["']([a-zA-Z-]+)["']/i.exec(sinComentarios)?.[1]?.toLowerCase()

  let cuerpo = quitarBloques(sinComentarios, BLOQUES_FUERA)
  const contenedor = (tag: string) => {
    const m = new RegExp(`${etiquetaApertura(tag)}([\\s\\S]*?)<\\/${tag}\\s*>`, 'i').exec(cuerpo)
    return m && quitarEtiquetas(m[1] ?? '').length >= 400 ? m[1]! : null
  }
  cuerpo = contenedor('article') ?? contenedor('main') ?? new RegExp(`${etiquetaApertura('body')}([\\s\\S]*)<\\/body>`, 'i').exec(cuerpo)?.[1] ?? cuerpo

  let texto = cuerpo
    .replace(new RegExp(`<h([1-6])\\b${ATRIBUTOS}>([\\s\\S]*?)<\\/h\\1\\s*>`, 'gi'), (_m, n: string, t: string) => `\n\n${'#'.repeat(Number(n))} ${quitarEtiquetas(t)}\n\n`)
    .replace(new RegExp(etiquetaApertura('li'), 'gi'), '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|blockquote|pre|tr|ul|ol|dl|dd|dt|td|th|h[1-6])\s*>/gi, '\n')
    .replace(new RegExp(`<(?:p|div|section|blockquote|pre|tr|table)\\b${ATRIBUTOS}>`, 'gi'), '\n')
  texto = decodificarEntidadesHtml(texto.replace(RE_ETIQUETA, ' '))
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const caracteres = texto.length
  let truncado = false
  if (texto.length > maxChars) {
    texto = `${texto.slice(0, maxChars)}\n[… recortado: ${texto.length - maxChars} caracteres omitidos]`
    truncado = true
  }
  return { url, titulo: titulo.slice(0, 300), autor: autor?.slice(0, 200), fecha: fecha?.slice(0, 60), idioma, texto, caracteres, truncado }
}

/** Lee una página pública y devuelve su texto legible. */
export async function webLeer(url: string, o: { maxChars?: number } & OpcionesFetchSeguro = {}): Promise<PaginaLeida> {
  const maxChars = Math.max(500, Math.min(MAX_CHARS_LECTURA, Number(o.maxChars ?? MAX_CHARS_LECTURA) || MAX_CHARS_LECTURA))
  const r = await fetchSeguro(url, o)
  if (r.status >= 400) throw new Error(`La página respondió ${r.status}`)
  if (/^application\/(json|ld\+json)|^text\/plain/i.test(r.tipo)) {
    const texto = r.cuerpo.length > maxChars ? `${r.cuerpo.slice(0, maxChars)}\n[… recortado]` : r.cuerpo
    return { url: r.url, titulo: new URL(r.url).hostname, texto, caracteres: r.cuerpo.length, truncado: r.cuerpo.length > maxChars }
  }
  if (r.tipo && !/html|xml/i.test(r.tipo)) throw new Error(`El contenido no es una página de texto (${r.tipo.split(';')[0]})`)
  const pagina = extraerTextoLegible(r.cuerpo, r.url, maxChars)
  if (!pagina.texto) throw new Error('La página no tiene texto legible (¿contenido solo con JavaScript?)')
  return pagina
}

// ── Búsqueda: DuckDuckGo HTML con respaldo en Wikipedia ────────────────────────

function hrefReal(href: string): string {
  const h = decodificarEntidadesHtml(href)
  const abs = h.startsWith('//') ? `https:${h}` : h
  try {
    const u = new URL(abs, 'https://duckduckgo.com')
    const uddg = u.searchParams.get('uddg')
    if (uddg && /duckduckgo\.com$/i.test(u.hostname)) return uddg
    return u.toString()
  } catch {
    return abs
  }
}

/** Parser del HTML de `html.duckduckgo.com/html/` (enlaces `result__a`, resúmenes `result__snippet`). */
export function parsearResultadosDdg(html: string, max = 8): ResultadoBusqueda[] {
  const out: ResultadoBusqueda[] = []
  const resultados = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1)
  for (const bloque of resultados) {
    if (/result--ad|y\.js\?/i.test(bloque.slice(0, 600))) continue
    const a = /<a\b([^>]*\bresult__a\b[^>]*)>([\s\S]*?)<\/a>/i.exec(bloque)
    if (!a) continue
    const href = /href="([^"]*)"/i.exec(a[1] ?? '')?.[1]
    if (!href) continue
    const url = hrefReal(href)
    if (!/^https?:\/\//i.test(url) || /duckduckgo\.com\/y\.js/i.test(url)) continue
    const titulo = quitarEtiquetas(a[2] ?? '')
    const snippet = /<(?:a|td|div|span)\b[^>]*\bresult__snippet\b[^>]*>([\s\S]*?)<\/(?:a|td|div|span)>/i.exec(bloque)
    const resumen = snippet ? quitarEtiquetas(snippet[1] ?? '') : ''
    if (!titulo) continue
    if (out.some((r) => r.url === url)) continue
    out.push({ titulo, url, resumen, fuente: 'duckduckgo' })
    if (out.length >= max) break
  }
  return out
}

/** Parser de `action=query&list=search` de la API de Wikipedia. */
export function parsearBusquedaWikipedia(json: unknown, idioma = 'es', max = 8): ResultadoBusqueda[] {
  const lista = (json as { query?: { search?: unknown[] } })?.query?.search
  if (!Array.isArray(lista)) return []
  return lista.slice(0, max).flatMap((raw) => {
    const r = raw as { title?: unknown; snippet?: unknown }
    if (typeof r.title !== 'string') return []
    return [{
      titulo: r.title,
      url: `https://${idioma}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
      resumen: typeof r.snippet === 'string' ? quitarEtiquetas(r.snippet) : '',
      fuente: 'wikipedia' as const,
    }]
  })
}

export async function webBuscar(q: string, o: { max?: number } & OpcionesFetchSeguro = {}): Promise<ResultadoBusqueda[]> {
  const consulta = String(q ?? '').trim().slice(0, 300)
  if (consulta.length < 2) throw new Error('La búsqueda necesita al menos 2 caracteres')
  const max = Math.max(1, Math.min(15, Number(o.max ?? 8) || 8))
  let resultados: ResultadoBusqueda[] = []
  try {
    const r = await fetchSeguro(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(consulta)}&kl=es-es`, o)
    if (r.status < 400) resultados = parsearResultadosDdg(r.cuerpo, max)
  } catch {
    /* se intenta Wikipedia */
  }
  if (resultados.length >= Math.min(3, max)) return resultados
  try {
    const url = `https://es.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=${max}&srsearch=${encodeURIComponent(consulta)}`
    const r = await fetchSeguro(url, o)
    if (r.status < 400) {
      const wiki = parsearBusquedaWikipedia(JSON.parse(r.cuerpo), 'es', max)
      for (const w of wiki) if (!resultados.some((x) => x.url === w.url)) resultados.push(w)
    }
  } catch {
    /* sin respaldo */
  }
  if (!resultados.length) throw new Error('Sin resultados (o sin acceso a internet ahora mismo)')
  return resultados.slice(0, max)
}

// ── YouTube ─────────────────────────────────────────────────────────────────────

export const HOSTS_YOUTUBE = ['youtube.com', 'youtube-nocookie.com', 'youtu.be', 'ytimg.com', 'googlevideo.com'] as const
const RE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** Id de vídeo desde un id suelto o cualquier forma de enlace (watch, youtu.be, shorts, embed, live, music). */
export function extraerVideoId(entrada: unknown): string | null {
  if (typeof entrada !== 'string') return null
  const s = entrada.trim()
  if (RE_VIDEO_ID.test(s)) return s
  let u: URL
  try {
    u = new URL(s.startsWith('http') ? s : `https://${s}`)
  } catch {
    return null
  }
  if (!hostPermitido(u.hostname, ['youtube.com', 'youtube-nocookie.com', 'youtu.be'])) return null
  const v = u.searchParams.get('v')
  if (v && RE_VIDEO_ID.test(v)) return v
  const m = /^\/(?:shorts|embed|live|v|e)?\/?([A-Za-z0-9_-]{11})(?:[/?#]|$)/.exec(u.pathname)
  if (m && (u.hostname.endsWith('youtu.be') || /^\/(shorts|embed|live|v|e)\//.test(u.pathname))) return m[1]!
  return null
}

export function esUrlYoutube(raw: unknown): boolean {
  return extraerVideoId(raw) !== null
}

export function urlVideoYoutube(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

export function urlEmbedYoutube(videoId: string): string {
  if (!RE_VIDEO_ID.test(videoId)) throw new Error('Id de vídeo no válido')
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&hl=es`
}

export function urlMiniaturaYoutube(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

/** Extrae el objeto JSON asignado a `nombre` (`var ytInitialData = {...};`) emparejando llaves. */
export function extraerJsonVariable(html: string, nombre: string): unknown {
  const re = new RegExp(`${nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*\\{`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const inicio = m.index + m[0].length - 1
    let nivel = 0
    let enCadena = false
    for (let i = inicio; i < html.length; i++) {
      const c = html[i]
      if (enCadena) {
        if (c === '\\') i++
        else if (c === '"') enCadena = false
        continue
      }
      if (c === '"') enCadena = true
      else if (c === '{') nivel++
      else if (c === '}') {
        nivel--
        if (nivel === 0) {
          try {
            return JSON.parse(html.slice(inicio, i + 1))
          } catch {
            break
          }
        }
      }
    }
  }
  return null
}

function textoRuns(v: unknown): string {
  const o = v as { simpleText?: unknown; runs?: Array<{ text?: unknown }> } | undefined
  if (!o) return ''
  if (typeof o.simpleText === 'string') return o.simpleText
  if (Array.isArray(o.runs)) return o.runs.map((r) => (typeof r?.text === 'string' ? r.text : '')).join('')
  return ''
}

function buscarClaves(raiz: unknown, clave: string, max: number): unknown[] {
  const out: unknown[] = []
  const pila: unknown[] = [raiz]
  let visitados = 0
  while (pila.length && out.length < max && visitados < 50_000) {
    const n = pila.pop()
    visitados++
    if (!n || typeof n !== 'object') continue
    if (Array.isArray(n)) {
      for (let i = n.length - 1; i >= 0; i--) pila.push(n[i])
      continue
    }
    const o = n as Record<string, unknown>
    if (clave in o) out.push(o[clave])
    const claves = Object.keys(o)
    for (let i = claves.length - 1; i >= 0; i--) pila.push(o[claves[i]!])
  }
  return out
}

/** `mm:ss` o `h:mm:ss` → segundos. */
export function segundosDesdeTexto(t: string): number | undefined {
  const partes = t.trim().split(':').map(Number)
  if (!partes.length || partes.some((n) => !Number.isFinite(n) || n < 0)) return undefined
  return partes.reduce((acc, n) => acc * 60 + n, 0)
}

export function formatearDuracion(seg: number | undefined): string {
  if (seg === undefined || !Number.isFinite(seg)) return ''
  const s = Math.round(seg)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** Vídeos del `ytInitialData` de la página de resultados. */
export function parsearResultadosYoutube(html: string, max = 8): VideoYoutube[] {
  const datos = extraerJsonVariable(html, 'ytInitialData')
  if (!datos) return []
  const out: VideoYoutube[] = []
  for (const raw of buscarClaves(datos, 'videoRenderer', 60)) {
    const v = raw as Record<string, unknown>
    const videoId = typeof v.videoId === 'string' ? v.videoId : ''
    if (!RE_VIDEO_ID.test(videoId) || out.some((x) => x.videoId === videoId)) continue
    const titulo = textoRuns(v.title)
    if (!titulo) continue
    const canal = textoRuns(v.ownerText) || textoRuns(v.longBylineText) || textoRuns(v.shortBylineText)
    const duracion = textoRuns(v.lengthText)
    out.push({ videoId, titulo, canal, duracion, url: urlVideoYoutube(videoId) })
    if (out.length >= max) break
  }
  return out
}

export async function youtubeBuscar(q: string, o: { max?: number } & OpcionesFetchSeguro = {}): Promise<VideoYoutube[]> {
  const consulta = String(q ?? '').trim().slice(0, 300)
  if (consulta.length < 2) throw new Error('La búsqueda necesita al menos 2 caracteres')
  const max = Math.max(1, Math.min(15, Number(o.max ?? 8) || 8))
  const r = await fetchSeguro(`https://www.youtube.com/results?search_query=${encodeURIComponent(consulta)}&hl=es&gl=ES`, {
    ...o,
    hostsPermitidos: HOSTS_YOUTUBE,
    cabeceras: { Cookie: 'CONSENT=YES+1; SOCS=CAI', ...o.cabeceras },
  })
  if (r.status >= 400) throw new Error(`YouTube respondió ${r.status}`)
  const videos = parsearResultadosYoutube(r.cuerpo, max)
  if (!videos.length) throw new Error('YouTube no devolvió resultados legibles (puede haber pedido consentimiento o cambiado el formato)')
  return videos
}

/** Capítulos a partir de las marcas `m:ss Título` de la descripción. */
export function extraerCapitulos(descripcion: string): CapituloYoutube[] {
  const out: CapituloYoutube[] = []
  for (const linea of descripcion.split(/\r?\n/)) {
    const m = /^\s*[-•*([]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:|]?\s*(.+?)\s*$/.exec(linea) ?? /^\s*(.+?)\s*[-–—:|(]\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*$/.exec(linea)
    if (!m) continue
    const [tiempo, titulo] = /^\d/.test(m[1]!) ? [m[1]!, m[2]!] : [m[2]!, m[1]!]
    const seg = segundosDesdeTexto(tiempo)
    if (seg === undefined || !titulo) continue
    out.push({ tiempoSeg: seg, titulo: titulo.slice(0, 120) })
  }
  // Un listado de capítulos empieza en 0:00 y es creciente.
  if (out.length < 2 || out[0]!.tiempoSeg !== 0) return []
  for (let i = 1; i < out.length; i++) if (out[i]!.tiempoSeg <= out[i - 1]!.tiempoSeg) return out.slice(0, i)
  return out
}

export type FichaParseada = Omit<FichaYoutube, 'transcripcion' | 'transcripcionIdioma' | 'transcripcionTruncada'> & { pistasSubtitulos: PistaSubtitulos[] }

/** Datos de la página de un vídeo (`ytInitialPlayerResponse`: detalles y pistas de subtítulos). */
export function parsearFichaYoutube(html: string, videoId: string): FichaParseada {
  const player = extraerJsonVariable(html, 'ytInitialPlayerResponse') as Record<string, unknown> | null
  const det = (player?.videoDetails ?? {}) as Record<string, unknown>
  const titulo = typeof det.title === 'string' ? det.title : meta(html, 'og:title') ?? ''
  const canal = typeof det.author === 'string' ? det.author : ''
  const lengthSeconds = Number(det.lengthSeconds)
  const descripcion = typeof det.shortDescription === 'string' ? det.shortDescription : meta(html, 'og:description') ?? ''
  const pistas: PistaSubtitulos[] = []
  const captions = (player?.captions as Record<string, unknown> | undefined)?.playerCaptionsTracklistRenderer as { captionTracks?: unknown[] } | undefined
  for (const raw of captions?.captionTracks ?? []) {
    const t = raw as Record<string, unknown>
    if (typeof t.baseUrl !== 'string' || typeof t.languageCode !== 'string') continue
    pistas.push({ url: t.baseUrl, idioma: t.languageCode, automatica: t.kind === 'asr', nombre: textoRuns(t.name) })
  }
  return {
    videoId,
    url: urlVideoYoutube(videoId),
    titulo,
    canal,
    duracionSeg: Number.isFinite(lengthSeconds) && lengthSeconds > 0 ? lengthSeconds : undefined,
    descripcion: descripcion.slice(0, 4000),
    capitulos: extraerCapitulos(descripcion),
    miniatura: urlMiniaturaYoutube(videoId),
    pistasSubtitulos: pistas,
  }
}

/** Texto plano de un `timedtext` XML (`<text start dur>…</text>`). */
export function parsearTimedText(xml: string): string {
  const partes: string[] = []
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    // El texto llega doblemente escapado (`&amp;#39;`): se decodifica dos veces y luego se quitan etiquetas.
    const t = decodificarEntidadesHtml(decodificarEntidadesHtml(m[1] ?? '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (t) partes.push(t)
  }
  return partes.join(' ')
}

/** Prefiere subtítulos humanos en español, luego inglés, luego cualquiera (automáticos al final). */
export function elegirPistaSubtitulos(pistas: PistaSubtitulos[]): PistaSubtitulos | undefined {
  const puntuar = (p: PistaSubtitulos) => (p.idioma.startsWith('es') ? 0 : p.idioma.startsWith('en') ? 10 : 20) + (p.automatica ? 5 : 0)
  return [...pistas].sort((a, b) => puntuar(a) - puntuar(b))[0]
}

export async function youtubeFicha(urlOId: string, o: OpcionesFetchSeguro & { transcripcion?: boolean } = {}): Promise<FichaYoutube> {
  const videoId = extraerVideoId(urlOId)
  if (!videoId) throw new Error('No reconozco ese enlace o id de YouTube')
  const opciones = { ...o, hostsPermitidos: HOSTS_YOUTUBE, cabeceras: { Cookie: 'CONSENT=YES+1; SOCS=CAI', ...o.cabeceras } }
  let ficha: FichaParseada | null = null
  try {
    const r = await fetchSeguro(`${urlVideoYoutube(videoId)}&hl=es`, opciones)
    if (r.status < 400) ficha = parsearFichaYoutube(r.cuerpo, videoId)
  } catch {
    /* se completa con oEmbed */
  }
  if (!ficha?.titulo) {
    const r = await fetchSeguro(`https://www.youtube.com/oembed?url=${encodeURIComponent(urlVideoYoutube(videoId))}&format=json`, opciones)
    if (r.status >= 400) throw new Error(`YouTube respondió ${r.status} para ese vídeo (¿privado o inexistente?)`)
    const oe = JSON.parse(r.cuerpo) as { title?: unknown; author_name?: unknown }
    ficha = {
      videoId,
      url: urlVideoYoutube(videoId),
      titulo: typeof oe.title === 'string' ? oe.title : ficha?.titulo ?? '',
      canal: typeof oe.author_name === 'string' ? oe.author_name : ficha?.canal ?? '',
      duracionSeg: ficha?.duracionSeg,
      descripcion: ficha?.descripcion ?? '',
      capitulos: ficha?.capitulos ?? [],
      miniatura: urlMiniaturaYoutube(videoId),
      pistasSubtitulos: ficha?.pistasSubtitulos ?? [],
    }
  }
  const { pistasSubtitulos, ...resto } = ficha
  const salida: FichaYoutube = { ...resto }
  const pista = o.transcripcion === false ? undefined : elegirPistaSubtitulos(pistasSubtitulos)
  if (pista) {
    try {
      const r = await fetchSeguro(pista.url, opciones)
      if (r.status < 400) {
        const texto = parsearTimedText(r.cuerpo)
        if (texto) {
          salida.transcripcion = texto.length > MAX_CHARS_TRANSCRIPCION ? `${texto.slice(0, MAX_CHARS_TRANSCRIPCION)} […]` : texto
          salida.transcripcionIdioma = `${pista.idioma}${pista.automatica ? ' (automática)' : ''}`
          salida.transcripcionTruncada = texto.length > MAX_CHARS_TRANSCRIPCION
        }
      }
    } catch {
      /* sin transcripción */
    }
  }
  return salida
}

/** Miniatura del vídeo como `data:` URL (la CSP del renderer no admite imágenes externas). */
export async function youtubeMiniatura(videoId: string, o: OpcionesFetchSeguro = {}): Promise<string> {
  if (!RE_VIDEO_ID.test(videoId)) throw new Error('Id de vídeo no válido')
  const r = await fetchSeguro(urlMiniaturaYoutube(videoId), { ...o, binario: true, maxBytes: 512 * 1024, hostsPermitidos: HOSTS_YOUTUBE })
  if (r.status >= 400 || r.truncado) throw new Error('No hay miniatura')
  return `data:${r.tipo.split(';')[0] || 'image/jpeg'};base64,${r.bytes.toString('base64')}`
}

// ── yt-dlp bajo demanda (releases oficiales de GitHub, SHA-256 publicado) ───────

export const HOSTS_DESCARGA_YTDLP = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'githubusercontent.com'] as const
export const URL_SUMAS_YTDLP = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS'
export const URL_BINARIO_YTDLP = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
const MAX_BYTES_YTDLP = 80 * 1024 * 1024

export function carpetaYtDlp(localAppData: string): string {
  return path.join(localAppData, 'JasWave', 'tools', 'yt-dlp')
}

export function binarioYtDlp(localAppData: string, plataforma: NodeJS.Platform = process.platform): string {
  return path.join(carpetaYtDlp(localAppData), plataforma === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
}

/** `SHA2-256SUMS`: líneas `<sha256>  <archivo>`. */
export function parsearSumasSha256(texto: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/.exec(linea.trim())
    if (m) out.set(m[2]!, m[1]!.toLowerCase())
  }
  return out
}

function ejecutar(bin: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' · ').slice(0, 400)))
      else resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

export function probarYtDlp(bin: string): Promise<boolean> {
  return ejecutar(bin, ['--version'], 20_000).then(() => true, () => false)
}

export type YtDlpResuelto = { ruta: string; origen: 'jaswave' | 'entorno' | 'path' }

/** Orden: el descargado por JasWave, `JASWAVE_YTDLP` (desarrollo) y el del PATH. */
export async function resolverYtDlp(o: { localAppData: string; env?: Record<string, string | undefined>; probar?: (bin: string) => Promise<boolean> }): Promise<YtDlpResuelto | null> {
  const probar = o.probar ?? probarYtDlp
  const propio = binarioYtDlp(o.localAppData)
  if (await probar(propio)) return { ruta: propio, origen: 'jaswave' }
  const env = o.env?.JASWAVE_YTDLP
  if (env && (await probar(env))) return { ruta: env, origen: 'entorno' }
  if (await probar('yt-dlp')) return { ruta: 'yt-dlp', origen: 'path' }
  return null
}

/**
 * Descarga `yt-dlp.exe` de la última release oficial y lo instala solo si su SHA-256 coincide con el
 * `SHA2-256SUMS` publicado junto a ella. Reemplazo atómico; deja `instalacion.json`.
 */
export async function instalarYtDlp(o: { localAppData: string; fetch?: typeof fetch; alProgreso?: (recibidos: number, total?: number) => void }): Promise<string> {
  if (process.platform !== 'win32') throw new Error('La descarga automática de yt-dlp solo está disponible en Windows')
  const comun = { fetch: o.fetch, hostsPermitidos: HOSTS_DESCARGA_YTDLP, maxRedirecciones: 5, timeoutMs: 120_000 }
  const sumas = await fetchSeguro(URL_SUMAS_YTDLP, { ...comun, maxBytes: 64 * 1024 })
  if (sumas.status >= 400) throw new Error(`GitHub respondió ${sumas.status} al pedir las sumas de yt-dlp`)
  const esperado = parsearSumasSha256(sumas.cuerpo).get('yt-dlp.exe')
  if (!esperado) throw new Error('SHA2-256SUMS no incluye yt-dlp.exe')
  const bin = await fetchSeguro(URL_BINARIO_YTDLP, { ...comun, binario: true, maxBytes: MAX_BYTES_YTDLP, alProgreso: (r) => o.alProgreso?.(r) })
  if (bin.status >= 400) throw new Error(`GitHub respondió ${bin.status} al descargar yt-dlp`)
  if (bin.truncado) throw new Error('yt-dlp es mayor de lo esperado; descarga rechazada')
  const sha = createHash('sha256').update(bin.bytes).digest('hex')
  if (sha !== esperado) throw new Error('La huella SHA-256 de yt-dlp no coincide con la publicada: no se instala')
  const carpeta = carpetaYtDlp(o.localAppData)
  await fs.mkdir(carpeta, { recursive: true })
  const destino = binarioYtDlp(o.localAppData)
  const nuevo = `${destino}.nuevo`
  await fs.writeFile(nuevo, bin.bytes)
  await fs.rm(destino, { force: true })
  await fs.rename(nuevo, destino)
  await fs.writeFile(path.join(carpeta, 'instalacion.json'), JSON.stringify({ origen: URL_BINARIO_YTDLP, sha256: sha, instaladoEn: new Date().toISOString() }, null, 2))
  return destino
}

// ── Audio de referencia: WAV mono 22 050 Hz de hasta 90 s desde el tramo más denso ─

export const SR_REFERENCIA = 22_050
export const MAX_SEG_REFERENCIA = 90
const MAX_SEG_DECODIFICAR = 15 * 60

/** Cabecera RIFF + PCM 16 bits mono. */
export function wavMono16(pcm: Int16Array, sampleRate: number): Buffer {
  const datos = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const cab = Buffer.alloc(44)
  cab.write('RIFF', 0)
  cab.writeUInt32LE(36 + datos.length, 4)
  cab.write('WAVE', 8)
  cab.write('fmt ', 12)
  cab.writeUInt32LE(16, 16)
  cab.writeUInt16LE(1, 20)
  cab.writeUInt16LE(1, 22)
  cab.writeUInt32LE(sampleRate, 24)
  cab.writeUInt32LE(sampleRate * 2, 28)
  cab.writeUInt16LE(2, 32)
  cab.writeUInt16LE(16, 34)
  cab.write('data', 36)
  cab.writeUInt32LE(datos.length, 40)
  return Buffer.concat([cab, datos])
}

/** Lee un WAV PCM 16 bits mono (recorre los chunks `fmt ` y `data`). */
export function parsearWavMono16(buf: Buffer): { sampleRate: number; pcm: Int16Array } {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('No es un WAV')
  let pos = 12
  let sampleRate = 0
  let canales = 0
  let bits = 0
  let datos: Buffer | null = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const tam = buf.readUInt32LE(pos + 4)
    const ini = pos + 8
    if (id === 'fmt ') {
      canales = buf.readUInt16LE(ini + 2)
      sampleRate = buf.readUInt32LE(ini + 4)
      bits = buf.readUInt16LE(ini + 14)
    } else if (id === 'data') {
      datos = buf.subarray(ini, Math.min(buf.length, ini + tam))
      break
    }
    pos = ini + tam + (tam % 2)
  }
  if (!datos || canales !== 1 || bits !== 16 || !sampleRate) throw new Error('El WAV debe ser mono de 16 bits')
  const alineado = datos.length - (datos.length % 2)
  const pcm = new Int16Array(alineado / 2)
  for (let i = 0; i < pcm.length; i++) pcm[i] = datos.readInt16LE(i * 2)
  return { sampleRate, pcm }
}

/** Segundo de inicio de la ventana de `ventanaSeg` con más energía (RMS por bloques de 1 s). */
export function ventanaMasDensa(pcm: ArrayLike<number>, sampleRate: number, ventanaSeg: number): number {
  const totalSeg = Math.floor(pcm.length / sampleRate)
  if (totalSeg <= ventanaSeg) return 0
  const energia: number[] = []
  for (let s = 0; s < totalSeg; s++) {
    let acc = 0
    const ini = s * sampleRate
    for (let i = ini; i < ini + sampleRate; i++) {
      const v = pcm[i] ?? 0
      acc += v * v
    }
    energia.push(acc)
  }
  let suma = 0
  for (let i = 0; i < ventanaSeg; i++) suma += energia[i]!
  let mejor = suma
  let inicio = 0
  for (let s = 1; s + ventanaSeg <= totalSeg; s++) {
    suma += energia[s + ventanaSeg - 1]! - energia[s - 1]!
    if (suma > mejor) {
      mejor = suma
      inicio = s
    }
  }
  return inicio
}

export function float32DesdePcm16(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i]! / 32768
  return out
}

export type ReferenciaAudio = {
  videoId: string
  url: string
  titulo: string
  ruta: string
  sampleRate: number
  duracionSeg: number
  desdeSeg: number
  duracionTotalSeg: number
  pcm: Int16Array
}

export type OpcionesReferencia = {
  carpeta: string
  ytDlp: string
  ffmpeg: string
  maxSeg?: number
  timeoutMs?: number
  alProgreso?: (fase: 'descargando' | 'extrayendo' | 'listo', detalle?: string) => void
}

/**
 * Descarga el audio del vídeo con yt-dlp (sin shell, argumentos fijos), lo decodifica con ffmpeg a WAV
 * mono 22 050 Hz (máx. 15 min) y guarda el tramo de hasta `maxSeg` segundos más denso en `carpeta`.
 */
export async function extraerReferenciaAudio(urlOId: string, o: OpcionesReferencia): Promise<ReferenciaAudio> {
  const videoId = extraerVideoId(urlOId)
  if (!videoId) throw new Error('La referencia debe ser un enlace o id de YouTube')
  const maxSeg = Math.max(10, Math.min(MAX_SEG_REFERENCIA, o.maxSeg ?? MAX_SEG_REFERENCIA))
  const timeoutMs = o.timeoutMs ?? 240_000
  await fs.mkdir(o.carpeta, { recursive: true })
  const base = path.join(o.carpeta, `descarga-${videoId}`)
  o.alProgreso?.('descargando')
  const { stdout } = await ejecutar(
    o.ytDlp,
    [
      '--no-playlist', '--no-warnings', '--no-progress', '--no-simulate', '--no-cache-dir', '--no-mtime',
      '--max-filesize', '150m', '--socket-timeout', '30', '--retries', '2',
      '-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '--ffmpeg-location', path.dirname(o.ffmpeg),
      '-o', `${base}.%(ext)s`,
      '--print', 'title', '--print', 'after_move:filepath',
      '--', videoId,
    ],
    timeoutMs,
  )
  const lineas = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const archivo = lineas.find((l) => l.startsWith(base)) ?? lineas[lineas.length - 1]
  const titulo = lineas.find((l) => !l.startsWith(base)) ?? videoId
  if (!archivo) throw new Error('yt-dlp no indicó el archivo descargado')
  const completo = path.join(o.carpeta, `completo-${videoId}.wav`)
  try {
    o.alProgreso?.('extrayendo')
    await ejecutar(
      o.ffmpeg,
      ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', archivo, '-t', String(MAX_SEG_DECODIFICAR), '-vn', '-ac', '1', '-ar', String(SR_REFERENCIA), '-c:a', 'pcm_s16le', '-f', 'wav', completo],
      timeoutMs,
    )
    const { sampleRate, pcm } = parsearWavMono16(await fs.readFile(completo))
    if (pcm.length < sampleRate) throw new Error('El audio descargado está vacío o dura menos de 1 s')
    const desdeSeg = ventanaMasDensa(pcm, sampleRate, maxSeg)
    const recorte = pcm.subarray(desdeSeg * sampleRate, Math.min(pcm.length, (desdeSeg + maxSeg) * sampleRate))
    const ruta = path.join(o.carpeta, `referencia-${videoId}.wav`)
    await fs.writeFile(ruta, wavMono16(recorte, sampleRate))
    o.alProgreso?.('listo')
    return {
      videoId,
      url: urlVideoYoutube(videoId),
      titulo,
      ruta,
      sampleRate,
      duracionSeg: recorte.length / sampleRate,
      desdeSeg,
      duracionTotalSeg: pcm.length / sampleRate,
      pcm: new Int16Array(recorte),
    }
  } finally {
    await fs.rm(archivo, { force: true }).catch(() => undefined)
    await fs.rm(completo, { force: true }).catch(() => undefined)
  }
}

/** Carpeta temporal de referencias: se vacía al cerrar la app. */
export class GestorTemporalesReferencia {
  constructor(readonly carpeta: string) {}
  async preparar(): Promise<string> {
    await fs.mkdir(this.carpeta, { recursive: true })
    return this.carpeta
  }
  limpiar(): void {
    try {
      rmSync(this.carpeta, { recursive: true, force: true })
    } catch {
      /* ya no existe */
    }
  }
}

// ── Límite de peticiones ────────────────────────────────────────────────────────

/** Ventana deslizante: como mucho `max` peticiones por `ventanaMs`. */
export class LimitadorPeticiones {
  private marcas: number[] = []
  constructor(private readonly max = 30, private readonly ventanaMs = 60_000, private readonly ahora: () => number = () => Date.now()) {}
  permitir(): boolean {
    const t = this.ahora()
    this.marcas = this.marcas.filter((m) => t - m < this.ventanaMs)
    if (this.marcas.length >= this.max) return false
    this.marcas.push(t)
    return true
  }
  get restantes(): number {
    const t = this.ahora()
    return Math.max(0, this.max - this.marcas.filter((m) => t - m < this.ventanaMs).length)
  }
}
