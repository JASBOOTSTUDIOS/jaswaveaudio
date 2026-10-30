import assert from 'node:assert/strict'
import { test } from 'node:test'
import { crearHuella, huellaAJson } from '../../../../shared/src/grooves'
import { aplanarHuella } from './rejilla'

test('aplanarHuella: una fila por pieza con los compases unidos', () => {
  const notas = [0, 8, 4, 12].flatMap((s, i) => [{ pitch: i < 2 ? 36 : 38, velocidad: 100, inicio: s / 4 }]).concat([{ pitch: 42, velocidad: 70, inicio: 0.5 }])
  const a = aplanarHuella(huellaAJson(crearHuella(notas, { numerador: 4, denominador: 4 })))!
  assert.equal(a.pasos, 16)
  assert.equal(a.filas.length, 7)
  assert.equal(a.filas[0]![0], 3) // bombo en el paso 0, acento
  assert.equal(a.filas[0]![8], 3)
  assert.equal(a.filas[1]![4], 3) // caja
  assert.equal(a.filas[2]![2], 2) // hi-hat medio
  assert.equal(aplanarHuella({ v: 9 }), null)
})
