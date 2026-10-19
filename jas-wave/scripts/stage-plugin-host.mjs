/**
 * Prepara los binarios nativos para que electron-builder los incluya en el instalador:
 *   - jaswave-plugin-host.exe (+ node-host.cjs fallback) → resources/plugin-host
 *   - JasWaveRoles.vst3 / JasWavePiano.vst3 (bundles)      → resources/vst3/JasWave
 *
 *   node scripts/stage-plugin-host.mjs [--strict]
 *
 * En local solo avisa si falta algo. Con `--strict` o la variable CI definida, falla (exit 1):
 * un release no debe salir sin plugin host ni plugins propios.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const monorepo = path.join(root, '..')
const destDir = path.join(root, 'resources', 'plugin-host')
const vst3DestDir = path.join(root, 'resources', 'vst3', 'JasWave')

const ciFlag = String(process.env.CI ?? '').trim().toLowerCase()
const strict = process.argv.includes('--strict') || (ciFlag !== '' && ciFlag !== '0' && ciFlag !== 'false')

const pluginHostDir = path.join(monorepo, 'native', 'plugin-host')
const rolesDir = path.join(monorepo, 'native', 'jaswave-roles-vst')
const userVst3Dir = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Common', 'VST3', 'JasWave')
  : null

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

/** Bundles VST3: salida del POST_BUILD de CMake (<build>/X.vst3) o la instalación de usuario. */
const bundleCandidates = {
  'JasWaveRoles.vst3': [
    path.join(rolesDir, 'build-release', 'JasWaveRoles.vst3'),
    path.join(rolesDir, 'build', 'JasWaveRoles.vst3'),
    ...(userVst3Dir ? [path.join(userVst3Dir, 'JasWaveRoles.vst3')] : []),
  ],
  'JasWavePiano.vst3': [
    path.join(pluginHostDir, 'build-release', 'JasWavePiano.vst3'),
    path.join(pluginHostDir, 'build-vst3', 'JasWavePiano.vst3'),
    path.join(pluginHostDir, 'build-vs', 'JasWavePiano.vst3'),
    path.join(pluginHostDir, 'build', 'JasWavePiano.vst3'),
    ...(userVst3Dir ? [path.join(userVst3Dir, 'JasWavePiano.vst3')] : []),
  ],
}

const problems = []

function warnOrFail(msg) {
  problems.push(msg)
  console[strict ? 'error' : 'warn'](`[stage-plugin-host] ${strict ? 'ERROR' : 'WARN'}: ${msg}`)
}

/** Un bundle válido tiene el binario en Contents/x86_64-win/<nombre>. */
function bundleBinary(bundleDir, name) {
  return path.join(bundleDir, 'Contents', 'x86_64-win', name)
}

fs.mkdirSync(destDir, { recursive: true })
fs.mkdirSync(vst3DestDir, { recursive: true })

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

// ── Plugins VST3 propios ───────────────────────────────────────────────────
for (const [name, candidates] of Object.entries(bundleCandidates)) {
  const src = candidates.find((dir) => fs.existsSync(bundleBinary(dir, name)))
  const dest = path.join(vst3DestDir, name)
  if (!src) {
    warnOrFail(`${name} no encontrado (build de CMake ni %LOCALAPPDATA%). Ejecuta \`npm run native:build\`.`)
    continue
  }
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(src, dest, { recursive: true })
  console.log(`[stage-plugin-host] ${name} →`, dest, `(from ${src})`)
}

if (problems.length > 0 && strict) {
  console.error(`[stage-plugin-host] ${problems.length} binario(s) nativo(s) faltan; modo estricto (CI/--strict) → abortando.`)
  process.exit(1)
}

console.log('[stage-plugin-host] listo:', destDir, '+', vst3DestDir)
process.exit(0)
