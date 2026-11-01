/**
 * Codificación de exportes con ffmpeg (G2).
 *
 * El motor escribe siempre WAV; MP3/FLAC/OGG/AAC/Opus/AIFF salen de ese WAV con ffmpeg. ffmpeg no viaja en
 * el instalador: se usa el que JasWave descargó bajo demanda (`%LOCALAPPDATA%/JasWave/tools/ffmpeg`), o el
 * del PATH si el usuario ya lo tiene. La descarga sale del catálogo firmado (paquete
 * `com.jaswave.tool.ffmpeg`): mismo tamaño y SHA-256 que anuncia el catálogo, o no se instala.
 *
 * El renderer nunca pasa flags a ffmpeg: elige formato y opciones validadas y aquí se arman los argumentos.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { descargar, type EntradaCatalogo } from './plugins/instalador'

export const ID_PAQUETE_FFMPEG = 'com.jaswave.tool.ffmpeg'

export type FormatoCodificado = 'aiff' | 'flac' | 'mp3' | 'ogg' | 'aac' | 'opus'

export type OpcionesCodificacion = {
  /** kbps para formatos con pérdida (64–320). */
  bitrate?: number
  /** Profundidad para AIFF/FLAC (16/24; FLAC no admite float y baja a 24). */
  bitDepth?: number
  sampleRate?: number
}

const EXTENSIONES: Record<FormatoCodificado, RegExp> = {
  aiff: /\.aiff?$/i,
  flac: /\.flac$/i,
  mp3: /\.mp3$/i,
  ogg: /\.ogg$/i,
  aac: /\.(m4a|aac)$/i,
  opus: /\.opus$/i,
}

export function esFormatoCodificado(v: unknown): v is FormatoCodificado {
  return typeof v === 'string' && v in EXTENSIONES
}

/** La extensión del destino debe corresponder al formato (evita escribir un MP3 en `.wav`). */
export function extensionCoincide(formato: FormatoCodificado, salida: string): boolean {
  return EXTENSIONES[formato].test(salida)
}

function bitrateValido(kbps: number | undefined, porDefecto: number): number {
  const n = Math.round(Number(kbps ?? porDefecto))
  if (!Number.isFinite(n) || n < 64 || n > 320) throw new Error('bitrate debe estar entre 64 y 320 kbps')
  return n
}

/** Argumentos de salida de ffmpeg para el formato pedido (sin la entrada ni el destino). */
export function argsCodificacion(formato: FormatoCodificado, o: OpcionesCodificacion = {}): string[] {
  const args: string[] = []
  if (o.sampleRate != null) {
    const sr = Math.round(Number(o.sampleRate))
    if (![44100, 48000, 88200, 96000].includes(sr)) throw new Error(`frecuencia no soportada: ${o.sampleRate}`)
    args.push('-ar', String(sr))
  }
  const bits = Number(o.bitDepth ?? 24)
  switch (formato) {
    case 'mp3':
      return [...args, '-c:a', 'libmp3lame', '-b:a', `${bitrateValido(o.bitrate, 320)}k`]
    case 'aac':
      return [...args, '-c:a', 'aac', '-b:a', `${bitrateValido(o.bitrate, 256)}k`, '-movflags', '+faststart']
    case 'ogg':
      return [...args, '-c:a', 'libvorbis', '-b:a', `${bitrateValido(o.bitrate, 256)}k`]
    case 'opus':
      // Opus trabaja a 48 kHz internamente: ffmpeg remuestrea solo.
      return [...args, '-c:a', 'libopus', '-b:a', `${bitrateValido(o.bitrate, 192)}k`]
    case 'flac':
      return [...args, '-c:a', 'flac', '-compression_level', '8', '-sample_fmt', bits <= 16 ? 's16' : 's32']
    case 'aiff':
      return [...args, '-c:a', bits <= 16 ? 'pcm_s16be' : bits >= 32 ? 'pcm_f32be' : 'pcm_s24be']
  }
}

/** Carpeta donde JasWave guarda su ffmpeg descargado. */
export function carpetaFfmpeg(localAppData: string): string {
  return path.join(localAppData, 'JasWave', 'tools', 'ffmpeg')
}

export function binarioFfmpeg(localAppData: string, plataforma: NodeJS.Platform = process.platform): string {
  return path.join(carpetaFfmpeg(localAppData), plataforma === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
}

export type FfmpegResuelto = { ruta: string; origen: 'jaswave' | 'path' | 'entorno' }

/** `ffmpeg -version` responde: el binario sirve. */
export function probarFfmpeg(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, ['-hide_banner', '-version'], { windowsHide: true, timeout: 15_000 }, (err) => resolve(!err))
  })
}

/** Orden: el descargado por JasWave, `JASWAVE_FFMPEG` (desarrollo) y, por último, el del PATH. */
export async function resolverFfmpeg(o: {
  localAppData: string
  env?: Record<string, string | undefined>
  probar?: (bin: string) => Promise<boolean>
}): Promise<FfmpegResuelto | null> {
  const probar = o.probar ?? probarFfmpeg
  const propio = binarioFfmpeg(o.localAppData)
  if (await probar(propio)) return { ruta: propio, origen: 'jaswave' }
  const env = o.env?.JASWAVE_FFMPEG
  if (env && (await probar(env))) return { ruta: env, origen: 'entorno' }
  if (await probar('ffmpeg')) return { ruta: 'ffmpeg', origen: 'path' }
  return null
}

async function buscarArchivo(dir: string, nombre: string, profundidad = 4): Promise<string | null> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isFile() && e.name.toLowerCase() === nombre) return ruta
    if (e.isDirectory() && profundidad > 0) {
      const hit = await buscarArchivo(ruta, nombre, profundidad - 1)
      if (hit) return hit
    }
  }
  return null
}

function extraer(tar: string, zip: string, destino: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(tar, ['-xf', zip, '-C', destino], { windowsHide: true, timeout: 180_000 }, (err, _o, errOut) => {
      if (err) reject(new Error(`no se pudo descomprimir ffmpeg: ${String(errOut || err.message).slice(0, 300)}`))
      else resolve()
    })
  })
}

/**
 * Descarga el paquete del catálogo, comprueba tamaño y SHA-256, lo descomprime en una carpeta temporal y
 * deja solo `ffmpeg(.exe)` en la carpeta de herramientas (reemplazo atómico).
 */
export async function instalarFfmpeg(
  entrada: EntradaCatalogo,
  o: {
    localAppData: string
    tar?: string
    fetch?: typeof fetch
    alProgreso?: (recibidos: number, total: number) => void
  },
): Promise<string> {
  const zip = await descargar(entrada.url, entrada.sizeBytes, (r) => o.alProgreso?.(r, entrada.sizeBytes), o.fetch)
  if (zip.byteLength !== entrada.sizeBytes) throw new Error('el tamaño de ffmpeg no coincide con el catálogo')
  const sha = createHash('sha256').update(zip).digest('hex')
  if (sha.toLowerCase() !== entrada.sha256.toLowerCase()) throw new Error('la huella SHA-256 de ffmpeg no coincide')
  const temporal = await fs.mkdtemp(path.join(os.tmpdir(), 'jaswave-ffmpeg-'))
  try {
    const archivo = path.join(temporal, 'ffmpeg.zip')
    await fs.writeFile(archivo, zip)
    const extraido = path.join(temporal, 'x')
    await fs.mkdir(extraido)
    await extraer(o.tar ?? (process.platform === 'win32' ? 'tar.exe' : 'tar'), archivo, extraido)
    const nombre = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const bin = await buscarArchivo(extraido, nombre)
    if (!bin) throw new Error('el paquete no contiene ffmpeg')
    const carpeta = carpetaFfmpeg(o.localAppData)
    await fs.mkdir(carpeta, { recursive: true })
    const destino = binarioFfmpeg(o.localAppData)
    const nuevo = `${destino}.nuevo`
    await fs.copyFile(bin, nuevo)
    await fs.rm(destino, { force: true })
    await fs.rename(nuevo, destino)
    if (process.platform !== 'win32') await fs.chmod(destino, 0o755)
    await fs.writeFile(
      path.join(carpeta, 'instalacion.json'),
      JSON.stringify({ id: entrada.id, version: entrada.version, sha256: entrada.sha256, instaladoEn: new Date().toISOString() }, null, 2),
    )
    return destino
  } finally {
    await fs.rm(temporal, { recursive: true, force: true })
  }
}
