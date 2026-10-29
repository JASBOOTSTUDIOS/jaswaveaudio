import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  avisoSilenciado,
  espacioReducido,
  mensajeEspacio,
  restablecerAvisosEspacio,
  silenciarAviso,
  umbralOperativo,
} from './space-guard'

function memoria() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

describe('espacioReducido', () => {
  it('avisa por alto o por ancho bajo el umbral', () => {
    const u = { w: 500, h: 300 }
    assert.equal(espacioReducido({ width: 800, height: 400 }, u), false)
    assert.equal(espacioReducido({ width: 800, height: 299 }, u), true)
    assert.equal(espacioReducido({ width: 499, height: 400 }, u), true)
  })

  it('no avisa sin umbral ni antes de la primera medida (0×0)', () => {
    assert.equal(espacioReducido({ width: 10, height: 10 }, null), false)
    assert.equal(espacioReducido({ width: 0, height: 0 }, { w: 500, h: 300 }), false)
  })

  it('el umbral del mixer coincide con el nivel completo del mixer', () => {
    assert.deepEqual(umbralOperativo('mixer'), { h: 420 })
    assert.equal(umbralOperativo('arrange'), null)
  })

  it('el mensaje dice qué dimensión falta', () => {
    assert.match(mensajeEspacio('Mixer', { width: 900, height: 200 }, { h: 390 }), /Poca altura para Mixer/)
    assert.match(mensajeEspacio('Piano Roll', { width: 300, height: 200 }, { w: 520, h: 300 }), /Poco espacio/)
  })
})

describe('Recordar preferencia', () => {
  it('silencia por herramienta y se restablece', () => {
    const s = memoria()
    assert.equal(avisoSilenciado('mixer', s), false)
    silenciarAviso('mixer', s)
    assert.equal(avisoSilenciado('mixer', s), true)
    assert.equal(avisoSilenciado('piano-roll', s), false)
    restablecerAvisosEspacio(s)
    assert.equal(avisoSilenciado('mixer', s), false)
  })

  it('tolera almacenamiento corrupto o ausente', () => {
    const s = memoria()
    s.setItem('jaswave.avisoEspacio.silenciados', '{no json')
    assert.equal(avisoSilenciado('mixer', s), false)
    assert.equal(avisoSilenciado('mixer', null), false)
  })
})
