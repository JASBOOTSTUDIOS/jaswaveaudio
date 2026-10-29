/**
 * npx tsx --test src/lib/plugin/discovery.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { catalogPluginInsertable, descriptorFromDiscovered } from './discovery'
import { defaultVst3SearchPaths } from './search-paths'

describe('descriptorFromDiscovered', () => {
  it('marca VST2 como no insertable e incompatible', () => {
    const d = descriptorFromDiscovered({
      path: 'C:/Program Files/VSTPlugins/W-Limit.dll',
      name: 'W-Limit',
      format: 'vst2',
      hostReady: false,
    })
    assert.equal(d.format, 'vst2')
    assert.equal(d.hostReady, false)
    assert.equal(catalogPluginInsertable(d), false)
    assert.equal(d.scanStatus, 'blacklisted')
    assert.match(d.scanError ?? '', /no soportado|vst3/i)
  })

  it('infiere vst2 por extensión y fuerza hostReady en false por estabilidad', () => {
    const d = descriptorFromDiscovered({
      path: 'D:/EQ/ValhallaRoom.dll',
      name: 'ValhallaRoom',
      hostReady: true,
    })
    assert.equal(d.format, 'vst2')
    assert.equal(d.hostReady, false)
    assert.equal(catalogPluginInsertable(d), false)
  })

  it('VST3 hostReady sí se puede insertar', () => {
    const d = descriptorFromDiscovered({
      path: 'C:/Program Files/Common Files/VST3/Piano.vst3',
      name: 'Piano',
      format: 'vst3',
      hostReady: true,
      editorReady: true,
    })
    assert.equal(d.format, 'vst3')
    assert.equal(catalogPluginInsertable(d), true)
  })
})

describe('defaultVst3SearchPaths win32', () => {
  it('no incluye ninguna carpeta VST2 (retirado, ADR-0019) y mantiene las VST3 habilitadas', () => {
    const paths = defaultVst3SearchPaths('win32')
    assert.ok(!paths.some((p) => p.format === 'vst2'), 'sin carpetas VST2')
    assert.ok(paths.some((p) => p.format === 'vst3' && p.enabled === true))
  })
})

import { elegirCopiasDelCatalogo, prioridadDeRutaJasWave } from './discovery'

describe('elegirCopiasDelCatalogo', () => {
  const hallado = (path: string) => ({ path, name: path.replace(/^.*\//, '').replace(/[.]vst3$/i, ''), format: 'vst3', hostReady: true })

  it('un plugin propio repetido se queda con la instalación de usuario y no con la compilación de desarrollo', () => {
    const dev = hallado('C:/src/jaswave-ia/plugins/build/VST3/Release/JasWaveGrandPiano.vst3')
    const usuario = hallado('C:/Users/a/AppData/Local/Programs/Common/VST3/JasWave/JasWaveGrandPiano.vst3')
    // da igual el orden en que se encontraron
    assert.deepEqual(elegirCopiasDelCatalogo([dev, usuario]).map((x) => x.path), [usuario.path])
    assert.deepEqual(elegirCopiasDelCatalogo([usuario, dev]).map((x) => x.path), [usuario.path])
  })

  it('prioridad: usuario < empaquetado < otras < compilación de desarrollo', () => {
    const p = prioridadDeRutaJasWave
    assert.ok(p('C:/Users/a/AppData/Local/Programs/Common/VST3/JasWave/X.vst3') < p('C:/App/resources/vst3/JasWave/X.vst3'))
    assert.ok(p('C:/App/resources/vst3/JasWave/X.vst3') < p('D:/Otra/X.vst3'))
    assert.ok(p('D:/Otra/X.vst3') < p('C:/src/jaswave-ia/plugins/build/VST3/Release/X.vst3'))
  })

  it('quita duplicados de la misma ruta (mayúsculas y tipo de barra) y respeta los plugins de terceros', () => {
    const a = hallado('C:/Program Files/Common Files/VST3/BFDPlayer.vst3')
    const b = hallado('c:/program files/common files/vst3/bfdplayer.vst3')
    const otro = hallado('D:/Studio/BFDPlayer.vst3') // tercero con el mismo nombre en otra carpeta: no se toca
    assert.equal(elegirCopiasDelCatalogo([a, b, otro]).length, 2)
  })
})

import { mejorCopiaJasWave } from './rutas-jaswave'
import { resolveHostPluginPath } from './plugin-info-adapter'

describe('mejorCopiaJasWave / resolveHostPluginPath', () => {
  const usuario = 'C:/Users/a/AppData/Local/Programs/Common/VST3/JasWave/JasWaveShimmerPad.vst3'
  const dev = 'C:/src/jaswave-ia/plugins/build/VST3/Release/JasWaveShimmerPad.vst3'

  it('una ruta guardada en el proyecto apuntando a la compilación de desarrollo pasa a la instalación de usuario', () => {
    assert.equal(mejorCopiaJasWave(dev, [{ path: usuario }, { path: dev }]), usuario)
  })

  it('no cambia plugins de terceros ni rutas que ya son la mejor opción', () => {
    assert.equal(mejorCopiaJasWave('C:/VST3/BFDPlayer.vst3', [{ path: 'D:/otro/BFDPlayer.vst3' }]), 'C:/VST3/BFDPlayer.vst3')
    assert.equal(mejorCopiaJasWave(usuario, [{ path: dev }]), usuario)
    assert.equal(mejorCopiaJasWave(dev, []), dev)
  })

  it('resolveHostPluginPath aplica la sustitución a la ruta guardada en el plugin del proyecto', () => {
    const r = resolveHostPluginPath(
      { id: 'x', nombre: 'JasWave Shimmer Pad', descripcion: dev },
      [{ pluginId: 'a', name: 'JasWaveShimmerPad', path: usuario }],
    )
    assert.equal(r, usuario)
  })
})

import { PluginRegistry } from './registry'

describe('descriptorFromDiscovered con plugins propios', () => {
  it('usa el nombre comercial y el tipo del manifiesto, no el nombre del archivo', () => {
    const piano = descriptorFromDiscovered({ path: 'C:/VST3/JasWave/JasWaveGrandPiano.vst3', hostReady: true } as never)
    assert.equal(piano.name, 'JasWave Grand Piano')
    assert.equal(piano.isInstrument, true)
    const cuerdas = descriptorFromDiscovered({ path: 'C:/VST3/JasWave/JasWaveStringsSection.vst3', hostReady: true } as never)
    assert.equal(cuerdas.isInstrument, true)
    const tune = descriptorFromDiscovered({ path: 'C:/VST3/JasWave/JasWaveVocalTune.vst3', hostReady: true } as never)
    assert.equal(tune.name, 'JasWave Vocal Tune')
    assert.equal(tune.isInstrument, false)
    // Un plugin de terceros conserva el nombre de su archivo.
    assert.equal(descriptorFromDiscovered({ path: 'C:/VST3/Serum.vst3', hostReady: true } as never).name, 'Serum')
  })
})

describe('PluginRegistry.findByName con nombres de manifiesto', () => {
  it('encuentra «JasWave True-Peak Limiter Pro» aunque el archivo se llame JasWaveTruePeakLimiter', () => {
    const reg = new PluginRegistry()
    reg.register({ pluginId: 'a', name: 'JasWaveTruePeakLimiter', format: 'vst3', path: 'C:/x/JasWaveTruePeakLimiter.vst3' } as never)
    assert.equal(reg.findByName('JasWave True-Peak Limiter Pro').length, 1)
    assert.equal(reg.findByName('JasWave EQ Parametric Pro').length, 0)
  })
})
