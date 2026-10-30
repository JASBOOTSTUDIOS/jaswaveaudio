import { describe, expect, it } from 'vitest'
import {
  UMBRALES_SIMILITUD,
  buscarSimilares,
  compararHuellas,
  crearHuella,
  huellaAJson,
  huellaDeJson,
  nivelDeSimilitud,
  type NotaHuella,
} from '../grooves'

const C44 = { numerador: 4, denominador: 4 }
const C68 = { numerador: 6, denominador: 8 }

/** Pequeño ayudante: golpes por compás en pasos de semicorchea (16 por compás de 4/4). */
function patron(pasosPorPieza: Record<number, number[]>, compases: number, opciones: { vel?: (p: number, s: number) => number; tempoJitter?: number } = {}): NotaHuella[] {
  const notas: NotaHuella[] = []
  for (let c = 0; c < compases; c++)
    for (const [pitch, pasos] of Object.entries(pasosPorPieza))
      for (const s of pasos) notas.push({ pitch: Number(pitch), inicio: c * 4 + s / 4 + (opciones.tempoJitter ?? 0), velocidad: opciones.vel ? opciones.vel(Number(pitch), s) : 90 })
  return notas
}

const rock = { 36: [0, 8, 10], 38: [4, 12], 42: [0, 2, 4, 6, 8, 10, 12, 14] }
const worship = { 36: [0, 6, 8], 37: [4, 12], 51: [0, 4, 8, 12], 53: [2, 10] }

describe('similitud de grooves', () => {
  it('el mismo groove con otras velocidades y micro-tiempos tiene la misma huella', () => {
    const a = crearHuella(patron(rock, 2), C44)
    const b = crearHuella(patron(rock, 2, { vel: (p, s) => 40 + ((p + s) % 7) * 12, tempoJitter: 0.03 }), C44)
    expect(b.hash).toBe(a.hash)
    expect(compararHuellas(a, b)).toMatchObject({ puntuacion: 100, nivel: 'duplicado', identica: true })
  })

  it('repetir el patrón más veces no cambia la huella', () => {
    expect(crearHuella(patron(rock, 4), C44).hash).toBe(crearHuella(patron(rock, 1), C44).hash)
  })

  it('un fill añadido en el último compás sigue siendo muy similar', () => {
    const base = patron(rock, 4)
    const conFill = [...base, ...[12, 13, 14, 15].map((s) => ({ pitch: 45 + (s % 3), inicio: 12 + s / 4, velocidad: 100 }))]
    const r = compararHuellas(crearHuella(base, C44), crearHuella(conFill, C44))
    expect(r.identica).toBe(false)
    expect(r.puntuacion).toBeGreaterThanOrEqual(UMBRALES_SIMILITUD.muySimilar)
    expect(r.puntuacion).toBeLessThan(UMBRALES_SIMILITUD.duplicado)
  })

  it('ghost notes de caja dejan un groove muy similar', () => {
    const base = patron(rock, 2)
    const ghost = [...base, ...[3, 7, 11].map((s) => ({ pitch: 38, inicio: s / 4, velocidad: 30 })), ...[3, 7, 11].map((s) => ({ pitch: 38, inicio: 4 + s / 4, velocidad: 30 }))]
    const r = compararHuellas(crearHuella(base, C44), crearHuella(ghost, C44))
    expect(r.puntuacion).toBeGreaterThanOrEqual(UMBRALES_SIMILITUD.similar)
    expect(r.identica).toBe(false)
  })

  it('el mismo groove desplazado un tiempo se reconoce como similar', () => {
    const base = patron(rock, 2)
    const movido = base.map((n) => ({ ...n, inicio: (n.inicio + 1) % 8 }))
    const r = compararHuellas(crearHuella(base, C44), crearHuella(movido, C44))
    expect(r.puntuacion).toBeGreaterThanOrEqual(UMBRALES_SIMILITUD.muySimilar)
    expect(Math.abs(r.desplazamiento)).toBe(1)
  })

  it('un groove distinto del mismo estilo no pasa de «distinto» o «similar» bajo', () => {
    const r = compararHuellas(crearHuella(patron(rock, 2), C44), crearHuella(patron(worship, 2), C44))
    expect(r.puntuacion).toBeLessThan(UMBRALES_SIMILITUD.muySimilar)
    expect(r.identica).toBe(false)
  })

  it('6/8 frente a 4/4 nunca llega a similar', () => {
    const seisOcho: NotaHuella[] = []
    for (let c = 0; c < 2; c++) {
      for (const e of [0, 1, 2, 3, 4, 5]) seisOcho.push({ pitch: 42, inicio: c * 3 + e * 0.5, velocidad: 80 })
      seisOcho.push({ pitch: 36, inicio: c * 3, velocidad: 100 }, { pitch: 38, inicio: c * 3 + 1.5, velocidad: 100 })
    }
    const a = crearHuella(seisOcho, C68)
    expect(a.pasosPorNegra).toBe(6)
    expect(a.pasos).toBe(18)
    const r = compararHuellas(a, crearHuella(patron(rock, 2), C44))
    expect(r.puntuacion).toBeLessThanOrEqual(50)
    expect(r.nivel).toBe('distinto')
  })

  it('niveles por umbral', () => {
    expect(nivelDeSimilitud(98)).toBe('duplicado')
    expect(nivelDeSimilitud(90)).toBe('muy-similar')
    expect(nivelDeSimilitud(72)).toBe('similar')
    expect(nivelDeSimilitud(40)).toBe('distinto')
  })

  it('se guarda y se recupera de JSON sin perder nada', () => {
    const h = crearHuella(patron(worship, 2), C44)
    const j = huellaDeJson(JSON.parse(JSON.stringify(huellaAJson(h))))
    expect(j).not.toBeNull()
    expect(compararHuellas(h, j!).identica).toBe(true)
    expect(huellaDeJson({ v: 2 })).toBeNull()
  })

  it('rendimiento: 1 propuesta contra 2.000 grooves en menos de 1 s', () => {
    const piezas = [36, 38, 42, 51, 49, 45]
    let semilla = 12345
    const azar = () => (semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const candidatos = Array.from({ length: 2000 }, (_, i) => {
      const por: Record<number, number[]> = {}
      for (const p of piezas) por[p] = Array.from({ length: 16 }, (_, s) => s).filter(() => azar() < (p === 42 ? 0.5 : 0.2))
      return { item: i, huella: crearHuella(patron(por, 1 + (i % 4)), C44) }
    })
    const consulta = crearHuella(patron(rock, 2), C44)
    const t0 = performance.now()
    const r = buscarSimilares(consulta, candidatos, { max: 10 })
    const ms = performance.now() - t0
    expect(ms).toBeLessThan(1000)
    expect(Array.isArray(r)).toBe(true)
    // Y encuentra al duplicado escondido entre ellos.
    const con = [...candidatos, { item: -1, huella: crearHuella(patron(rock, 4, { vel: () => 70 }), C44) }]
    expect(buscarSimilares(consulta, con, { max: 1 })[0]).toMatchObject({ item: -1, identica: true })
  })
})
