/**
 * npx tsx --test src/lib/plugin/bundled-plugins.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isBundledJasWavePath,
  JASWAVE_ROLES_BUNDLE,
  pickJasWavePluginPath,
  defaultJasWaveFxPath,
  isJasWaveFxDescriptor,
  isJasWaveFxPlugin,
  JASWAVE_FX_EQ,
  JASWAVE_FX_COMP,
  JASWAVE_FX_LIMITER,
  JASWAVE_FX_UTILITY,
  JASWAVE_FX_DEESSER,
} from './bundled-plugins'
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

describe('defaultJasWaveFxPath', () => {
  it('devuelve una ruta absoluta bajo LOCALAPPDATA cuando existe', () => {
    const p = defaultJasWaveFxPath()
    assert.ok(p.endsWith('\\JasWaveFx.vst3') || p.endsWith('/JasWaveFx.vst3'))
    assert.ok(p.includes('Common\\VST3\\JasWave') || p.includes('Common/VST3/JasWave'))
  })
})

describe('isJasWaveFxDescriptor', () => {
  it('reconoce nombre JasWave FX', () => {
    assert.ok(isJasWaveFxDescriptor({ name: 'JasWave EQ', vendor: 'JasWave' }))
    assert.ok(isJasWaveFxDescriptor({ name: 'JasWave Compresor', vendor: 'JasWave' }))
    assert.ok(isJasWaveFxDescriptor({ path: 'C:\\x\\JasWaveFx.vst3' }))
  })
  it('no reconoce roles ni piano', () => {
    assert.ok(!isJasWaveFxDescriptor({ name: 'JasWave Roles', vendor: 'JasWave' }))
    assert.ok(!isJasWaveFxDescriptor({ name: 'JasWave Piano', vendor: 'JasWave' }))
    assert.ok(!isJasWaveFxDescriptor({ name: 'Serum', vendor: 'Xfer' }))
  })
})

describe('isJasWaveFxPlugin', () => {
  it('reconoce cada FX por nombre', () => {
    assert.ok(isJasWaveFxPlugin({ nombre: 'JasWave EQ' }))
    assert.ok(isJasWaveFxPlugin({ nombre: 'JasWave Compresor' }))
    assert.ok(isJasWaveFxPlugin({ nombre: 'JasWave Limitador' }))
    assert.ok(isJasWaveFxPlugin({ nombre: 'JasWave Utility' }))
    assert.ok(isJasWaveFxPlugin({ nombre: 'JasWave De-esser' }))
    assert.ok(isJasWaveFxPlugin({ nombre: 'JasWave Roles', vendor: 'JasWave', category: 'efecto' }))
  })
  it('rechaza no-FX', () => {
    assert.ok(!isJasWaveFxPlugin({ nombre: 'Serum', vendor: 'Xfer', category: 'instrument' }))
    assert.ok(!isJasWaveFxPlugin({ nombre: 'Piano', vendor: 'JasWave', category: 'instrumento' }))
  })
})

describe('JasWave FX parameter IDs', () => {
  it('EQ: bypass 0, 8 bandas stride 5, output 41', () => {
    assert.equal(JASWAVE_FX_EQ.bypass, 0)
    assert.equal(JASWAVE_FX_EQ.bandBase, 1)
    assert.equal(JASWAVE_FX_EQ.bandStride, 5)
    assert.equal(JASWAVE_FX_EQ.numBands, 8)
    assert.equal(JASWAVE_FX_EQ.output, 41)
    const b3 = { base: 1 + (3 - 1) * 5 }
    assert.equal(b3.base, 11)
  })
  it('Compresor: ids esperados + GR read-only 40', () => {
    assert.equal(JASWAVE_FX_COMP.bypass, 0)
    assert.equal(JASWAVE_FX_COMP.threshold, 1)
    assert.equal(JASWAVE_FX_COMP.ratio, 2)
    assert.equal(JASWAVE_FX_COMP.attack, 3)
    assert.equal(JASWAVE_FX_COMP.release, 4)
    assert.equal(JASWAVE_FX_COMP.knee, 5)
    assert.equal(JASWAVE_FX_COMP.makeup, 6)
    assert.equal(JASWAVE_FX_COMP.mix, 7)
    assert.equal(JASWAVE_FX_COMP.sidechainHp, 8)
    assert.equal(JASWAVE_FX_COMP.grReadOnly, 40)
  })
  it('Limitador: ceiling/inputGain/release/lookahead + GR 40', () => {
    assert.equal(JASWAVE_FX_LIMITER.bypass, 0)
    assert.equal(JASWAVE_FX_LIMITER.ceiling, 1)
    assert.equal(JASWAVE_FX_LIMITER.inputGain, 2)
    assert.equal(JASWAVE_FX_LIMITER.release, 3)
    assert.equal(JASWAVE_FX_LIMITER.lookahead, 4)
    assert.equal(JASWAVE_FX_LIMITER.grReadOnly, 40)
  })
  it('Utility: gain/width/monoBelow/inverts/balance', () => {
    assert.equal(JASWAVE_FX_UTILITY.bypass, 0)
    assert.equal(JASWAVE_FX_UTILITY.gain, 1)
    assert.equal(JASWAVE_FX_UTILITY.width, 2)
    assert.equal(JASWAVE_FX_UTILITY.monoBelow, 3)
    assert.equal(JASWAVE_FX_UTILITY.invertL, 4)
    assert.equal(JASWAVE_FX_UTILITY.invertR, 5)
    assert.equal(JASWAVE_FX_UTILITY.balance, 6)
  })
  it('De-esser: freq/threshold/range/mode', () => {
    assert.equal(JASWAVE_FX_DEESSER.bypass, 0)
    assert.equal(JASWAVE_FX_DEESSER.freq, 1)
    assert.equal(JASWAVE_FX_DEESSER.threshold, 2)
    assert.equal(JASWAVE_FX_DEESSER.range, 3)
    assert.equal(JASWAVE_FX_DEESSER.mode, 4)
  })
})
