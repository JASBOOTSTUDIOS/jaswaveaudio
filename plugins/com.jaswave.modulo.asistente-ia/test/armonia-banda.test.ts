/**
 * Armonía al escribir: el guardia ajusta o rechaza las notas fuera de la hoja de ruta (Re mayor) y la medición
 * de coherencia queda en verde sin ronda del arreglista.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { guardiaArmonia, notasFueraDeArmonia, tablaArmoniaMusico, tipoDePista } from '../src/motor/turno/armonia-banda'
import { analizarCoherencia, diagnosticoEscritura, type HojaCoherencia } from '../src/motor/turno/coherencia-banda'

// Intro (D · A · Bm · G) · Verso (D · A/C# · Bm · G/B · Dsus4 · Asus2 · Bm · G) · Coro (G · D · A · Bm)
const HOJA: HojaCoherencia = {
  tonalidad: 'Re mayor',
  numerador: 4,
  secciones: [
    { nombre: 'Intro', compases: 4, acordes: ['D', 'A', 'Bm', 'G'] },
    { nombre: 'Verso', compases: 8, acordes: ['D', 'A/C#', 'Bm', 'G/B', 'Dsus4', 'Asus2', 'Bm', 'G'] },
    { nombre: 'Coro', compases: 4, acordes: ['G', 'D', 'A', 'Bm'] },
  ],
}
const piano = tipoDePista('Piano')
const bajo = tipoDePista('Bajista')
const bateria = tipoDePista('Batería')
const n = (pitch: number, inicio: number, duracion: number) => ({ pitch, inicio, duracion })

describe('guardia de armonía al escribir', () => {
  it('notas del acorde en el primer tiempo, escala en el resto y cromática de paso: todo permitido', () => {
    const notas = [
      n(62, 0, 2), // D en D
      n(66, 2, 0.5), // fa# (escala)
      n(70, 2.5, 0.25), // la# cromática de paso corta en tiempo débil
      n(69, 4, 2), // la en A
      n(73, 6, 0.5), // do# (escala)
      n(66, 8, 1), // fa# en Bm
    ]
    const { fuera } = notasFueraDeArmonia(HOJA, notas, 0, piano)
    assert.deepEqual(fuera, [])
  })

  it('acordes con barra, sus2 y sus4: se aceptan sus notas y se señalan las ajenas', () => {
    // compás 6 (beat 20): A/C# → do# grave permitido; compás 8 (beat 28): G/B → si; compás 9: Dsus4 → sol permitido, fa# NO en el primer tiempo
    assert.deepEqual(notasFueraDeArmonia(HOJA, [n(61, 20 - 16, 2), n(71, 28 - 16, 2), n(67, 32 - 16, 2)], 16, piano).fuera, [])
    const f = notasFueraDeArmonia(HOJA, [n(66, 32 - 16, 2)], 16, piano).fuera // fa# largo en Dsus4 (no es del acorde: tiene sol, no fa#)
    assert.equal(f.length, 1)
    assert.equal(f[0]!.simbolo, 'Dsus4')
    assert.equal(f[0]!.compas, 9)
    const sus2 = notasFueraDeArmonia(HOJA, [n(71, 36 - 16, 2)], 16, piano).fuera // si largo en Asus2 (la, si, mi)
    assert.deepEqual(sus2, [])
  })

  it('la batería y la percusión no se tocan', () => {
    assert.deepEqual(notasFueraDeArmonia(HOJA, [n(36, 0, 0.25), n(38, 1, 0.25)], 0, bateria).fuera, [])
  })

  it('el bajo: la fundamental (o la nota tras «/») en el primer tiempo', () => {
    const mal = notasFueraDeArmonia(HOJA, [n(43, 0, 2)], 0, bajo).fuera // sol en D
    assert.equal(mal.length, 1)
    assert.equal(mal[0]!.destino % 12, 2)
    assert.deepEqual(notasFueraDeArmonia(HOJA, [n(37, 20 - 16, 2)], 16, bajo).fuera, []) // do# en A/C#
  })

  it('modo auto: pocas fuera se ajustan y se informa; muchas se rechazan con mensaje exacto', () => {
    const buenas = Array.from({ length: 20 }, (_, i) => n(62 + (i % 2) * 4, 8 + i * 0.1 > 0 ? 0 : 0, 0.25))
    void buenas
    // 20 notas largas del acorde (Bm: si, re, fa#) en el compás 3 y una do natural
    const ok = [59, 62, 66, 59, 62, 66, 59, 62, 66, 59, 62, 66, 59, 62, 66, 59, 62, 66, 59].map((p, i) => n(p, 8 + (i % 4) * 0.0, 4))
    const una = [...ok, n(60, 8, 4)]
    const r = guardiaArmonia('midi.clip.create', { inicio: 0, notas: una }, { hoja: HOJA, tipo: piano })
    assert.ok(!('error' in r))
    if ('error' in r) return
    assert.equal(r.avisos.length, 1)
    assert.match(r.avisos[0]!, /Ajusté 1 de 20 notas/)
    assert.match(r.avisos[0]!, /compás 3 \(Bm\)/)
    assert.equal(((r.args.notas as Array<{ pitch: number }>)[19]!.pitch + 1200) % 12 === 11 || ((r.args.notas as Array<{ pitch: number }>)[19]!.pitch + 1200) % 12 === 2, true)
    const muchas = Array.from({ length: 10 }, (_, i) => n(60, 8, 4 - i * 0.01))
    const e = guardiaArmonia('midi.clip.create', { inicio: 0, notas: muchas }, { hoja: HOJA, tipo: piano })
    assert.ok('error' in e)
    if ('error' in e) {
      assert.match(e.error, /compás 3 \(Bm\): do en beat 8 no pertenece; permitidas: /)
      assert.match(e.error, /no se ha escrito nada/)
    }
  })

  it('modos configurables: ajustar siempre / rechazar siempre', () => {
    const notas = [n(60, 8, 4), n(60, 9, 4)]
    const a = guardiaArmonia('midi.clip.create', { inicio: 0, notas }, { hoja: HOJA, tipo: piano, opciones: { modo: 'ajustar', maxAjuste: 0.15 } })
    assert.ok(!('error' in a) && a.avisos.length === 1)
    const r = guardiaArmonia('midi.clip.create', { inicio: 0, notas: [n(60, 8, 4), ...Array.from({ length: 30 }, () => n(59, 8, 4))] }, { hoja: HOJA, tipo: piano, opciones: { modo: 'rechazar', maxAjuste: 0.15 } })
    assert.ok('error' in r)
  })

  it('formas de notas del modelo: nombres de nota, claves en inglés, y herramientas ajenas no se tocan', () => {
    const r = guardiaArmonia('midi.clip.create', { inicio: 0, notas: [{ note: 'C4', start: 8, duration: 4 }, ...Array.from({ length: 20 }, () => ({ note: 'B3', start: 8, duration: 4 }))] }, { hoja: HOJA, tipo: piano })
    assert.ok(!('error' in r) && r.avisos.length === 1)
    assert.deepEqual(guardiaArmonia('track.update', { notas: [n(60, 8, 4)] }, { hoja: HOJA, tipo: piano }), { args: { notas: [n(60, 8, 4)] }, avisos: [] })
  })
})

describe('tabla de armonía del encargo', () => {
  it('lista cada acorde distinto con sus notas permitidas y la regla de no salir', () => {
    const t = tablaArmoniaMusico(HOJA, { encargo: 'Toca el piano en toda la canción', tipo: piano })!
    assert.match(t, /NO SALGAS/)
    assert.match(t, /- Bm: si, re, fa♯/)
    assert.match(t, /- A\/C#: .*do♯/)
    assert.match(t, /- Dsus4: re, sol, la/)
    assert.equal(tablaArmoniaMusico(HOJA, { encargo: 'x', tipo: bateria }), null)
    const soloCoro = tablaArmoniaMusico(HOJA, { encargo: 'Solo en el coro', tipo: piano })!
    assert.doesNotMatch(soloCoro, /Dsus4/)
    assert.match(tablaArmoniaMusico(HOJA, { encargo: 'bajo', tipo: bajo })!, /primer tiempo: do♯/)
  })
})

describe('medición en verde sin arreglista', () => {
  const estado = (notas: Array<ReturnType<typeof n>>, nombre = 'Piano') =>
    ({ project: { timeSignature: { numerador: 4 }, tracks: [{ id: 't1', nombre, plugins: [], clips: [{ id: 'c1', nombre: 'todo', inicio: 0, duracion: 64, notas }] }] } }) as never

  it('una parte con notas fuera, tras el ajuste del guardia, pasa analizarCoherencia', () => {
    // Acordes largos de 4 beats por compás con una nota ajena cada tres compases.
    const cuerpo: Array<ReturnType<typeof n>> = []
    const raiz = [62, 69, 59, 55, 62, 61, 59, 59, 55, 62, 69, 59] // D A Bm G D C# Bm B G D A Bm (bajos)
    void raiz
    const acordes = HOJA.secciones.flatMap((s) => s.acordes)
    const pitches: Record<string, number[]> = { D: [62, 66, 69], A: [69, 73, 64], Bm: [59, 62, 66], G: [67, 71, 62], 'A/C#': [61, 64, 69], 'G/B': [59, 62, 67], Dsus4: [62, 67, 69], Asus2: [69, 71, 64] }
    acordes.forEach((a, c) => pitches[a]!.forEach((p, i) => cuerpo.push(n(p, c * 4 + i * 0.0, 4 - i * 0.25))))
    // Notas ajenas: do natural largo en tres compases.
    const sucio = cuerpo.map((x, i) => (i % 12 === 1 ? { ...x, pitch: 60 } : x))
    assert.equal(analizarCoherencia(estado(sucio), HOJA).ok, false, 'sin guardia, la medición lo señala')
    const g = guardiaArmonia('midi.clip.create', { inicio: 0, notas: sucio }, { hoja: HOJA, tipo: piano, opciones: { modo: 'ajustar', maxAjuste: 0.15 } })
    assert.ok(!('error' in g))
    if ('error' in g) return
    const arreglado = estado(g.args.notas as Array<ReturnType<typeof n>>)
    const m = analizarCoherencia(arreglado, HOJA)
    assert.equal(m.ok, true, m.detalles.join(' | '))
  })

  it('el diagnóstico de escritura es corto cuando no hay defectos y concreto cuando faltan secciones', () => {
    const st = estado([n(62, 0, 4), n(66, 4, 2), n(69, 8, 1)])
    const d = diagnosticoEscritura(st, HOJA, { pista: 'Piano', encargo: 'piano' })!
    assert.match(d, /Diagnóstico/)
    assert.ok(d.length < 700)
  })
})
