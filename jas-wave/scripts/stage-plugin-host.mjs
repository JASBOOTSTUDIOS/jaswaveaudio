/**
 * Copia jaswave-plugin-host.exe (+ node-host.cjs fallback) a resources/plugin-host
 * para que electron-builder lo incluya en el instalador.
 *
 *   node scripts/stage-plugin-host.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const monorepo = path.join(root, '..')
const destDir = path.join(root, 'resources', 'plugin-host')

const exeCandidates = [
  path.join(monorepo, 'native', 'plugin-host', 'build-vst3', 'Release', 'jaswave-plugin-host.exe'),
  path.join(monorepo, 'native', 'plugin-host', 'build-vs', 'Release', 'jaswave-plugin-host.exe'),
  path.join(monorepo, 'native', 'plugin-host', 'build', 'jaswave-plugin-host.exe'),
  path.join(monorepo, 'native', 'plugin-host', 'build', 'Release', 'jaswave-plugin-host.exe'),
]

const nodeHostCandidates = [
  path.join(monorepo, 'native', 'plugin-host', 'node-host.cjs'),
  path.join(root, 'resources', 'plugin-host', 'node-host.cjs'),
]

fs.mkdirSync(destDir, { recursive: true })

let staged = false
for (const src of exeCandidates) {
  if (!fs.existsSync(src)) continue
  const dest = path.join(destDir, 'jaswave-plugin-host.exe')
  fs.copyFileSync(src, dest)
  console.log('[stage-plugin-host] exe →', dest, `(from ${src})`)
  staged = true
  break
}

if (!staged) {
  console.warn(
    '[stage-plugin-host] WARN: jaswave-plugin-host.exe no encontrado. Compila native/plugin-host (Release) antes de empaquetar.',
  )
}

for (const src of nodeHostCandidates) {
  if (!fs.existsSync(src)) continue
  const dest = path.join(destDir, 'node-host.cjs')
  if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest)
  console.log('[stage-plugin-host] node-host →', dest)
  break
}

const keep = new Set(['jaswave-plugin-host.exe', 'node-host.cjs', '.gitkeep'])
for (const name of fs.readdirSync(destDir)) {
  if (!keep.has(name)) {
    /* leave other staged deps */
  }
}

console.log('[stage-plugin-host] listo:', destDir)
process.exit(0)
