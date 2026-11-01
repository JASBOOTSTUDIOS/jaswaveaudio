/**
 * Servicio de media en el proceso main (U4).
 *
 * El renderer nunca escribe en disco: pide copias de archivos de audio al main,
 * que valida permisos (`path-grants`) y devuelve la ruta ABSOLUTA del destino.
 * El proyecto guarda la ruta RELATIVA (`media/<nombre>`).
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export type ResultadoCopia = {
  ok: boolean
  ruta?: string
  nombre?: string
  error?: string
}

export type OpcionesCopia = {
  /** Ruta absoluta del archivo origen (ya validada por el llamador). */
  src: string
  /** Carpeta de destino (ya validada por el llamador). */
  destDir: string
  /** Nombre forzado en el destino (sin ruta). */
  nombre?: string
}

/** Quita separadores y caracteres no válidos de un nombre de archivo. */
export function nombreArchivoSeguro(nombre: string): string {
  const base = path
    .basename(String(nombre ?? ''))
    .replace(/[\\/:*?"<>|]+/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '')
    .trim()
  return base || 'audio'
}

/**
 * Nombre único dentro de `destDir`: `intro.wav` → `intro (2).wav`.
 * La comprobación es real (contra el disco) para no pisar archivos existentes.
 */
export async function nombreUnicoEnDir(destDir: string, nombre: string): Promise<string> {
  const seguro = nombreArchivoSeguro(nombre)
  const ext = path.extname(seguro)
  const base = ext ? seguro.slice(0, seguro.length - ext.length) : seguro
  const existe = async (n: string): Promise<boolean> => {
    try {
      await fs.access(path.join(destDir, n))
      return true
    } catch {
      return false
    }
  }
  if (!(await existe(seguro))) return seguro
  for (let i = 2; i < 10000; i++) {
    const cand = `${base} (${i})${ext}`
    if (!(await existe(cand))) return cand
  }
  return `${base}-${Date.now().toString(36)}${ext}`
}

/** Traduce errores de disco a mensajes que el usuario entienda. */
export function traducirErrorDisco(err: unknown): string {
  const code = (err as { code?: string } | null)?.code
  switch (code) {
    case 'ENOSPC':
      return 'No hay espacio en disco. Libera espacio y vuelve a intentarlo.'
    case 'EACCES':
    case 'EPERM':
      return 'No tienes permiso para escribir en esa carpeta. Elige otra ubicación.'
    case 'EBUSY':
      return 'El archivo está en uso por otra aplicación. Ciérrala y vuelve a intentarlo.'
    case 'ENOENT':
      return 'El archivo de origen ya no existe.'
    case 'EISDIR':
      return 'La ruta de destino es una carpeta, no un archivo.'
    case 'ENOTDIR':
      return 'Una parte de la ruta no es una carpeta.'
    default:
      return err instanceof Error ? err.message : String(err ?? 'Error desconocido al copiar el archivo')
  }
}

/** Copia `src` a `destDir` con un nombre único. */
export async function copiarMediaArchivo(opts: OpcionesCopia): Promise<ResultadoCopia> {
  try {
    await fs.mkdir(opts.destDir, { recursive: true })
    const nombre = await nombreUnicoEnDir(opts.destDir, opts.nombre ?? path.basename(opts.src))
    const destino = path.join(opts.destDir, nombre)
    await fs.copyFile(opts.src, destino)
    return { ok: true, ruta: destino, nombre }
  } catch (err) {
    return { ok: false, error: traducirErrorDisco(err) }
  }
}

/** Mueve `src` a `destDir` con un nombre único (usado para el media pendiente). */
export async function moverMediaArchivo(opts: OpcionesCopia): Promise<ResultadoCopia> {
  try {
    await fs.mkdir(opts.destDir, { recursive: true })
    const nombre = await nombreUnicoEnDir(opts.destDir, opts.nombre ?? path.basename(opts.src))
    const destino = path.join(opts.destDir, nombre)
    try {
      await fs.rename(opts.src, destino)
    } catch {
      // Renombrar falla si el destino está en otro volumen: copiamos y borramos.
      await fs.copyFile(opts.src, destino)
      await fs.rm(opts.src, { force: true })
    }
    return { ok: true, ruta: destino, nombre }
  } catch (err) {
    return { ok: false, error: traducirErrorDisco(err) }
  }
}

/**
 * Busca archivos por nombre exacto dentro de `carpeta` (hasta `profundidad`).
 * Se usa para reenlazar media faltante cuando el usuario indica otra carpeta.
 */
export async function buscarArchivosPorNombre(
  carpeta: string,
  nombres: string[],
  profundidad = 4,
): Promise<Record<string, string>> {
  const objetivo = new Map(nombres.map((n) => [path.basename(n).toLowerCase(), n]))
  const encontrados: Record<string, string> = {}
  if (objetivo.size === 0) return encontrados

  const visitar = async (dir: string, nivel: number): Promise<void> => {
    if (nivel > profundidad || Object.keys(encontrados).length === objetivo.size) return
    let entradas: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    try {
      entradas = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entrada of entradas) {
      const completo = path.join(dir, entrada.name)
      if (entrada.isDirectory()) {
        await visitar(completo, nivel + 1)
        continue
      }
      if (!entrada.isFile()) continue
      const clave = entrada.name.toLowerCase()
      const pedido = objetivo.get(clave)
      if (pedido && !encontrados[pedido]) {
        encontrados[pedido] = completo
        if (Object.keys(encontrados).length === objetivo.size) return
      }
    }
  }

  await visitar(carpeta, 0)
  return encontrados
}
