// Valida todos los .vst3 compilados con el validator del VST3 SDK y con pluginval (Tracktion).
//   node plugins/scripts/validate-plugins.mjs [--build plugins/build] [--config Release]
//        [--pluginval <ruta a pluginval.exe>] [--strictness 10] [--only Nombre1,Nombre2]
// Registros completos en <build>/validation/. Sale con 1 si algún plugin falla.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const build = path.resolve(opt('build', path.join(here, '..', 'build')))
const config = opt('config', 'Release')
const pluginval = opt('pluginval', process.env.PLUGINVAL || '')
const strictness = opt('strictness', '10')
const only = opt('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const vstDir = path.join(build, 'VST3', config)
const validator = [path.join(build, 'bin', config, 'validator.exe')].find((p) => fs.existsSync(p))
const logDir = path.join(build, 'validation')
fs.mkdirSync(logDir, { recursive: true })

if (!fs.existsSync(vstDir)) {
  console.error(`no existe ${vstDir}: compila primero los plugins`)
  process.exit(2)
}
const bundles = fs
  .readdirSync(vstDir)
  .filter((d) => d.endsWith('.vst3'))
  .filter((d) => only.length === 0 || only.includes(d.replace(/\.vst3$/, '')))

let failures = 0
const rows = []
for (const b of bundles) {
  const name = b.replace(/\.vst3$/, '')
  const bundle = path.join(vstDir, b)
  const row = { name, validator: 'no ejecutado', pluginval: 'no ejecutado' }
  if (validator) {
    const r = spawnSync(validator, [bundle], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    fs.writeFileSync(path.join(logDir, `${name}.validator.txt`), out)
    const m = /Result:\s*(\d+) tests passed,\s*(\d+) tests failed/.exec(out)
    row.validator = m ? `${m[1]} ok / ${m[2]} fallos` : `exit ${r.status}`
    if (r.status !== 0 || !m || m[2] !== '0') failures++
  }
  if (pluginval && fs.existsSync(pluginval)) {
    const r = spawnSync(
      pluginval,
      ['--strictness-level', strictness, '--validate-in-process', '--timeout-ms', '900000', '--validate', bundle],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    fs.writeFileSync(path.join(logDir, `${name}.pluginval.txt`), out)
    const ok = r.status === 0 && /\bSUCCESS\b/.test(out) && !/\bFAILED\b/.test(out)
    const nTests = (out.match(/Completed tests in/g) || []).length
    row.pluginval = ok ? `SUCCESS (nivel ${strictness}, ${nTests} grupos)` : `FALLO (exit ${r.status})`
    if (!ok) failures++
  }
  rows.push(row)
  console.log(`${name.padEnd(26)} validator: ${row.validator.padEnd(22)} pluginval: ${row.pluginval}`)
}
console.log(failures === 0 ? 'VALIDACIÓN: OK' : `VALIDACIÓN: ${failures} fallo(s) — ver ${logDir}`)
process.exit(failures === 0 ? 0 : 1)
