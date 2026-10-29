/**
 * Arreglista: medición determinista de tiempo, armonía y ritmo frente a la hoja de ruta.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { analizarCoherencia, parsearAcorde, parsearTonalidad, type HojaCoherencia } from '../src/motor/turno/coherencia-banda'

type N = { pitch: number; inicio: number; duracion: number }
const clip = (inicio: number, duracion: number, notas: N[]) => ({ id: `c${inicio}`, nombre: `clip ${inicio}`, inicio, duracion, notas })
const estado = (tracks: Array<{ nombre: string; clips: ReturnType<typeof clip>[] }>) =>
  ({ project: { timeSignature: { numerador: 4 }, tracks: tracks.map((t, i) => ({ id: `t${i}`, plugins: [], ...t })) } }) as never

// 2 secciones de 2 compases: D | G  ·  Bm | A/C#  (16 beats)
const HOJA: HojaCoherencia = {
  tonalidad: 'Re mayor',
  numerador: 4,
  secciones: [
    { nombre: 'Verso', compases: 2, acordes: ['D', 'G'] },
    { nombre: 'Coro', compases: 2, acordes: ['Bm', 'A/C#'] },
  ],
}
const bombos = (desde: number, hasta: number) => Array.from({ length: (hasta - desde) / 2 }, (_, i) => ({ pitch: 36, inicio: i * 2, duracion: 0.25 }))
const bajoBien = [
  { pitch: 38, inicio: 0, duracion: 2 },
  { pitch: 38, inicio: 2, duracion: 2 },
  { pitch: 43, inicio: 4, duracion: 2 },
  { pitch: 43, inicio: 6, duracion: 2 },
]
const bajoCoro = [
  { pitch: 47, inicio: 0, duracion: 2 },
  { pitch: 47, inicio: 2, duracion: 2 },
  { pitch: 49, inicio: 4, duracion: 2 },
  { pitch: 49, inicio: 6, duracion: 2 },
]

describe('coherencia de la banda', () => {
  it('entiende tonalidades y cifrados', () => {
    assert.deepEqual(parsearTonalidad('Re mayor'), { raiz: 2, menor: false })
    assert.deepEqual(parsearTonalidad('Si menor'), { raiz: 11, menor: true })
    assert.deepEqual(parsearTonalidad('F# minor'), { raiz: 6, menor: true })
    assert.deepEqual(parsearTonalidad('Mi bemol mayor'), { raiz: 3, menor: false })
    assert.deepEqual(parsearTonalidad('Bb'), { raiz: 10, menor: false })
    const gb = parsearAcorde('G/B')!
    assert.equal(gb.raiz, 7)
    assert.equal(gb.bajo, 11)
    assert.deepEqual([...parsearAcorde('Bm7')!.notas].sort((a, b) => a - b), [2, 6, 9, 11])
    assert.ok(parsearAcorde('A7sus4')!.notas.has(2) && !parsearAcorde('A7sus4')!.notas.has(1))
  })

  it('una banda que sigue la hoja aprueba', () => {
    const m = analizarCoherencia(
      estado([
        { nombre: 'Batería', clips: [clip(0, 8, bombos(0, 8)), clip(8, 8, bombos(0, 8))] },
        { nombre: 'Bajo', clips: [clip(0, 8, bajoBien), clip(8, 8, bajoCoro)] },
        { nombre: 'Piano', clips: [clip(0, 8, [{ pitch: 62, inicio: 0, duracion: 4 }, { pitch: 67, inicio: 4, duracion: 4 }]), clip(8, 8, [{ pitch: 59, inicio: 0, duracion: 4 }, { pitch: 61, inicio: 4, duracion: 4 }])] },
      ]),
      HOJA,
    )
    assert.deepEqual(m, { ok: true, detalles: [] })
  })

  it('detecta problemas de tiempo, armonía y ritmo con sus compases', () => {
    const m = analizarCoherencia(
      estado([
        // La batería se apaga tras el verso.
        { nombre: 'Batería', clips: [clip(0, 8, bombos(0, 8))] },
        // Bajo: fundamental equivocada y a contratiempo del bombo.
        { nombre: 'Bajo', clips: [clip(0, 8, [{ pitch: 40, inicio: 0.5, duracion: 1 }, { pitch: 40, inicio: 4.5, duracion: 1 }, { pitch: 41, inicio: 0, duracion: 1 }, { pitch: 41, inicio: 4, duracion: 1 }]), clip(8, 8, bajoCoro)] },
        // Piano: clip a mitad de compás, notas fuera del acorde y después del final.
        { nombre: 'Piano', clips: [clip(2, 18, [{ pitch: 65, inicio: 0, duracion: 2 }, { pitch: 65, inicio: 2, duracion: 2 }, { pitch: 63, inicio: 6, duracion: 4 }, { pitch: 62, inicio: 15, duracion: 1 }])] },
      ]),
      HOJA,
    )
    assert.equal(m.ok, false)
    const t = m.detalles.join('\n')
    assert.match(t, /«Batería»: deja de sonar en el compás 2 .*Coro/)
    assert.match(t, /«Bajo»: en el primer tiempo no toca la fundamental .*compases 1–2/)
    assert.match(t, /«Piano»: un clip empieza a mitad de compás \(beat 2\)/)
    assert.match(t, /«Piano»: 1 notas suenan después del final/)
    assert.match(t, /«Piano»: notas largas fuera de Re mayor/)
  })

  it('una parte robótica (todo igual) se señala para devolverla al músico; una viva, no', () => {
    // 16 corcheas iguales de C–E–G, todas a la misma velocidad.
    const robot = Array.from({ length: 16 }, (_, i) => ({ pitch: [62, 66, 69][i % 3]!, inicio: i * 0.5, duracion: 0.5, velocidad: 90 }))
    // Misma cantidad de notas con duraciones, velocidades y micro-tiempo humanos (dentro del margen).
    const viva = Array.from({ length: 16 }, (_, i) => ({
      pitch: [62, 64, 66, 69, 71][i % 5]!,
      inicio: i * 0.5 + (i % 2 ? 0.03 : -0.02),
      duracion: [1, 0.5, 0.25, 0.75][i % 4]!,
      velocidad: 70 + ((i * 7) % 30),
    }))
    const m = analizarCoherencia(estado([{ nombre: 'Piano', clips: [clip(0, 8, robot), clip(8, 8, robot)] }, { nombre: 'Guitarra', clips: [clip(0, 8, viva), clip(8, 8, viva)] }]), HOJA)
    const t = m.detalles.join('\n')
    assert.match(t, /«Piano»: suena robótica: todas sus 32 notas duran lo mismo \(0\.5 beats\) y todas pegan casi igual/)
    assert.ok(!/«Guitarra»/.test(t), t)
  })

  it('el bajo que no coincide con el bombo se señala', () => {
    const kicks = Array.from({ length: 8 }, (_, i) => ({ pitch: 36, inicio: i * 2, duracion: 0.25 }))
    const bajo = Array.from({ length: 8 }, (_, i) => ({ pitch: i < 4 ? 38 : 47, inicio: i * 2 + 1, duracion: 0.5 }))
    const m = analizarCoherencia(estado([{ nombre: 'Drums', clips: [clip(0, 16, kicks)] }, { nombre: 'Bass', clips: [clip(0, 16, bajo)] }]), HOJA)
    assert.ok(m.detalles.some((d) => /«Bass»: solo coincide con el 0 % de los golpes de bombo/.test(d)), m.detalles.join('\n'))
  })
})
