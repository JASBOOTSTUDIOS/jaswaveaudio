import { describe, expect, it } from 'vitest'
import {
  detectarFinProyecto,
  formatearDuracion,
  framesConCola,
  parsearDuracion,
} from '../render/fin-proyecto'

const pista = (id: string, clips: Array<{ inicio: number; duracion: number; silenciado?: boolean }>, extra = {}) => ({
  id,
  clips,
  ...extra,
})

describe('detectarFinProyecto', () => {
  it('toma el final del último clip y lo pasa a segundos con el tempo', () => {
    const r = detectarFinProyecto({
      bpm: { valor: 120 },
      tracks: [pista('a', [{ inicio: 0, duracion: 16 }]), pista('b', [{ inicio: 8, duracion: 64 }])],
    })
    expect(r.vacio).toBe(false)
    expect(r.finBeats).toBe(72)
    expect(r.finSegundos).toBeCloseTo(36)
    expect(r.inicioSegundos).toBe(0)
  })

  it('ignora pistas silenciadas y clips silenciados', () => {
    const r = detectarFinProyecto({
      bpm: { valor: 60 },
      tracks: [
        pista('a', [{ inicio: 0, duracion: 10 }]),
        pista('b', [{ inicio: 0, duracion: 100 }], { silenciada: true }),
        pista('c', [{ inicio: 0, duracion: 50, silenciado: true }]),
      ],
    })
    expect(r.finSegundos).toBe(10)
    expect(r.pistasConContenido).toEqual(['a'])
  })

  it('con solo activo solo cuentan las pistas en solo', () => {
    const r = detectarFinProyecto({
      bpm: { valor: 60 },
      tracks: [pista('a', [{ inicio: 0, duracion: 90 }]), pista('b', [{ inicio: 4, duracion: 6 }], { soloActiva: true })],
    })
    expect(r.finSegundos).toBe(10)
    expect(r.inicioSegundos).toBe(4)
  })

  it('proyecto sin clips audibles queda marcado como vacío', () => {
    expect(detectarFinProyecto({ tracks: [] }).vacio).toBe(true)
    expect(detectarFinProyecto({ tracks: [pista('a', [{ inicio: 0, duracion: 0 }])] }).vacio).toBe(true)
  })
})

describe('framesConCola', () => {
  const sr = 1000
  it('conserva la cola audible y medio segundo de silencio, recortando el resto', () => {
    const l = new Float32Array(10_000)
    for (let i = 0; i < 2000; i++) l[i] = 0.5
    for (let i = 2000; i < 3000; i++) l[i] = 0.01 // cola de reverb (-40 dB)
    expect(framesConCola([l], sr, 2000)).toBe(3000 + 500)
  })

  it('nunca recorta antes del final del contenido', () => {
    const l = new Float32Array(5000)
    expect(framesConCola([l], sr, 4000)).toBe(4000)
  })

  it('no pasa del largo renderizado', () => {
    const l = new Float32Array(1000).fill(0.3)
    expect(framesConCola([l], sr, 500)).toBe(1000)
  })
})

describe('duraciones', () => {
  it('formatea y parsea mm:ss', () => {
    expect(formatearDuracion(222)).toBe('3:42')
    expect(formatearDuracion(3725)).toBe('1:02:05')
    expect(parsearDuracion('3:42')).toBe(222)
    expect(parsearDuracion('1:02:05')).toBe(3725)
    expect(parsearDuracion('90')).toBe(90)
    expect(parsearDuracion('2:30.5')).toBe(150.5)
    expect(parsearDuracion('abc')).toBeNull()
    expect(parsearDuracion('')).toBeNull()
  })
})
