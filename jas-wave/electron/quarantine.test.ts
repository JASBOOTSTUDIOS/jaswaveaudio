/**
 * npx tsx --test electron/quarantine.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  VENTANA_PRIMER_BLOQUE_MS,
  evaluarCuarentena,
  mensajeMotivoCuarentena,
  salidaAtribuibleAPlugin,
  type ContextoCuarentena,
} from './quarantine'

const base: ContextoCuarentena = {
  ahora: 10_000,
  cargaEnCurso: null,
  pluginCargado: null,
  cargadoEn: 0,
  bloqueAbierto: false,
}

describe('evaluarCuarentena', () => {
  it('sin carga en curso ni plugin cargado no hay cuarentena', () => {
    assert.equal(evaluarCuarentena(base), null)
  })

  it('con un load en curso aparta ese plugin', () => {
    const d = evaluarCuarentena({
      ...base,
      cargaEnCurso: { tipo: 'load', ruta: 'C:/plugins/bass.vst3' },
    })
    assert.deepEqual(d, { plugin: 'C:/plugins/bass.vst3', motivo: 'carga-en-curso' })
  })

  it('con un prepare en curso aparta el plugin de ese slot', () => {
    const d = evaluarCuarentena({
      ...base,
      cargaEnCurso: { tipo: 'prepare', ruta: 'C:/plugins/piano.vst3' },
    })
    assert.equal(d?.plugin, 'C:/plugins/piano.vst3')
    assert.equal(d?.motivo, 'carga-en-curso')
  })

  it('un load en curso sin ruta no aparta nada', () => {
    assert.equal(
      evaluarCuarentena({ ...base, cargaEnCurso: { tipo: 'load', ruta: '' } }),
      null,
    )
  })

  it('un comando que no es carga no dispara la cuarentena', () => {
    assert.equal(
      evaluarCuarentena({ ...base, cargaEnCurso: { tipo: 'noteOn', ruta: 'C:/x.vst3' } }),
      null,
    )
  })

  it('dentro del primer bloque del plugin se aparta', () => {
    const d = evaluarCuarentena({
      ...base,
      ahora: 1000,
      pluginCargado: 'C:/plugins/bass.vst3',
      cargadoEn: 900,
      bloqueAbierto: true,
    })
    assert.deepEqual(d, { plugin: 'C:/plugins/bass.vst3', motivo: 'primer-bloque' })
  })

  it('pasado el primer bloque no se aparta', () => {
    const d = evaluarCuarentena({
      ...base,
      ahora: 1000 + VENTANA_PRIMER_BLOQUE_MS + 1,
      pluginCargado: 'C:/plugins/bass.vst3',
      cargadoEn: 1000,
      bloqueAbierto: true,
    })
    assert.equal(d, null)
  })

  it('con el bloque cerrado no se aparta aunque sea reciente', () => {
    const d = evaluarCuarentena({
      ...base,
      ahora: 1000,
      pluginCargado: 'C:/plugins/bass.vst3',
      cargadoEn: 990,
      bloqueAbierto: false,
    })
    assert.equal(d, null)
  })

  it('una salida limpia (0) o del driver (1) no aparta al plugin aunque se estuviera cargando', () => {
    const cargando = { ...base, cargaEnCurso: { tipo: 'load', ruta: 'C:/plugins/pad.vst3' } }
    assert.equal(evaluarCuarentena({ ...cargando, codigoSalida: 1 }), null)
    assert.equal(evaluarCuarentena({ ...cargando, codigoSalida: 0 }), null)
    // Access violation (0xC0000005) o muerte por señal: sí es atribuible.
    assert.equal(evaluarCuarentena({ ...cargando, codigoSalida: 0xc0000005 })?.motivo, 'carga-en-curso')
    assert.equal(evaluarCuarentena({ ...cargando, codigoSalida: null })?.motivo, 'carga-en-curso')
    assert.equal(salidaAtribuibleAPlugin(3), true)
  })

  it('el motivo tiene texto legible', () => {
    assert.ok(mensajeMotivoCuarentena('carga-en-curso').includes('en curso'))
    assert.ok(mensajeMotivoCuarentena('primer-bloque').includes('primer bloque'))
  })
})
