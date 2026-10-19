/**
 * Compila los binarios nativos que se incluyen en el instalador (Release, x64):
 *   - native/plugin-host  → jaswave-plugin-host.exe + JasWavePiano.vst3 (piano-synth)
 *   - native/jaswave-roles-vst → JasWaveRoles.vst3
 *
 *   node native/scripts/build-native.mjs [--config Release] [--clean]
 *
 * Generador: "Visual Studio 17 2022" (disponible en los runners windows-latest).
 * Se puede cambiar con JASWAVE_CMAKE_GENERATOR (p. ej. "Visual Studio 18 2026" o "Ninja").
 * Requiere el VST3 SDK: `npm run native:sdk`.
 *
 * native/audio-engine (addon N-API, stub tras JASWAVE_NATIVE_AUDIO=1) NO forma parte del release.
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

const sdkDir = path.join(nativeRoot, 'plugin-host', 'third_party', 'vst3sdk')

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

/**
 * targets: [{ name, subdir? }]. Con generadores de Visual Studio, un target de un
 * add_subdirectory(... EXCLUDE_FROM_ALL) no está en la .sln raíz: se compila desde
 * la .sln de su subdirectorio. Se compila un target por llamada.
 */
function configureAndBuild(project, targets, extraDefs = []) {
  const src = path.join(nativeRoot, project)
  const buildDir = path.join(src, BUILD_DIR_NAME)
  prepareBuildDir(buildDir)
  run('cmake', [
    '-S', src,
    '-B', buildDir,
    '-G', generator,
    ...(isVs ? ['-A', 'x64'] : [`-DCMAKE_BUILD_TYPE=${config}`]),
    // El release no toca %LOCALAPPDATA%: stage-plugin-host.mjs toma los bundles del build dir.
    '-DJASWAVE_INSTALL_USER_VST3=OFF',
    ...extraDefs,
  ])
  for (const t of targets) {
    const dir = isVs && t.subdir ? path.join(buildDir, t.subdir) : buildDir
    run('cmake', ['--build', dir, '--config', config, '--parallel', '--target', t.name])
  }
  return buildDir
}

function expectFile(file) {
  if (!fs.existsSync(file)) fail(`no se generó ${file}`)
  log(`OK ${file}`)
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
if (!fs.existsSync(path.join(nativeRoot, 'plugin-host', 'vendor', 'miniaudio.h'))) {
  fail('falta native/plugin-host/vendor/miniaudio.h')
}

log(`config=${config} generador="${generator}"`)

const hostBuild = configureAndBuild('plugin-host', [{ name: 'jaswave-plugin-host' }, { name: 'JasWavePiano', subdir: 'piano-synth' }], [
  '-DJASWAVE_VST3_SDK=ON',
  '-DSMTG_ENABLE_VSTGUI_SUPPORT=OFF',
  '-DSMTG_ENABLE_VST3_PLUGIN_EXAMPLES=OFF',
])
const rolesBuild = configureAndBuild('jaswave-roles-vst', [{ name: 'JasWaveRoles' }])

// Multi-config (VS) deja el exe en <build>/<Config>/; single-config (Ninja) en <build>/.
const exe = [path.join(hostBuild, config, 'jaswave-plugin-host.exe'), path.join(hostBuild, 'jaswave-plugin-host.exe')].find(
  (p) => fs.existsSync(p),
)
expectFile(exe ?? path.join(hostBuild, config, 'jaswave-plugin-host.exe'))
expectFile(path.join(hostBuild, 'JasWavePiano.vst3', 'Contents', 'x86_64-win', 'JasWavePiano.vst3'))
expectFile(path.join(rolesBuild, 'JasWaveRoles.vst3', 'Contents', 'x86_64-win', 'JasWaveRoles.vst3'))

log('listo. Siguiente paso: npm run pack:win (stage:host copia los binarios a jas-wave/resources).')
