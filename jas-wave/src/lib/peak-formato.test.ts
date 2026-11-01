/**
 * npx tsx --test src/lib/peak-formato.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PEAK_VERSION, leerPeak, serializarPeak } from './peak-formato'

const peaks = Array.from({ length: 64 }, (_, i) => Math.sin(i / 5) * 0.8)
const firma = { size: 1_000_000, mtimeMs: 1_700_000_000_000 }

describe('formato .peak', () => {
  it('ida y vuelta con la misma firma', () => {
    const s = serializarPeak(peaks, firma)
    assert.equal(JSON.parse(s).version, PEAK_VERSION)
    assert.deepEqual(leerPeak(s, firma), peaks)
  })

  it('descarta la caché si el audio cambió (tamaño o fecha)', () => {
    const s = serializarPeak(peaks, firma)
    assert.equal(leerPeak(s, { ...firma, size: firma.size + 1 }), null)
    assert.equal(leerPeak(s, { ...firma, mtimeMs: firma.mtimeMs + 5000 }), null)
  })

  it('con firma en el archivo y sin poder comprobar el audio actual no se confía', () => {
    assert.equal(leerPeak(serializarPeak(peaks, firma), null), null)
  })

  it('sin firma guardada se acepta (audio fuera de alcance de stat) pero nunca si está corrupto', () => {
    assert.deepEqual(leerPeak(serializarPeak(peaks, null), null), peaks)
  })

  it('rechaza formatos antiguos, de otra versión, truncados o con valores no finitos', () => {
    assert.equal(leerPeak(JSON.stringify(peaks), firma), null) // v1: array plano
    assert.equal(leerPeak('no es json', firma), null)
    assert.equal(leerPeak('', firma), null)
    const v = JSON.parse(serializarPeak(peaks, firma))
    assert.equal(leerPeak(JSON.stringify({ ...v, version: 99 }), firma), null)
    assert.equal(leerPeak(JSON.stringify({ ...v, formato: 'otro' }), firma), null)
    assert.equal(leerPeak(JSON.stringify({ ...v, peaks: v.peaks.slice(0, 10) }), firma), null) // truncado
    assert.equal(leerPeak(JSON.stringify({ ...v, peaks: [...v.peaks.slice(0, 63), 'x'] }), firma), null)
    assert.equal(leerPeak(JSON.stringify({ ...v, peaks: [...v.peaks.slice(0, 63), 70] }), firma), null) // fuera de rango
    assert.equal(leerPeak(JSON.stringify({ ...v, peaks: [0, 0], valores: 2 }), firma), null) // demasiado corto
  })
})
