/**
 * Prepara los binarios nativos para que electron-builder los incluya en el instalador:
 *   - jaswave-plugin-host.exe (+ node-host.cjs fallback) → resources/plugin-host
 *
 * K1/V1: los plugins JasWave (plugins/com.jaswave.plugin.*) ya NO se copian al paquete: son VST3
 * independientes que se entregan bajo demanda (manifiesto V5 + descarga). Si quedó una copia antigua en
 * resources/vst3/JasWave (de builds previos) se elimina para no empaquetarla.
 *
 *   node scripts/stage-plugin-host.mjs [--strict]
 *
 * En local solo avisa si falta algo. Con `--strict` o la variable CI definida, falla (exit 1):
 * un release no debe salir sin plugin host.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const monorepo = path.join(root, '..')
const destDir = path.join(root, 'resources', 'plugin-host')
const staleVst3Dir = path.join(root, 'resources', 'vst3', 'JasWave')

const ciFlag = String(process.env.CI ?? '').trim().toLowerCase()
const strict = process.argv.includes('--strict') || (ciFlag !== '' && ciFlag !== '0' && ciFlag !== 'false')

const pluginHostDir = path.join(monorepo, 'native', 'plugin-host')
const exeCandidates = [
  path.join(pluginHostDir, 'build-release', 'Release', 'jaswave-plugin-host.exe'),
  path.join(pluginHostDir, 'build-vst3', 'Release', 'jaswave-plugin-host.exe'),
  path.join(pluginHostDir, 'build-vs', 'Release', 'jaswave-plugin-host.exe'),
  path.join(pluginHostDir, 'build', 'jaswave-plugin-host.exe'),
  path.join(pluginHostDir, 'build', 'Release', 'jaswave-plugin-host.exe'),
]

const nodeHostCandidates = [
  path.join(pluginHostDir, 'node-host.cjs'),
  path.join(root, 'resources', 'plugin-host', 'node-host.cjs'),
]

const problems = []

function warnOrFail(msg) {
  problems.push(msg)
  console[strict ? 'error' : 'warn'](`[stage-plugin-host] ${strict ? 'ERROR' : 'WARN'}: ${msg}`)
}

fs.mkdirSync(destDir, { recursive: true })

// ── Plugin host ────────────────────────────────────────────────────────────
const exeSrc = exeCandidates.find((p) => fs.existsSync(p))
if (exeSrc) {
  const dest = path.join(destDir, 'jaswave-plugin-host.exe')
  fs.copyFileSync(exeSrc, dest)
  console.log('[stage-plugin-host] exe →', dest, `(from ${exeSrc})`)
} else {
  warnOrFail('jaswave-plugin-host.exe no encontrado. Ejecuta `npm run native:sdk && npm run native:build` antes de empaquetar.')
}

for (const src of nodeHostCandidates) {
  if (!fs.existsSync(src)) continue
  const dest = path.join(destDir, 'node-host.cjs')
  if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest)
  console.log('[stage-plugin-host] node-host →', dest)
  break
}

// ── Plugins VST3 propios: ya no se empaquetan (entrega bajo demanda) ─────────
if (fs.existsSync(staleVst3Dir) && fs.readdirSync(staleVst3Dir).length > 0) {
  fs.rmSync(staleVst3Dir, { recursive: true, force: true })
  console.log('[stage-plugin-host] eliminada copia antigua de plugins en', staleVst3Dir)
}

if (problems.length > 0 && strict) {
  console.error(`[stage-plugin-host] ${problems.length} binario(s) nativo(s) faltan; modo estricto (CI/--strict) → abortando.`)
  process.exit(1)
}

console.log('[stage-plugin-host] listo:', destDir)
process.exit(0)
