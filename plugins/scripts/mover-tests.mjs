/**
 * Mueve pruebas del DAW al paquete de un módulo (pruebas de contrato contra el DAW real).
 *
 *   node plugins/scripts/mover-tests.mjs <plan.json> <test en jas-wave>...
 *
 * plan.json es el mismo de extraer-modulo.mjs (archivos movidos → destino en src/). En cada prueba:
 *  - imports a archivos movidos → ../src/<destino>;
 *  - imports al resto del DAW → alias @/… (solo las pruebas pueden; el código del módulo, no);
 *  - shared/ y ai-harness → rutas relativas a sus fuentes;
 *  - se antepone `import '…/pruebas/instalar'` para que el runtime del host exista antes de evaluar el módulo.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const JW = path.join(REPO, 'jas-wave')
const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const MOD = path.resolve(REPO, plan.modulo)
const norm = (p) => path.resolve(p).toLowerCase()
const movidos = new Map(Object.entries(plan.archivos).map(([o, d]) => [norm(path.join(REPO, o)), path.join(MOD, 'src', d)]))
const paquetes = new Map(Object.entries(plan.paquetes ?? {}).map(([o, p]) => [norm(path.join(REPO, o)), p]))
const EXT = ['.ts', '.tsx', '.js', '.mjs']

function resolver(desde, esp) {
  let base
  if (esp.startsWith('@/')) base = path.join(JW, esp.slice(2))
  else if (esp.startsWith('.')) base = path.resolve(path.dirname(desde), esp)
  else return null
  for (const c of [base, ...EXT.map((e) => base + e), ...EXT.map((e) => path.join(base, 'index' + e))]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  // Puede haberse movido ya: buscar por ruta original sin extensión
  for (const e of ['', ...EXT]) if (movidos.has(norm(base + e))) return base + e
  return base
}

const rel = (desde, hasta) => {
  let r = path.relative(path.dirname(desde), hasta).split(path.sep).join('/').replace(/\.(tsx?|mjs|js)$/, '')
  return r.startsWith('.') ? r : './' + r
}

for (const t of process.argv.slice(3)) {
  const origen = path.resolve(JW, t)
  const destino = path.join(MOD, 'test', path.basename(origen))
  let s = fs.readFileSync(origen, 'utf8')
  const crlf = s.includes('\r\n')
  s = s.replace(/\r\n/g, '\n')
  const cambiar = (esp) => {
    if (!esp.startsWith('.') && !esp.startsWith('@/')) return esp
    const r = resolver(origen, esp)
    if (!r) return esp
    if (movidos.has(norm(r))) return rel(destino, movidos.get(norm(r)))
    if (paquetes.has(norm(r))) return paquetes.get(norm(r))
    if (r.toLowerCase().startsWith(JW.toLowerCase() + path.sep)) return '@/' + path.relative(JW, r).split(path.sep).join('/').replace(/\.(tsx?|mjs|js)$/, '')
    return rel(destino, r)
  }
  s = s.replace(/(from\s+|import\(\s*|import\s+)(['"])([^'"]+)\2/g, (m, pre, q, esp) => `${pre}${q}${cambiar(esp)}${q}`)
  // Primer import: instala el runtime del host real.
  const instalar = rel(destino, path.join(REPO, 'plugins', 'sdk', 'host-sdk', 'pruebas', 'instalar'))
  const i = s.search(/\nimport /)
  s = i >= 0 ? `${s.slice(0, i)}\nimport '${instalar}'${s.slice(i)}` : `import '${instalar}'\n${s}`
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  execFileSync('git', ['mv', origen, destino], { cwd: REPO })
  fs.writeFileSync(destino, crlf ? s.replace(/\n/g, '\r\n') : s)
  console.log(`${t} → ${path.relative(REPO, destino)}`)
}
