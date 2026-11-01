/**
 * Descarga el Steinberg VST3 SDK fijado (tag + submódulos mínimos) en
 * native/plugin-host/third_party/vst3sdk si no existe, y verifica el tag.
 *
 *   node native/scripts/fetch-vst3sdk.mjs            # clona si falta y verifica
 *   node native/scripts/fetch-vst3sdk.mjs --force    # borra y vuelve a clonar si el tag no coincide
 *   node native/scripts/fetch-vst3sdk.mjs --dir <ruta>
 *
 * No es un submódulo git: third_party/ está en .gitignore a propósito.
 * Variables opcionales: JASWAVE_VST3SDK_TAG, JASWAVE_VST3SDK_URL.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nativeRoot = path.join(__dirname, '..')

const SDK_TAG = process.env.JASWAVE_VST3SDK_TAG || 'v3.8.1_build_84'
const SDK_URL = process.env.JASWAVE_VST3SDK_URL || 'https://github.com/steinbergmedia/vst3sdk.git'
const SUBMODULES = ['base', 'cmake', 'pluginterfaces', 'public.sdk']
/** Ficheros que exigen native/plugin-host/CMakeLists.txt y los proyectos de plugins. */
const REQUIRED_FILES = [
  'CMakeLists.txt',
  'public.sdk/source/vst/hosting/module.h',
  'pluginterfaces/vst/ivstaudioprocessor.h',
  'base/source/fobject.cpp',
  'cmake/modules/SMTG_VST3_SDK.cmake',
]

const args = process.argv.slice(2)
const force = args.includes('--force')
const dirIdx = args.indexOf('--dir')
const sdkDir = path.resolve(
  dirIdx >= 0 && args[dirIdx + 1] ? args[dirIdx + 1] : path.join(nativeRoot, 'plugin-host', 'third_party', 'vst3sdk'),
)

function log(msg) {
  console.log(`[fetch-vst3sdk] ${msg}`)
}

function fail(msg) {
  console.error(`[fetch-vst3sdk] ERROR: ${msg}`)
  process.exit(1)
}

function git(gitArgs, opts = {}) {
  return execFileSync('git', gitArgs, { stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8' })
}

function gitOut(gitArgs) {
  try {
    return git(gitArgs, { capture: true }).trim()
  } catch {
    return ''
  }
}

function missingFiles() {
  return REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(sdkDir, f)))
}

/** Devuelve null si HEAD coincide con el tag; si no, el motivo. */
function tagMismatch() {
  if (!fs.existsSync(path.join(sdkDir, '.git'))) return 'no es un checkout git (copia manual)'
  const head = gitOut(['-C', sdkDir, 'rev-parse', 'HEAD'])
  const tagCommit = gitOut(['-C', sdkDir, 'rev-parse', `${SDK_TAG}^{commit}`])
  if (!head) return 'no se pudo leer HEAD'
  if (!tagCommit) return `el tag ${SDK_TAG} no existe en el checkout`
  if (head !== tagCommit) return `HEAD ${head.slice(0, 10)} ≠ ${SDK_TAG} (${tagCommit.slice(0, 10)})`
  return null
}

function cloneSdk() {
  fs.mkdirSync(path.dirname(sdkDir), { recursive: true })
  log(`clonando ${SDK_URL} @ ${SDK_TAG} → ${sdkDir}`)
  git(['clone', '--depth', '1', '--branch', SDK_TAG, '-c', 'advice.detachedHead=false', SDK_URL, sdkDir])
  updateSubmodules()
}

function updateSubmodules() {
  log(`submódulos: ${SUBMODULES.join(', ')}`)
  git(['-C', sdkDir, 'submodule', 'update', '--init', '--depth', '1', '--', ...SUBMODULES])
}

try {
  execFileSync('git', ['--version'], { stdio: 'ignore' })
} catch {
  fail('git no está en el PATH.')
}

if (!fs.existsSync(path.join(sdkDir, 'CMakeLists.txt'))) {
  if (fs.existsSync(sdkDir) && fs.readdirSync(sdkDir).length > 0) {
    if (!force) fail(`${sdkDir} existe pero no parece el SDK. Bórralo o usa --force.`)
    fs.rmSync(sdkDir, { recursive: true, force: true })
  }
  cloneSdk()
} else {
  const mismatch = tagMismatch()
  if (mismatch) {
    if (force) {
      log(`tag no coincide (${mismatch}); --force: se vuelve a clonar`)
      fs.rmSync(sdkDir, { recursive: true, force: true })
      cloneSdk()
    } else if (fs.existsSync(path.join(sdkDir, '.git'))) {
      fail(`SDK presente pero ${mismatch}. Usa --force para reemplazarlo por ${SDK_TAG}.`)
    } else {
      // Copia manual sin .git: no se puede verificar; se acepta con aviso si tiene los ficheros.
      console.warn(`[fetch-vst3sdk] WARN: ${mismatch}; no se puede verificar ${SDK_TAG}.`)
    }
  } else if (missingFiles().length > 0) {
    updateSubmodules()
  }
}

const missing = missingFiles()
if (missing.length > 0) fail(`faltan ficheros del SDK: ${missing.join(', ')}`)
const mismatch = tagMismatch()
if (mismatch && fs.existsSync(path.join(sdkDir, '.git'))) fail(mismatch)

log(`OK: VST3 SDK ${SDK_TAG} en ${sdkDir}`)
