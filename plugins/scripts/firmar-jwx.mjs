/**
 * Firma extensiones `.jwx` (X1) con la clave de JasWave, que solo vive en el backend:
 * calcula el SHA-256 de cada archivo del paquete, pide la firma a POST <api>/catalogo/firmar-paquete
 * (token de administrador) y añade `jaswave-firma.json` al paquete.
 *
 *   node plugins/scripts/firmar-jwx.mjs <paquete.jwx> [más.jwx…] --api <backend>   (JASWAVE_ADMIN_TOKEN)
 *
 * También lo usa native/scripts/package-plugins.mjs --firmar (firma antes de comprimir).
 * Un .jwx sin firmar solo se instala con el Modo desarrollador del DAW.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ARCHIVO_FIRMA = 'jaswave-firma.json'
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')

function listar(dir, base = dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, e.name)
    if (e.isSymbolicLink()) throw new Error(`enlace no permitido en el paquete: ${ruta}`)
    if (e.isDirectory()) out.push(...listar(ruta, base))
    else if (e.isFile()) out.push(path.relative(base, ruta).split(path.sep).join('/'))
  }
  return out
}

/** Hashes de todos los archivos de la carpeta del paquete (salvo una firma previa). */
export function hashesDePaquete(dir) {
  const archivos = {}
  for (const rel of listar(dir).sort()) {
    if (rel === ARCHIVO_FIRMA) continue
    archivos[rel] = createHash('sha256').update(fs.readFileSync(path.join(dir, rel))).digest('hex')
  }
  return archivos
}

/** Firma la carpeta (antes de comprimirla) pidiendo la firma al backend; escribe jaswave-firma.json. */
export async function firmarCarpeta(dir, { api, token }) {
  if (!api || !token) throw new Error('para firmar hacen falta --api <backend> y JASWAVE_ADMIN_TOKEN (administrador)')
  const manifiesto = JSON.parse(fs.readFileSync(path.join(dir, 'jaswave-plugin.json'), 'utf8'))
  const archivos = hashesDePaquete(dir)
  const r = await fetch(`${api.replace(/\/+$/, '')}/catalogo/firmar-paquete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: manifiesto.id, version: manifiesto.version, archivos }),
  })
  const cuerpo = await r.json().catch(() => ({}))
  if (!r.ok || !cuerpo.firma) throw new Error(`el backend no firmó ${manifiesto.id}@${manifiesto.version}: ${r.status} ${JSON.stringify(cuerpo).slice(0, 200)}`)
  fs.writeFileSync(path.join(dir, ARCHIVO_FIRMA), JSON.stringify(cuerpo.firma, null, 2) + '\n')
  return cuerpo.firma
}

/** Comprime la carpeta como .jwx (zip; bsdtar de Windows elige el formato con -a y la extensión). */
export function comprimirJwx(dir, destino) {
  fs.rmSync(destino, { force: true })
  const zip = destino.replace(/\.jwx$/i, '.zip')
  fs.rmSync(zip, { force: true })
  const entradas = fs.readdirSync(dir)
  execFileSync(tar, ['-a', '-c', '-f', zip, '-C', dir, ...entradas], { stdio: 'inherit' })
  fs.renameSync(zip, destino)
  return destino
}

async function main() {
  const args = process.argv.slice(2)
  const i = args.indexOf('--api')
  const api = i >= 0 ? args[i + 1] : process.env.JASWAVE_API_URL
  const archivos = args.filter((a, k) => !a.startsWith('--') && args[k - 1] !== '--api')
  if (!archivos.length) {
    console.error('uso: node plugins/scripts/firmar-jwx.mjs <paquete.jwx>… --api <backend>   (JASWAVE_ADMIN_TOKEN)')
    process.exit(2)
  }
  for (const archivo of archivos) {
    const abs = path.resolve(archivo)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-firmar-'))
    try {
      execFileSync(tar, ['-x', '-f', abs, '-C', tmp], { stdio: 'inherit' })
      const firma = await firmarCarpeta(tmp, { api, token: process.env.JASWAVE_ADMIN_TOKEN })
      comprimirJwx(tmp, abs)
      console.log(`[firmar-jwx] ${path.basename(abs)} firmado (${Object.keys(firma.archivos).length} archivos)`)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`[firmar-jwx] ${e.message}`)
    process.exit(1)
  })
}
