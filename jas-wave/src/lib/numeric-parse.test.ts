/**
 * npx tsx --test src/lib/numeric-parse.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizarNumero, parsearNumero } from './numeric-parse'

const BPM = { min: 20, max: 300 }
const NUMERADOR = { entero: true, min: 1, max: 32, recortar: false }
const DENOMINADOR = { entero: true, permitidos: [1, 2, 4, 8, 16, 32] as const }

describe('parsearNumero (NumericField)', () => {
  it('BPM vacío, espacios o texto se rechazan (nunca 0 ni NaN)', () => {
    for (const texto of ['', '   ', 'abc', 'NaN', '1e999']) {
      const r = parsearNumero(texto, BPM)
      assert.equal(r.ok, false, `«${texto}» debía rechazarse`)
    }
  })

  it('BPM fuera de rango se recorta; 0 → 20 y 999 → 300', () => {
    assert.deepEqual(parsearNumero('0', BPM), { ok: true, valor: 20 })
    assert.deepEqual(parsearNumero('999', BPM), { ok: true, valor: 300 })
    assert.deepEqual(parsearNumero(' 128,5 ', BPM), { ok: true, valor: 128.5 })
  })

  it('numerador: entero 1–32 sin recorte', () => {
    assert.deepEqual(parsearNumero('7', NUMERADOR), { ok: true, valor: 7 })
    assert.equal(parsearNumero('4.5', NUMERADOR).ok, false)
    assert.equal(parsearNumero('0', NUMERADOR).ok, false)
    assert.equal(parsearNumero('33', NUMERADOR).ok, false)
  })

  it('denominador: solo potencias de 2 hasta 32', () => {
    for (const d of [1, 2, 4, 8, 16, 32]) assert.deepEqual(parsearNumero(String(d), DENOMINADOR), { ok: true, valor: d })
    for (const d of ['3', '5', '0', '64', '6']) {
      const r = parsearNumero(d, DENOMINADOR)
      assert.equal(r.ok, false)
      if (!r.ok) assert.match(r.error, /1, 2, 4, 8, 16 o 32/)
    }
  })

  it('normalizarNumero rechaza NaN/Infinity', () => {
    assert.equal(normalizarNumero(Number.NaN, BPM).ok, false)
    assert.equal(normalizarNumero(Infinity, BPM).ok, false)
    assert.deepEqual(normalizarNumero(120, BPM), { ok: true, valor: 120 })
  })
})
