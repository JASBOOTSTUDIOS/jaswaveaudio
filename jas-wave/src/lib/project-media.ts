/**
 * Servicio de media del proyecto (U4).
 *
 * Reglas:
 *  - Todo audio importado o grabado se COPIA dentro de la carpeta del proyecto
 *    (`<proyecto>/media/`), nunca se referencia por ruta absoluta del original.
 *  - Sin proyecto guardado, el archivo va a `userData/media/pending/` y se mueve
 *    a `<proyecto>/media/` en el primer guardado.
 *  - En el proyecto se guarda la ruta RELATIVA (`media/<nombre>`), así el mismo
 *    proyecto funciona en otra carpeta, otro disco u otro equipo.
 */

import {
  MEDIA_PENDING_REL_DIR,
  MEDIA_REL_DIR,
  MEDIA_RECORDINGS_REL_DIR,
  esRutaMediaRelativa,
  normalizarRutaRelativa,
} from '../../../shared/src/project/ciclo-vida'

export { esRutaMediaRelativa, normalizarRutaRelativa }

/** Extensiones de audio que JasWave puede importar. */
export const EXTENSIONES_AUDIO = ['.wav', '.aif', '.aiff', '.flac', '.mp3', '.ogg', '.m4a'] as const

/** Aviso a partir de esta duración (minutos). */
export const AVISO_DURACION_MIN = 20
/** Rechazo a partir de esta duración (horas). */
export const RECHAZO_DURACION_HORAS = 2
/** Rechazo a partir de este tamaño (bytes). */
export const RECHAZO_TAMANO_BYTES = 2 * 1024 * 1024 * 1024

export type NivelValidacionImport = 'ok' | 'aviso' | 'error'

export type ResultadoValidacionImport = {
  nivel: NivelValidacionImport
  mensaje?: string
}

/** Extensión en minúsculas (con punto) de una ruta o nombre de archivo. */
export function extensionAudio(ruta: string): string {
  const limpio = ruta.replace(/[?#].*$/, '')
  const base = limpio.replace(/\\/g, '/').split('/').pop() ?? limpio
  const i = base.lastIndexOf('.')
  if (i <= 0) return ''
  return base.slice(i).toLowerCase()
}

/** ¿La extensión es una de las que JasWave puede importar? */
export function esExtensionAudioSoportada(ruta: string): boolean {
  return (EXTENSIONES_AUDIO as readonly string[]).includes(extensionAudio(ruta))
}

/**
 * Valida un archivo antes de importarlo: extensión, tamaño y duración.
 * `duracionSec` es opcional (aún no se ha decodificado).
 */
export function validarImportacionAudio(opts: {
  ruta: string
  tamanoBytes?: number
  duracionSec?: number
}): ResultadoValidacionImport {
  if (!esExtensionAudioSoportada(opts.ruta)) {
    const ext = extensionAudio(opts.ruta)
    return {
      nivel: 'error',
      mensaje: ext
        ? `Formato no soportado (${ext}). Importa WAV, AIFF, FLAC, MP3, OGG o M4A.`
        : 'El archivo no tiene extensión de audio. Importa WAV, AIFF, FLAC, MP3, OGG o M4A.',
    }
  }
  if (typeof opts.tamanoBytes === 'number' && opts.tamanoBytes > RECHAZO_TAMANO_BYTES) {
    return {
      nivel: 'error',
      mensaje: 'El archivo supera el límite de 2 GB. Divídelo o conviértelo a un formato con compresión.',
    }
  }
  if (typeof opts.duracionSec === 'number') {
    const horas = opts.duracionSec / 3600
    if (horas > RECHAZO_DURACION_HORAS) {
      return {
        nivel: 'error',
        mensaje: 'El archivo dura más de 2 horas. Importa solo el fragmento que necesites.',
      }
    }
    const minutos = opts.duracionSec / 60
    if (minutos > AVISO_DURACION_MIN) {
      return {
        nivel: 'aviso',
        mensaje: `El archivo dura ${Math.round(minutos)} min: el proyecto puede volverse pesado.`,
      }
    }
  }
  return { nivel: 'ok' }
}

/** Nombre de archivo seguro (sin separadores ni caracteres de control). */
export function sanitizarNombreArchivo(nombre: string): string {
  const base = (nombre || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '')
    .trim()
  return base || 'audio'
}

/**
 * Nombre único dentro de `media/`: `intro.wav` → `intro (2).wav` si ya existe.
 */
export function nombreUnicoMedia(nombre: string, existentes: Iterable<string>): string {
  const seguro = sanitizarNombreArchivo(nombre)
  const ext = extensionAudio(seguro)
  const base = ext ? seguro.slice(0, seguro.length - ext.length) : seguro
  const tomados = new Set<string>()
  for (const e of existentes) tomados.add(e.toLowerCase())
  if (!tomados.has(seguro.toLowerCase())) return seguro
  for (let i = 2; i < 10000; i++) {
    const cand = `${base} (${i})${ext}`
    if (!tomados.has(cand.toLowerCase())) return cand
  }
  return `${base}-${Date.now().toString(36)}${ext}`
}

/** Ruta relativa de un archivo dentro de `media/`. */
export function rutaRelativaMedia(nombreArchivo: string): string {
  return `${MEDIA_REL_DIR}/${sanitizarNombreArchivo(nombreArchivo)}`
}

/** Ruta relativa de un archivo pendiente (sin proyecto). */
export function rutaRelativaPendiente(nombreArchivo: string): string {
  return `${MEDIA_PENDING_REL_DIR}/${sanitizarNombreArchivo(nombreArchivo)}`
}

/** ¿La ruta relativa apunta a media pendiente de mover al proyecto? */
export function esRutaMediaPendiente(ruta: string | undefined | null): boolean {
  if (!ruta) return false
  const n = normalizarRutaRelativa(ruta)
  return n === MEDIA_PENDING_REL_DIR || n.startsWith(`${MEDIA_PENDING_REL_DIR}/`)
}

/** ¿La ruta relativa apunta a una grabación? */
export function esRutaMediaGrabacion(ruta: string | undefined | null): boolean {
  if (!ruta) return false
  const n = normalizarRutaRelativa(ruta)
  return n === MEDIA_RECORDINGS_REL_DIR || n.startsWith(`${MEDIA_RECORDINGS_REL_DIR}/`)
}

export type ResultadoCopiaMedia = {
  ok: boolean
  /** Ruta absoluta del archivo copiado. */
  ruta?: string
  /** Ruta relativa dentro del proyecto (`media/<nombre>`). */
  rutaRelativa?: string
  error?: string
}

export type OpcionesImportarMedia = {
  /** Ruta absoluta del archivo origen. */
  src: string
  /** Carpeta del proyecto (absoluta). Si no hay, se usa `media/pending/`. */
  carpetaProyecto?: string | null
  /** Carpeta de pendientes (userData/media/pending). */
  carpetaPendiente?: string | null
  /** Nombre forzado del archivo en destino. */
  nombre?: string
}

function unirCarpeta(base: string, rel: string): string {
  const limpio = base.replace(/[/\\]+$/, '')
  const sep = limpio.includes('\\') && !limpio.includes('/') ? '\\' : '/'
  return `${limpio}${sep}${rel.replace(/\\/g, sep)}`
}

/**
 * Copia el archivo al media del proyecto (o a `media/pending/` si todavía no
 * hay proyecto) y devuelve la ruta RELATIVA que se guarda en el clip.
 *
 * La copia la hace main (`media-copy`): el renderer no escribe en disco.
 */
export async function importMediaFile(opts: OpcionesImportarMedia): Promise<ResultadoCopiaMedia> {
  const api = window.electron
  if (!api?.mediaCopy) {
    return { ok: false, error: 'Copia de media no disponible (se requiere Electron)' }
  }
  const nombre = opts.nombre ?? sanitizarNombreArchivo(opts.src.replace(/\\/g, '/').split('/').pop() ?? 'audio')
  const hayProyecto = Boolean(opts.carpetaProyecto)
  const base = hayProyecto ? (opts.carpetaProyecto as string) : opts.carpetaPendiente
  if (!base) {
    return { ok: false, error: 'No hay carpeta de destino para el media (guarda el proyecto primero)' }
  }
  // Con proyecto: `<proyecto>/media/`. Sin proyecto: la carpeta `media/pending/` ya absoluta.
  const destinoDir = hayProyecto ? unirCarpeta(base, MEDIA_REL_DIR) : base
  try {
    const res = await api.mediaCopy({ src: opts.src, destDir: destinoDir, nombre })
    if (!res?.ok) {
      return { ok: false, error: res?.error ?? 'No se pudo copiar el archivo al proyecto' }
    }
    const rutaRelativa = hayProyecto
      ? rutaRelativaMedia(res.nombre ?? nombre)
      : rutaRelativaPendiente(res.nombre ?? nombre)
    return { ok: true, ruta: res.ruta, rutaRelativa }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Ruta ABSOLUTA de un `sourceId` guardado en el proyecto.
 * - Absoluta → se usa tal cual (media grabado en userData, proyectos antiguos).
 * - Relativa (`media/...`) → se resuelve contra la carpeta del proyecto.
 */
export function resolverRutaMedia(sourceId: string, carpetaProyecto?: string | null): string | null {
  if (!sourceId) return null
  const norm = normalizarRutaRelativa(sourceId)
  if (/^[a-zA-Z]:\//.test(norm) || norm.startsWith('/')) return sourceId
  if (!esRutaMediaRelativa(norm)) return null
  if (!carpetaProyecto) return null
  return unirCarpeta(carpetaProyecto, norm)
}

/**
 * Nombres que ya existen en `media/` (para generar nombres únicos sin
 * preguntar al disco): se deducen de las rutas relativas del proyecto.
 */
export function nombresMediaEnProyecto(rutasRelativas: Iterable<string>): string[] {
  const out: string[] = []
  for (const r of rutasRelativas) {
    if (!esRutaMediaRelativa(r)) continue
    const n = normalizarRutaRelativa(r).split('/').pop()
    if (n) out.push(n)
  }
  return out
}

/** Carpeta que contiene el archivo de proyecto (`C:\proj\canción.jaswave` → `C:\proj`). */
export function carpetaDeProyecto(rutaProyecto: string | undefined | null): string | null {
  if (!rutaProyecto) return null
  const limpio = rutaProyecto.replace(/[\\/]+$/, '')
  const i = Math.max(limpio.lastIndexOf('/'), limpio.lastIndexOf('\\'))
  if (i <= 0) return null
  return limpio.slice(0, i)
}

/** Carpeta `media/` del proyecto. */
export function carpetaMediaProyecto(rutaProyecto: string | undefined | null): string | null {
  const base = carpetaDeProyecto(rutaProyecto)
  return base ? unirCarpeta(base, MEDIA_REL_DIR) : null
}

/** Carpeta de media pendiente (`userData/media/pending`). */
export async function carpetaMediaPendiente(): Promise<string | null> {
  const userData = await window.electron?.userDataPath?.()
  if (!userData) return null
  return unirCarpeta(userData, MEDIA_PENDING_REL_DIR)
}

/** Rutas relativas de todos los clips de audio del proyecto. */
export function rutasMediaDeProyecto(proyecto: {
  tracks?: Array<{ clips?: Array<{ source?: { ruta?: string } }> }>
} | null | undefined): string[] {
  const out: string[] = []
  for (const pista of proyecto?.tracks ?? []) {
    for (const clip of pista.clips ?? []) {
      const ruta = clip.source?.ruta
      if (ruta) out.push(ruta)
    }
  }
  return out
}

export type ClipConMedia = {
  pistaId: string
  clipId: string
  ruta: string
}

/** Clips cuyo audio está en `media/pending/` (aún sin proyecto). */
export function clipsConMediaPendiente(proyecto: {
  tracks?: Array<{ id: string; clips?: Array<{ id: string; source?: { ruta?: string } }> }>
} | null | undefined): ClipConMedia[] {
  const out: ClipConMedia[] = []
  for (const pista of proyecto?.tracks ?? []) {
    for (const clip of pista.clips ?? []) {
      const ruta = clip.source?.ruta
      if (ruta && esRutaMediaPendiente(ruta)) out.push({ pistaId: pista.id, clipId: clip.id, ruta })
    }
  }
  return out
}

/**
 * Copia un archivo arrastrado desde el explorador al media del proyecto.
 * Si no hay ruta real (navegador o archivo virtual), no copia: el clip usará
 * la clave de buffer en memoria.
 */
export async function copiarAudioAlProyecto(
  file: File,
  rutaProyecto?: string | null,
): Promise<{ rutaRelativa?: string; rutaAbsoluta?: string; error?: string }> {
  const rutaReal = window.electron?.pathForFile?.(file)
  if (!rutaReal) return {}
  const carpetaProyecto = carpetaDeProyecto(rutaProyecto)
  const carpetaPendiente = await carpetaMediaPendiente()
  const res = await importMediaFile({
    src: rutaReal,
    carpetaProyecto,
    carpetaPendiente,
    nombre: file.name,
  })
  if (!res.ok) return { error: res.error }
  return { rutaRelativa: res.rutaRelativa, rutaAbsoluta: res.ruta }
}

/**
 * Lee los bytes del audio de un `sourceId`:
 *  - ruta absoluta → se lee tal cual;
 *  - ruta relativa `media/...` → se resuelve contra la carpeta del proyecto.
 */
export async function cargarBytesMedia(
  sourceId: string,
  rutaProyecto?: string | null,
): Promise<ArrayBuffer | null> {
  const api = window.electron
  if (!api?.fileReadBinary || !sourceId) return null
  const norm = normalizarRutaRelativa(sourceId)
  const esAbsoluta = /^[a-zA-Z]:\//.test(norm) || norm.startsWith('/')
  const absoluta = esAbsoluta ? sourceId : resolverRutaMedia(sourceId, rutaProyecto)
  if (!absoluta) return null
  try {
    const data = await api.fileReadBinary(absoluta)
    if (!data) return null
    const out = new ArrayBuffer(data.byteLength)
    new Uint8Array(out).set(data)
    return out
  } catch {
    return null
  }
}
