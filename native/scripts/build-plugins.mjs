/**
 * Compila TODOS los plugins VST3 independientes de plugins/ (y sus pruebas y herramientas de captura).
 *
 *   node native/scripts/build-plugins.mjs [--config Release] [--clean] [--test]
 *
 * Bundles: plugins/build/VST3/<Config>/<Nombre>.vst3. --test ejecuta además dsp_selftest y license_tests.
 * SDK VST3: JW_VST3_SDK_DIR / JASWAVE_VST3_SDK_DIR o el de native/plugin-host/third_party (npm run native:sdk).
 * Generador: JASWAVE_CMAKE_GENERATOR (por defecto "Visual Studio 17 2022"). Paralelismo moderado (4).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(__dirname, '..', '..')
const pluginsDir = path.join(repo, 'plugins')
const buildDir = path.join(pluginsDir, 'build')

const args = process.argv.slice(2)
const cfgIdx = args.indexOf('--config')
const config = cfgIdx >= 0 && args[cfgIdx + 1] ? args[cfgIdx + 1] : 'Release'
const generator = process.env.JASWAVE_CMAKE_GENERATOR || 'Visual Studio 17 2022'
const isVs = /^Visual Studio/i.test(generator)
const sdk = process.env.JW_VST3_SDK_DIR || process.env.JASWAVE_VST3_SDK_DIR || ''

const log = (m) => console.log(`[build-plugins] ${m}`)
function run(cmd, a) {
  log(`> ${cmd} ${a.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ')}`)
  execFileSync(cmd, a, { stdio: 'inherit' })
}

if (process.platform !== 'win32') {
  console.error('[build-plugins] los plugins usan Direct2D/WinHTTP/DPAPI: solo Windows.')
  process.exit(1)
}
if (args.includes('--clean')) fs.rmSync(buildDir, { recursive: true, force: true })
const cache = path.join(buildDir, 'CMakeCache.txt')
if (fs.existsSync(cache)) {
  const m = /^CMAKE_GENERATOR:INTERNAL=(.*)$/m.exec(fs.readFileSync(cache, 'utf8'))
  if (m && m[1].trim() !== generator) fs.rmSync(buildDir, { recursive: true, force: true })
}
run('cmake', ['-S', pluginsDir, '-B', buildDir, '-G', generator, ...(isVs ? ['-A', 'x64'] : [`-DCMAKE_BUILD_TYPE=${config}`]), ...(sdk ? [`-DJW_VST3_SDK_DIR=${sdk}`] : [])])
run('cmake', ['--build', buildDir, '--config', config, '--parallel', '4'])

const vstDir = path.join(buildDir, 'VST3', config)
const bundles = fs.existsSync(vstDir) ? fs.readdirSync(vstDir).filter((d) => d.endsWith('.vst3')) : []
if (bundles.length < 7) {
  console.error(`[build-plugins] ERROR: se esperaban 7 bundles en ${vstDir}, hay ${bundles.length}`)
  process.exit(1)
}
for (const b of bundles) log(`OK ${path.join(vstDir, b)}`)

if (args.includes('--test')) {
  const testsDir = isVs ? path.join(buildDir, 'tests', config) : path.join(buildDir, 'tests')
  run(path.join(testsDir, 'jw_dsp_selftest.exe'), [])
  run(path.join(testsDir, 'jw_license_tests.exe'), [])
}
log('listo.')
