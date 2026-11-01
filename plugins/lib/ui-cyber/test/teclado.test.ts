import { describe, expect, it } from 'vitest'
import { notaEnTeclado } from '../src/dibujo'
import type { Rect4 } from '../src/tipos'

// 52 blancas de 10 unidades: x = 0..520, alto 100 (negras hasta y = 60)
const kb: Rect4 = [0, 0, 520, 100]

describe('teclado en pantalla', () => {
  it('la primera blanca es A0 (21) y la última C8 (108)', () => {
    expect(notaEnTeclado(kb, 5, 90)).toBe(21)
    expect(notaEnTeclado(kb, 515, 90)).toBe(108)
  })
  it('las negras van encima de las blancas', () => {
    // A#0 (22) está centrada en el borde entre A0 y B0 (x = 10)
    expect(notaEnTeclado(kb, 10, 30)).toBe(22)
    // la misma x por debajo de las negras es una blanca
    expect(notaEnTeclado(kb, 11, 90)).toBe(23)
  })
  it('fuera del teclado no hay nota', () => {
    expect(notaEnTeclado(kb, -1, 50)).toBeNull()
    expect(notaEnTeclado(kb, 100, 101)).toBeNull()
  })
})
