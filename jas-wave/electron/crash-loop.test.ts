/**
 * npx tsx --test electron/crash-loop.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  UMBRAL_CRASH_LOOP,
  VENTANA_CRASH_LOOP_MS,
  hayCrashLoop,
  limpiarSalidas,
  registrarSalidaInesperada,
} from './crash-loop'

describe('crash-loop', () => {
  it('registra las salidas dentro de la ventana', () => {
    let salidas: number[] = []
    salidas = registrarSalidaInesperada(salidas, 1000)
    salidas = registrarSalidaInesperada(salidas, 2000)
    assert.equal(salidas.length, 2)
  })

  it('descarta las salidas antiguas', () => {
    let salidas: number[] = []
    salidas = registrarSalidaInesperada(salidas, 0)
    salidas = registrarSalidaInesperada(salidas, VENTANA_CRASH_LOOP_MS + 10)
    assert.equal(salidas.length, 1)
  })

  it('no hay crash-loop con pocas salidas', () => {
    let salidas: number[] = []
    for (let i = 0; i < UMBRAL_CRASH_LOOP - 1; i++) {
      salidas = registrarSalidaInesperada(salidas, i * 100)
    }
    assert.equal(hayCrashLoop(salidas), false)
  })

  it('hay crash-loop al llegar al umbral', () => {
    let salidas: number[] = []
    for (let i = 0; i < UMBRAL_CRASH_LOOP; i++) {
      salidas = registrarSalidaInesperada(salidas, i * 100)
    }
    assert.equal(hayCrashLoop(salidas), true)
  })

  it('las salidas viejas no cuentan para el umbral', () => {
    let salidas: number[] = []
    for (let i = 0; i < UMBRAL_CRASH_LOOP; i++) {
      salidas = registrarSalidaInesperada(salidas, i * 100)
    }
    assert.equal(hayCrashLoop(salidas), true)
    // Una salida muy posterior deja solo la última: ya no hay bucle.
    salidas = registrarSalidaInesperada(salidas, 10 * VENTANA_CRASH_LOOP_MS)
    assert.equal(hayCrashLoop(salidas), false)
  })

  it('limpiarSalidas vacía el contador', () => {
    assert.deepEqual(limpiarSalidas(), [])
  })
})
