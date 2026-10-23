/**
 * Publica en el backend los archivos web de los módulos empaquetados (salida de package-plugins.mjs):
 *   <salida>/web/<id>/<version>/dist/...  →  POST <api>/catalogo/modulos/<id>/<version>/archivos
 *
 *   JASWAVE_TOKEN=<JWT de administrador> node plugins/scripts/publicar-modulos-web.mjs --api https://api.ejemplo.com [--salida plugins/dist]
 *
 * Antes hay que publicar las entradas del catálogo (POST <api>/catalogo con catalogo.json). Una versión
 * publicada es inmutable en el servidor.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(n)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const api = opcion('--api', '').replace(/\/+$/, '')
const salida = path.resolve(opcion('--salida', path.join(REPO, 'plugins', 'dist')))
const token = process.env.JASWAVE_TOKEN
if (!api || !token) {
  console.error('Uso: JASWAVE_TOKEN=<jwt admin> node plugins/scripts/publicar-modulos-web.mjs --api <url del backend>')
  process.exit(1)
}

function archivos(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? archivos(p, base) : [path.relative(base, p).split(path.sep).join('/')]
  })
}

const web = path.join(salida, 'web')
if (!fs.existsSync(web)) {
  console.log('No hay módulos web empaquetados.')
  process.exit(0)
}
let fallos = 0
for (const id of fs.readdirSync(web)) {
  for (const version of fs.readdirSync(path.join(web, id))) {
    const base = path.join(web, id, version)
    const lista = archivos(base).map((ruta) => ({ ruta, contenido: fs.readFileSync(path.join(base, ruta)).toString('base64') }))
    const r = await fetch(`${api}/catalogo/modulos/${encodeURIComponent(id)}/${encodeURIComponent(version)}/archivos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ archivos: lista }),
    })
    const cuerpo = await r.json().catch(() => ({}))
    if (!r.ok) {
      fallos++
      console.error(`✗ ${id}@${version}: ${r.status} ${cuerpo?.error?.mensaje ?? ''}`)
    } else console.log(`✓ ${id}@${version}: ${Object.keys(cuerpo.archivos ?? {}).length} archivos`)
  }
}
process.exit(fallos ? 1 : 0)
