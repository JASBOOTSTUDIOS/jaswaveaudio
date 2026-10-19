/**
 * npx tsx --test src/lib/plugin/bundled-plugins.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isBundledJasWavePath, JASWAVE_ROLES_BUNDLE, pickJasWavePluginPath } from './bundled-plugins'
import {
  BUNDLED_VST3_SEARCH_PATH_ID,
  defaultVst3SearchPaths,
  pluginSearchPaths,
  setBundledVst3SearchDir,
} from './search-paths'

const USER = 'C:\\Users\\a\\AppData\\Local\\Programs\\Common\\VST3\\JasWave\\JasWaveRoles.vst3'
const BUNDLED_DIR = 'C:\\Users\\a\\AppData\\Local\\Programs\\JasWave\\resources\\vst3\\JasWave'
const BUNDLED = `${BUNDLED_DIR}\\JasWaveRoles.vst3`

describe('pickJasWavePluginPath', () => {
  it('prefiere la instalación de usuario si existe', async () => {
    const r = await pickJasWavePluginPath(JASWAVE_ROLES_BUNDLE, USER, BUNDLED_DIR, async () => true)
    assert.deepEqual(r, { path: USER, source: 'user' })
  })

  it('usa el bundle incluido si falta la de usuario', async () => {
    const r = await pickJasWavePluginPath(JASWAVE_ROLES_BUNDLE, USER, BUNDLED_DIR, async (p) => p === BUNDLED)
    assert.deepEqual(r, { path: BUNDLED, source: 'bundled' })
    assert.ok(isBundledJasWavePath(r.path))
  })

  it('sin bundle (dev) devuelve la ruta de usuario', async () => {
    const r = await pickJasWavePluginPath(JASWAVE_ROLES_BUNDLE, USER, '', async () => {
      throw new Error('sin permiso')
    })
    assert.deepEqual(r, { path: USER, source: 'missing' })
    assert.equal(isBundledJasWavePath(USER), false)
  })
})

describe('setBundledVst3SearchDir', () => {
  it('añade y retira la carpeta incluida de las rutas de escaneo', () => {
    assert.ok(!defaultVst3SearchPaths('win32').some((p) => p.id === BUNDLED_VST3_SEARCH_PATH_ID))
    setBundledVst3SearchDir(`${BUNDLED_DIR}\\`)
    assert.ok(defaultVst3SearchPaths('win32').some((p) => p.path === BUNDLED_DIR))
    assert.equal(pluginSearchPaths.list().filter((p) => p.id === BUNDLED_VST3_SEARCH_PATH_ID).length, 1)
    assert.ok(!defaultVst3SearchPaths('darwin').some((p) => p.id === BUNDLED_VST3_SEARCH_PATH_ID))
    setBundledVst3SearchDir('')
    assert.ok(!pluginSearchPaths.list().some((p) => p.id === BUNDLED_VST3_SEARCH_PATH_ID))
  })
})
