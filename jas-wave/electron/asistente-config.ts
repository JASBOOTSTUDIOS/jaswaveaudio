/**
 * Carpeta de configuración del asistente (`<userData>/asistente/`): archivos Markdown que el usuario
 * edita a mano o con ayuda de la IA.
 *
 *   reglas.md                 reglas para todos los proyectos
 *   habilidades/<nombre>.md   «# Nombre», «> cuándo usarla» y los pasos
 *   prompts/<nombre>.md       instrucciones reutilizables
 *   planes/<nombre>.md        planes de trabajo
 *
 * Seguridad: el renderer solo pasa rutas RELATIVAS de esa forma (sin `..`, solo `.md`, tamaño acotado).
 * Eliminar mueve el archivo a `.papelera/` con fecha: se puede recuperar.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { writeFileAtomic } from './atomic-write'

export const CARPETAS_CONFIG = ['habilidades', 'prompts', 'planes'] as const
export type CarpetaConfig = (typeof CARPETAS_CONFIG)[number]
export const ARCHIVO_REGLAS = 'reglas.md'
export const MAX_BYTES_CONFIG = 64 * 1024
const PAPELERA = '.papelera'

export type ArchivoConfig = { ruta: string; carpeta: CarpetaConfig | null; nombre: string; contenido: string; modificado: number }

const RE_RUTA = /^(?:reglas\.md|(?:habilidades|prompts|planes)\/[a-z0-9][a-z0-9-]{0,63}\.md)$/

/** Ruta relativa normalizada si es válida (`habilidades/bateria.md`); si no, null. */
export function rutaConfigValida(rel: unknown): string | null {
  if (typeof rel !== 'string') return null
  const r = rel.trim().replace(/\\/g, '/').toLowerCase()
  return RE_RUTA.test(r) ? r : null
}

/** Nombre legible → nombre de archivo seguro (`Batería de adoración` → `bateria-de-adoracion`). */
export function slugConfig(nombre: string): string {
  return (
    nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
      .replace(/-+$/, '') || 'sin-nombre'
  )
}

export class AsistenteConfig {
  constructor(private readonly base: string) {}

  get carpeta(): string {
    return this.base
  }

  private abs(rel: string): string {
    const r = rutaConfigValida(rel)
    if (!r) throw new Error('Ruta de configuración no válida')
    const destino = path.resolve(this.base, r)
    if (!destino.startsWith(path.resolve(this.base) + path.sep)) throw new Error('Ruta de configuración no válida')
    return destino
  }

  async asegurar(): Promise<void> {
    for (const c of CARPETAS_CONFIG) await fs.mkdir(path.join(this.base, c), { recursive: true })
  }

  async listar(): Promise<ArchivoConfig[]> {
    await this.asegurar()
    const out: ArchivoConfig[] = []
    const leer = async (rel: string, carpeta: CarpetaConfig | null) => {
      try {
        const abs = this.abs(rel)
        const st = await fs.stat(abs)
        if (!st.isFile() || st.size > MAX_BYTES_CONFIG) return
        out.push({ ruta: rel, carpeta, nombre: path.basename(rel, '.md'), contenido: await fs.readFile(abs, 'utf-8'), modificado: st.mtimeMs })
      } catch {
        /* no existe o no se puede leer */
      }
    }
    await leer(ARCHIVO_REGLAS, null)
    for (const c of CARPETAS_CONFIG) {
      const nombres = await fs.readdir(path.join(this.base, c)).catch(() => [] as string[])
      for (const n of nombres.sort()) {
        const rel = `${c}/${n}`
        if (rutaConfigValida(rel) === rel) await leer(rel, c)
      }
    }
    return out
  }

  async leer(rel: string): Promise<string | null> {
    try {
      return await fs.readFile(this.abs(rel), 'utf-8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  async escribir(rel: string, contenido: string): Promise<void> {
    const texto = String(contenido ?? '')
    if (Buffer.byteLength(texto, 'utf-8') > MAX_BYTES_CONFIG) throw new Error('El archivo es demasiado grande (máx. 64 KB)')
    await writeFileAtomic(this.abs(rel), texto)
  }

  /** Mueve el archivo a la papelera. Devuelve false si no existía. */
  async eliminar(rel: string): Promise<boolean> {
    const abs = this.abs(rel)
    try {
      await fs.access(abs)
    } catch {
      return false
    }
    const r = rutaConfigValida(rel)!
    const sello = new Date().toISOString().replace(/[:.]/g, '-')
    const destino = path.join(this.base, PAPELERA, `${sello}--${r.replace('/', '--')}`)
    await fs.mkdir(path.dirname(destino), { recursive: true })
    await fs.rename(abs, destino)
    return true
  }

  /** Recupera la versión más reciente de la papelera. */
  async restaurar(rel: string): Promise<boolean> {
    const r = rutaConfigValida(rel)
    if (!r) throw new Error('Ruta de configuración no válida')
    const sufijo = `--${r.replace('/', '--')}`
    const nombres = await fs.readdir(path.join(this.base, PAPELERA)).catch(() => [] as string[])
    const ultimo = nombres.filter((n) => n.endsWith(sufijo)).sort().pop()
    if (!ultimo) return false
    const abs = this.abs(r)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.rename(path.join(this.base, PAPELERA, ultimo), abs)
    return true
  }
}
