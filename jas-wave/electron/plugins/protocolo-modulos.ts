/**
 * Protocolo `jaswave-modulo://<id>/<ruta>` (M3): sirve al renderer el código de los módulos instalados
 * (asistente IA, partitura…) para que los cargue con `import()`.
 *
 * Solo sirve archivos que:
 *  - pertenecen a un paquete con `jaswave-plugin.json` cuyo id coincide y que es un módulo (entrypoints.ui),
 *  - están dentro de su carpeta `dist/` (sin escapar del paquete),
 *  - y cuyo SHA-256 coincide con el de `instalacion.json` (lo escribe el instalador tras verificar el
 *    catálogo firmado). Sin registro de instalación solo se admite en desarrollo (repositorio).
 * Cada petición vuelve a comprobar el hash: un archivo alterado tras instalar no se carga.
 */

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { rutaDentroDe } from './escaner'

export const ESQUEMA_MODULOS = 'jaswave-modulo'

const TIPOS: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

const MAX_BYTES = 64 * 1024 * 1024

export type OpcionesProtocolo = {
  /** Carpetas donde buscar paquetes (<raíz>/<id>/). */
  raices: () => string[]
  /** Desarrollo: ¿se admite un paquete sin instalacion.json en esta carpeta? */
  admitirSinRegistro: (dirPaquete: string) => boolean
}

function respuesta(estado: number, texto: string): Response {
  return new Response(texto, { status: estado, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } })
}

async function leerJson(ruta: string, max = 1024 * 1024): Promise<Record<string, unknown> | null> {
  try {
    const s = await stat(ruta)
    if (!s.isFile() || s.size > max) return null
    return JSON.parse(await readFile(ruta, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export function crearManejadorModulos(o: OpcionesProtocolo): (req: Request) => Promise<Response> {
  return async (req) => {
    let url: URL
    try {
      url = new URL(req.url)
    } catch {
      return respuesta(400, 'URL inválida')
    }
    if (req.method !== 'GET') return respuesta(405, 'solo GET')
    const id = decodeURIComponent(url.hostname)
    if (!/^[a-z0-9]+(\.[a-z0-9-]+){2,}$/.test(id)) return respuesta(404, 'módulo no encontrado')
    let rel: string
    try {
      rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    } catch {
      return respuesta(400, 'ruta inválida')
    }
    if (!rel.startsWith('dist/') || rel.includes('\\')) return respuesta(404, 'archivo no encontrado')
    const tipo = TIPOS[path.extname(rel).toLowerCase()]
    if (!tipo) return respuesta(404, 'tipo de archivo no permitido')

    for (const raiz of o.raices()) {
      const dir = rutaDentroDe(raiz, id)
      if (!dir) continue
      const manifiesto = await leerJson(path.join(dir, 'jaswave-plugin.json'), 256 * 1024)
      if (!manifiesto || manifiesto.id !== id) continue
      const ui = (manifiesto.entrypoints as { ui?: unknown } | undefined)?.ui
      if (typeof ui !== 'string') return respuesta(404, 'el paquete no es un módulo')
      const archivo = rutaDentroDe(dir, rel)
      if (!archivo) return respuesta(404, 'archivo no encontrado')
      const registro = await leerJson(path.join(dir, 'instalacion.json'))
      const esperado = (registro?.archivos as Record<string, unknown> | undefined)?.[rel]
      if (!registro && !o.admitirSinRegistro(dir)) return respuesta(403, 'módulo sin registro de instalación')
      if (registro && typeof esperado !== 'string') return respuesta(403, 'archivo no registrado en la instalación')
      let datos: Buffer
      try {
        const s = await stat(archivo)
        if (!s.isFile() || s.size > MAX_BYTES) return respuesta(404, 'archivo no encontrado')
        datos = await readFile(archivo)
      } catch {
        return respuesta(404, 'archivo no encontrado')
      }
      if (registro && createHash('sha256').update(datos).digest('hex') !== esperado) {
        return respuesta(403, 'el archivo no coincide con la instalación (alterado)')
      }
      return new Response(new Uint8Array(datos), {
        status: 200,
        headers: {
          'Content-Type': tipo,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-cache',
          // El renderer (file://, origen null) importa el módulo como script de otro origen.
          'Access-Control-Allow-Origin': '*',
        },
      })
    }
    return respuesta(404, 'módulo no instalado')
  }
}
