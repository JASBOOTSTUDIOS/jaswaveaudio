/**
 * Compila el NÚCLEO nativo que se incluye en el instalador (Release, x64):
 *   - native/plugin-host → jaswave-plugin-host.exe
 *
 *   node native/scripts/build-native.mjs [--config Release] [--clean]
 *
 * Los plugins JasWave (EQ, compresor, limitador, de-esser, utility, piano, roles) ya NO forman parte
 * del núcleo (K1): viven en plugins/ y se compilan con `node native/scripts/build-plugins.mjs`; se
 * entregan bajo demanda (manifiesto V5 + descarga), no dentro del instalador.
 * native/audio-engine (addon N-API) se compila con su propio `npm install` (node-gyp) y no es parte del release.
 *
 * Generador: "Visual Studio 17 2022" (runners windows-latest). Cambiable con JASWAVE_CMAKE_GENERATOR
 * (p. ej. "Visual Studio 18 2026" o "Ninja"). SDK VST3: `npm run native:sdk`, o JASWAVE_VST3_SDK_DIR.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nativeRoot = path.join(__dirname, '..')

const args = process.argv.slice(2)
const cfgIdx = args.indexOf('--config')
const config = cfgIdx >= 0 && args[cfgIdx + 1] ? args[cfgIdx + 1] : 'Release'
const clean = args.includes('--clean')
const generator = process.env.JASWAVE_CMAKE_GENERATOR || 'Visual Studio 17 2022'
const isVs = /^Visual Studio/i.test(generator)
const BUILD_DIR_NAME = 'build-release'

const sdkDir = process.env.JASWAVE_VST3_SDK_DIR || path.join(nativeRoot, 'plugin-host', 'third_party', 'vst3sdk')

function log(msg) {
  console.log(`[build-native] ${msg}`)
}
function fail(msg) {
  console.error(`[build-native] ERROR: ${msg}`)
  process.exit(1)
}
function run(cmd, cmdArgs) {
  log(`> ${cmd} ${cmdArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`)
  execFileSync(cmd, cmdArgs, { stdio: 'inherit' })
}

/** Evita el error de CMake al reutilizar un build dir configurado con otro generador. */
function prepareBuildDir(buildDir) {
  const cache = path.join(buildDir, 'CMakeCache.txt')
  if (clean && fs.existsSync(buildDir)) fs.rmSync(buildDir, { recursive: true, force: true })
  if (!fs.existsSync(cache)) return
  const m = /^CMAKE_GENERATOR:INTERNAL=(.*)$/m.exec(fs.readFileSync(cache, 'utf8'))
  if (m && m[1].trim() !== generator) {
    log(`generador previo "${m[1].trim()}" ≠ "${generator}": se recrea ${buildDir}`)
    fs.rmSync(buildDir, { recursive: true, force: true })
  }
}

if (process.platform !== 'win32') fail('el build nativo de release solo está soportado en Windows.')
try {
  execFileSync('cmake', ['--version'], { stdio: 'ignore' })
} catch {
  fail('cmake no está en el PATH (requiere CMake ≥ 3.25).')
}
for (const f of ['CMakeLists.txt', 'public.sdk/source/vst/hosting/module.h', 'pluginterfaces/vst/ivstaudioprocessor.h']) {
  if (!fs.existsSync(path.join(sdkDir, f))) fail(`VST3 SDK incompleto (${f}). Ejecuta: npm run native:sdk`)
}
if (!fs.existsSync(path.join(nativeRoot, 'plugin-host', 'vendor', 'miniaudio.h'))) fail('falta native/plugin-host/vendor/miniaudio.h')

log(`config=${config} generador="${generator}"`)
const src = path.join(nativeRoot, 'plugin-host')
const buildDir = path.join(src, BUILD_DIR_NAME)
prepareBuildDir(buildDir)
run('cmake', [
  '-S', src,
  '-B', buildDir,
  '-G', generator,
  ...(isVs ? ['-A', 'x64'] : [`-DCMAKE_BUILD_TYPE=${config}`]),
  `-DVST3_SDK_DIR=${sdkDir}`,
  '-DJASWAVE_VST3_SDK=ON',
  '-DSMTG_ENABLE_VSTGUI_SUPPORT=OFF',
  '-DSMTG_ENABLE_VST3_PLUGIN_EXAMPLES=OFF',
])
run('cmake', ['--build', buildDir, '--config', config, '--parallel', '4', '--target', 'jaswave-plugin-host'])

// Multi-config (VS) deja el exe en <build>/<Config>/; single-config (Ninja) en <build>/.
const exe = [path.join(buildDir, config, 'jaswave-plugin-host.exe'), path.join(buildDir, 'jaswave-plugin-host.exe')].find((p) => fs.existsSync(p))
if (!exe) fail(`no se generó jaswave-plugin-host.exe en ${buildDir}`)
log(`OK ${exe}`)
log('listo. Plugins: node native/scripts/build-plugins.mjs. Instalador: npm run pack:win (stage:host copia el host).')
