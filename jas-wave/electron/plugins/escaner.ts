/**
 * Escáner de paquetes de plugins JasWave (P1).
 *
 * Disposición de un paquete instalado (la crea el instalador bajo demanda, D1):
 *   <raíz>/<id>/jaswave-plugin.json
 *   <raíz>/<id>/instalacion.json   { version, archivos: { "<ruta relativa>": "<sha256>" } }
 *   <raíz>/<id>/…                  (bin/, dist/…)
 *
 * El proceso main no valida el esquema (eso lo hace el renderer con @jaswave/shared): aquí solo se
 * leen archivos acotados, se comprueba la integridad contra `instalacion.json` y se rechazan rutas
 * que escapen del paquete. Un paquete alterado se informa como tal y no se debe cargar.
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import * as path from 'node:path'

export type Integridad = 'verificada' | 'alterada' | 'sin-registro'

export type PaqueteEncontrado = {
  /** Carpeta del paquete. */
  dir: string
  /** Contenido de jaswave-plugin.json sin validar (lo valida el renderer). */
  manifiesto: unknown
  integridad: Integridad
  /** Archivos cuyo hash no coincide o que faltan (si `alterada`). */
  discrepancias: string[]
  errores: string[]
  /** Ruta real del binario VST3 (`entrypoints.dspDesktop`) si existe en el paquete o en una carpeta VST3. */
  rutaDsp?: string
}

const MAX_MANIFIESTO_BYTES = 256 * 1024
const MAX_REGISTRO_BYTES = 1024 * 1024

/** Resuelve `rel` dentro de `base`; null si escapa (.., absoluta, otra unidad). */
export function rutaDentroDe(base: string, rel: string): string | null {
  if (!rel || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null
  const destino = path.resolve(base, rel)
  const raiz = path.resolve(base) + path.sep
  return destino.startsWith(raiz) ? destino : null
}

async function leerAcotado(ruta: string, max: number): Promise<string> {
  const s = await stat(ruta)
  if (!s.isFile()) throw new Error('no es un archivo')
  if (s.size > max) throw new Error(`demasiado grande (${s.size} bytes)`)
  return readFile(ruta, 'utf8')
}

export function sha256Archivo(ruta: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(ruta)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

/** Comprueba cada archivo de `instalacion.json`. */
export async function verificarIntegridad(dir: string): Promise<{ integridad: Integridad; discrepancias: string[] }> {
  let registro: { archivos?: Record<string, unknown> }
  try {
    registro = JSON.parse(await leerAcotado(path.join(dir, 'instalacion.json'), MAX_REGISTRO_BYTES))
  } catch {
    return { integridad: 'sin-registro', discrepancias: [] }
  }
  const archivos = registro.archivos && typeof registro.archivos === 'object' ? registro.archivos : {}
  const discrepancias: string[] = []
  const entradas = Object.entries(archivos)
  if (entradas.length === 0) return { integridad: 'alterada', discrepancias: ['instalacion.json sin archivos'] }
  for (const [rel, esperado] of entradas) {
    const ruta = rutaDentroDe(dir, rel)
    if (!ruta || typeof esperado !== 'string' || !/^[a-f0-9]{64}$/.test(esperado)) {
      discrepancias.push(rel)
      continue
    }
    try {
      if ((await sha256Archivo(ruta)) !== esperado) discrepancias.push(rel)
    } catch {
      discrepancias.push(rel)
    }
  }
  return { integridad: discrepancias.length ? 'alterada' : 'verificada', discrepancias }
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await stat(ruta)
    return true
  } catch {
    return false
  }
}

/**
 * Localiza el binario del plugin: primero por su nombre de bundle en las carpetas VST3 (donde lo instala
 * el instalador modular, lo encuentra cualquier DAW y el host tiene permiso) y, si no, dentro del paquete.
 * Nunca acepta rutas que escapen del paquete.
 */
export async function resolverRutaDsp(dir: string, manifiesto: unknown, carpetasVst3: string[]): Promise<string | undefined> {
  const entrada = (manifiesto as { entrypoints?: { dspDesktop?: unknown } } | null)?.entrypoints?.dspDesktop
  if (typeof entrada !== 'string') return undefined
  const enPaquete = rutaDentroDe(dir, entrada)
  if (!enPaquete) return undefined
  const bundle = path.basename(enPaquete)
  if (!/^[A-Za-z0-9 ._&()-]+\.vst3$/i.test(bundle)) return undefined
  for (const carpeta of carpetasVst3) {
    const candidato = path.join(carpeta, bundle)
    if (await existe(candidato)) return candidato
  }
  return (await existe(enPaquete)) ? enPaquete : undefined
}

/** Busca paquetes en cada raíz (un nivel: <raíz>/<carpeta>/jaswave-plugin.json). */
export async function escanearPaquetes(raices: string[], carpetasVst3: string[] = []): Promise<PaqueteEncontrado[]> {
  const out: PaqueteEncontrado[] = []
  for (const raiz of raices) {
    let carpetas: string[]
    try {
      carpetas = (await readdir(raiz, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
    } catch {
      continue // raíz inexistente: normal en una instalación limpia
    }
    for (const nombre of carpetas.sort()) {
      const dir = path.join(raiz, nombre)
      const rutaManifiesto = path.join(dir, 'jaswave-plugin.json')
      let manifiesto: unknown
      try {
        manifiesto = JSON.parse(await leerAcotado(rutaManifiesto, MAX_MANIFIESTO_BYTES))
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') continue
        out.push({ dir, manifiesto: null, integridad: 'sin-registro', discrepancias: [], errores: [`manifiesto ilegible: ${(e as Error).message}`] })
        continue
      }
      const { integridad, discrepancias } = await verificarIntegridad(dir)
      const rutaDsp = await resolverRutaDsp(dir, manifiesto, carpetasVst3)
      out.push({ dir, manifiesto, integridad, discrepancias, errores: [], ...(rutaDsp ? { rutaDsp } : {}) })
    }
  }
  return out
}
