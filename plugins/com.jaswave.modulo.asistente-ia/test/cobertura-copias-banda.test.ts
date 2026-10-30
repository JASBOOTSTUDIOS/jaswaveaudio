/**
 * Plan S: cobertura real por compás, límite «solo…» explícito, copias exactas y nombres de clip.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { analizarCoherencia, copiasExactas, diagnosticoEscritura, seccionesFaltantes, type HojaCoherencia } from '../src/motor/turno/coherencia-banda'
import { nombrarClipGenerico } from '../src/motor/turno/humanizar-banda'

type N = { pitch: number; inicio: number; duracion: number; velocidad?: number }
const clip = (inicio: number, duracion: number, notas: N[]) => ({ id: `c${inicio}`, nombre: `clip ${inicio}`, inicio, duracion, notas })
const estado = (tracks: Array<{ nombre: string; clips: ReturnType<typeof clip>[] }>) =>
  ({ project: { timeSignature: { numerador: 4 }, tracks: tracks.map((t, i) => ({ id: `t${i}`, plugins: [], ...t })) } }) as never

describe('cobertura real por compás (plan S)', () => {
  // Intro 4 · Verso 1 (8) · Coro (8) · Verso 2 (8) · Outro 4 → 32 compases, 4/4 (128 beats)
  const hoja: HojaCoherencia = {
    tonalidad: 'Re mayor',
    numerador: 4,
    secciones: [
      { nombre: 'Intro', compases: 4, acordes: ['D'] },
      { nombre: 'Verso 1', compases: 8, acordes: ['D', 'G'] },
      { nombre: 'Coro', compases: 8, acordes: ['G', 'A'] },
      { nombre: 'Verso 2', compases: 8, acordes: ['D', 'G'] },
      { nombre: 'Outro', compases: 4, acordes: ['D'] },
    ],
  }
  /** Un clip de un compás con 3 notas en cada compás dado (1-based). */
  const compases = (nombre: string, cs: number[]) =>
    estado([{ nombre, clips: cs.map((c) => clip((c - 1) * 4, 4, [{ pitch: 60, inicio: 0, duracion: 1 }, { pitch: 64, inicio: 1, duracion: 1 }, { pitch: 67, inicio: 2, duracion: 1 }])) }])
  const rango = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

  it('nombrar la intro NO limita a la intro: el piano de la pasada real (solo 4 compases) queda incompleto', () => {
    const msg = seccionesFaltantes(compases('Piano', rango(1, 4)), hoja, { pista: 'Piano', encargo: 'Piano: empieza con una intro suave y acompaña con acordes' })!
    assert.match(msg, /Verso 1 \(compases 5–12, beat 16, 32 beats\)/)
    assert.match(msg, /Coro \(compases 13–20/)
    assert.match(msg, /Verso 2 \(compases 21–28/)
  })

  it('«solo/únicamente/exclusivamente/solamente» cerca de la mención sí limita; lejos, no', () => {
    const lead = (cs: number[]) => compases('Lead', cs)
    assert.equal(seccionesFaltantes(lead(rango(13, 20)), hoja, { pista: 'Lead', encargo: 'un lead solo en el coro' }), null)
    assert.equal(seccionesFaltantes(lead(rango(13, 20)), hoja, { pista: 'Lead', encargo: 'melodía únicamente en el coro' }), null)
    assert.equal(seccionesFaltantes(lead(rango(13, 20)), hoja, { pista: 'Lead', encargo: 'exclusivamente en el Coro' }), null)
    const m = seccionesFaltantes(lead([]), hoja, { pista: 'Lead', encargo: 'toca solamente el coro' })!
    assert.match(m, /Coro/)
    assert.doesNotMatch(m, /Verso/)
    const lejos = seccionesFaltantes(lead([]), hoja, { pista: 'Lead', encargo: 'solo con mucho aire y sin prisa, melodía de frases largas y respiradas que entra en el coro' })!
    assert.match(lejos, /Verso 1/)
  })

  it('batería: huecos DENTRO de secciones activas se listan por rangos con su beat y duración', () => {
    const cs = [...rango(5, 9), ...rango(13, 16), ...rango(21, 32)]
    const msg = seccionesFaltantes(compases('Batería', cs), hoja, { pista: 'Batería', encargo: 'batería' })!
    assert.match(msg, /Verso 1 \(compases 10–12, beat 36, 12 beats\)/)
    assert.match(msg, /Coro \(compases 17–20, beat 64, 16 beats\)/)
    assert.doesNotMatch(msg, /Verso 2|Outro/)
  })

  it('un compás de respiro al final de una sección se tolera; uno en medio, no', () => {
    const finalVacio = [...rango(5, 11), ...rango(13, 19), ...rango(21, 27), ...rango(29, 32)]
    assert.equal(seccionesFaltantes(compases('Guitarra', finalVacio), hoja, { pista: 'Guitarra', encargo: 'guitarra' }), null)
    const medio = finalVacio.filter((c) => c !== 8)
    assert.match(seccionesFaltantes(compases('Guitarra', medio), hoja, { pista: 'Guitarra', encargo: 'guitarra' })!, /Verso 1 \(compás 8,/)
  })

  it('una nota larga que atraviesa varios compases los cubre; la cola de un legato de ~medio beat no', () => {
    const pad = estado([{ nombre: 'Pad', clips: [clip(16, 32, [{ pitch: 60, inicio: 0, duracion: 32 }]), clip(48, 64, [{ pitch: 62, inicio: 0, duracion: 64 }])] }])
    assert.equal(seccionesFaltantes(pad, hoja, { pista: 'Pad', encargo: 'pad' }), null)
    const cola = estado([{ nombre: 'Piano', clips: [clip(16, 16, [{ pitch: 60, inicio: 0, duracion: 4.6 }])] }])
    assert.match(seccionesFaltantes(cola, hoja, { pista: 'Piano', encargo: '' })!, /compases 6–/)
  })

  it('analizarCoherencia nombra los compases vacíos de la base', () => {
    const golpes: N[] = [{ pitch: 36, inicio: 0, duracion: 0.25 }, { pitch: 38, inicio: 1, duracion: 0.25 }, { pitch: 36, inicio: 2, duracion: 0.25 }, { pitch: 38, inicio: 3, duracion: 0.25 }]
    const bateria = estado([{ nombre: 'Batería', clips: [...rango(5, 9), ...rango(13, 32)].map((c) => clip((c - 1) * 4, 4, golpes)) }])
    const r = analizarCoherencia(bateria, hoja)
    assert.ok(r.detalles.some((d) => /Batería.*sin notas en los compases 10–12 \(Verso 1\)/.test(d)), r.detalles.join(' | '))
  })
})

describe('copias exactas y nombres (plan S)', () => {
  const hoja: HojaCoherencia = { tonalidad: 'Re mayor', numerador: 4, secciones: [{ nombre: 'Verso', compases: 8, acordes: ['D', 'G'] }, { nombre: 'Coro', compases: 8, acordes: ['G', 'A'] }, { nombre: 'Outro', compases: 2, acordes: ['D'] }] }
  const arpegio = (c: number, v: number): N[] => [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((inicio, i) => ({ pitch: 62 + (i % 3) * 4, inicio: c * 4 + inicio, duracion: 0.5, velocidad: v }))

  it('copiasExactas cuenta los compases idénticos a otro', () => {
    const notas = Array.from({ length: 8 }, (_, c) => arpegio(c, 80)).flat()
    assert.deepEqual(copiasExactas(notas, 4), { copias: 8, compases: 8 })
    const variadas = notas.map((n, i) => (i % 8 === 3 && n.inicio >= 4 ? { ...n, inicio: n.inicio + Math.floor(n.inicio / 4) * 0.125 } : n))
    assert.ok(copiasExactas(variadas, 4).copias < 8)
  })

  it('diagnosticoEscritura avisa por encima del 40 % y no por debajo', () => {
    const iguales = Array.from({ length: 8 }, (_, c) => arpegio(c, 70 + c)).flat()
    const msg = diagnosticoEscritura(estado([{ nombre: 'Guitarra', clips: [clip(0, 32, iguales)] }]), hoja, { pista: 'Guitarra', encargo: 'guitarra' })!
    assert.match(msg, /8 de 8 compases son copia exacta/)
    assert.match(msg, /varía velocidades, adornos o reparto/)
    const distintos = Array.from({ length: 8 }, (_, c) => arpegio(c, 80).map((n) => ({ ...n, pitch: n.pitch + c }))).flat()
    const ok = diagnosticoEscritura(estado([{ nombre: 'Guitarra', clips: [clip(0, 32, distintos)] }]), hoja, { pista: 'Guitarra', encargo: 'guitarra' })!
    assert.doesNotMatch(ok, /copia exacta/)
  })

  it('«Clip MIDI» y los nombres vacíos pasan a «<Pista> - <Sección>»; un nombre propio se respeta', () => {
    const st = estado([{ nombre: 'Guitarra', clips: [] }]) as unknown as Parameters<typeof nombrarClipGenerico>[0]
    const l = (extra: Record<string, unknown>) => ({ nombre: 'midi.clip.create', argumentos: { pistaId: 't0', ...extra } })
    assert.equal(nombrarClipGenerico(st, hoja, l({ inicio: 32, nombre: 'Clip MIDI' })).nombre, 'Guitarra - Coro')
    assert.equal(nombrarClipGenerico(st, hoja, l({ inicio: 0 })).nombre, 'Guitarra - Verso')
    assert.equal(nombrarClipGenerico(st, hoja, l({ inicio: 64, nombre: 'clip 3' })).nombre, 'Guitarra - Outro')
    assert.equal(nombrarClipGenerico(st, hoja, l({ inicio: 0, nombre: 'Arpegio suave' })).nombre, 'Arpegio suave')
    assert.equal(nombrarClipGenerico(st, null, l({ inicio: 0 })).nombre, undefined)
  })
})
