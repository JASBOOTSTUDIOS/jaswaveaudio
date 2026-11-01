/**
 * Roundtrip real del estado VST3 contra el host nativo suelto (cli/host-estado-roundtrip.mjs).
 * Opt-in: abre el exe y el dispositivo de audio, así que solo corre con JASWAVE_TEST_HOST=1 y si existen el
 * exe compilado y los plugins propios instalados.
 *   JASWAVE_TEST_HOST=1 npx tsx --test src/lib/plugin/host-estado-roundtrip.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..', '..', '..')
const exe = path.join(raiz, '..', 'native', 'plugin-host', 'build-release', 'Release', 'jaswave-plugin-host.exe')
const dirPlugins = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Common', 'VST3', 'JasWave')
const hayTodo = process.env.JASWAVE_TEST_HOST === '1' && fs.existsSync(exe) && fs.existsSync(path.join(dirPlugins, 'JasWaveParamEq.vst3'))

test('host: getPluginState -> unload -> load -> setPluginState devuelve parámetros y estado', { skip: !hayTodo, timeout: 240_000 }, () => {
  const r = spawnSync(process.execPath, [path.join(raiz, 'cli', 'host-estado-roundtrip.mjs'), '--reprepare'], {
    cwd: raiz,
    encoding: 'utf8',
    timeout: 220_000,
  })
  const lineas = r.stdout.split('\n').filter((l) => l.startsWith('{'))
  assert.ok(lineas.length >= 1, `sin salida del roundtrip: ${r.stderr}`)
  for (const l of lineas) {
    const res = JSON.parse(l) as { plugin: string; ok: boolean }
    assert.equal(res.ok, true, `${res.plugin}: ${l}`)
  }
  assert.equal(r.status, 0)
})
