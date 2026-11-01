/**
 * Plan S: la humanización al escribir (micro-timing, dinámica, variación de copias) convive con la armonía, el
 * legato worship y la medición de coherencia.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { crearMemoriaHumanizado, guardarEscrituraHumanizar, modoHumanizarBanda, CLAVE_HUMANIZAR } from '../src/motor/turno/humanizar-banda'
import { guardarEscrituraLegato } from '../src/motor/turno/legato-banda'
import { guardiaArmonia } from '../src/motor/turno/armonia-banda'
import { analizarCoherencia, diagnosticoEscritura, type HojaCoherencia } from '../src/motor/turno/coherencia-banda'

const hoja: HojaCoherencia = {
  tonalidad: 'Do mayor',
  numerador: 4,
  secciones: [
    { nombre: 'Verso', compases: 8, acordes: ['C', 'G', 'Am', 'F'] },
    { nombre: 'Coro', compases: 8, acordes: ['F', 'C', 'G', 'Am'] },
  ],
}

type Nota = { pitch: number; inicio: number; duracion: number; velocidad?: number }
const arpegio = (compases: number, base = 0): Nota[] =>
  Array.from({ length: compases }, (_, c) => [60, 64, 67, 72, 67, 64, 67, 64].map((pitch, i) => ({ pitch, inicio: base + c * 4 + i * 0.5, duracion: 0.5, velocidad: 80 }))).flat()
const batería = (compases: number): Nota[] =>
  Array.from({ length: compases }, (_, c) => [
    ...[0, 2].map((p) => ({ pitch: 36, inicio: c * 4 + p, duracion: 0.25, velocidad: 100 })),
    ...[1, 3].map((p) => ({ pitch: 38, inicio: c * 4 + p, duracion: 0.25, velocidad: 100 })),
    ...Array.from({ length: 8 }, (_, i) => ({ pitch: 42, inicio: c * 4 + i * 0.5, duracion: 0.25, velocidad: 80 })),
  ]).flat()

const st = (nombre: string, bpm = 74) => ({ project: { bpm, timeSignature: { numerador: 4 }, tracks: [{ id: 'p1', nombre, plugins: [], clips: [{ id: 'k1', inicio: 0, duracion: 32 }] }] } })
const llamada = (notas: Nota[], nombre = 'midi.clip.create') => ({ nombre, argumentos: { pistaId: 'p1', clipId: 'k1', inicio: 0, duracion: 32, notas } })

describe('humanización al escribir', () => {
  afterEach(() => {
    try {
      globalThis.localStorage?.removeItem(CLAVE_HUMANIZAR)
    } catch {
      /* sin almacenamiento */
    }
  })

  it('mueve el tiempo y la dinámica, avisa y no cambia ninguna altura', () => {
    const r = guardarEscrituraHumanizar(st('Guitarra'), hoja, llamada(arpegio(8)), crearMemoriaHumanizado(), 'suave')
    const salida = r.args.notas as Nota[]
    assert.match(r.avisos[0]!, /humanización: \d+ notas con micro-timing/)
    assert.deepEqual(new Set(salida.map((n) => n.pitch)), new Set([60, 64, 67, 72]))
    assert.ok(salida.some((n) => n.inicio !== Math.round(n.inicio * 2) / 2))
    assert.ok(new Set(salida.map((n) => n.velocidad)).size > 6)
  })

  it('«nunca» no toca nada; herramientas ajenas o listas ilegibles tampoco', () => {
    const l = llamada(arpegio(4))
    assert.equal(guardarEscrituraHumanizar(st('Guitarra'), hoja, l, crearMemoriaHumanizado(), 'nunca').args, l.argumentos)
    assert.equal(guardarEscrituraHumanizar(st('Guitarra'), hoja, { ...l, nombre: 'midi.notes.patch' }, crearMemoriaHumanizado(), 'suave').args, l.argumentos)
    assert.equal(guardarEscrituraHumanizar(st('Guitarra'), hoja, { nombre: 'midi.clip.create', argumentos: { pistaId: 'p1', notas: 'nada' } }, crearMemoriaHumanizado(), 'suave').avisos.length, 0)
  })

  it('el ajuste del usuario se lee de localStorage (defecto «suave»)', () => {
    assert.equal(modoHumanizarBanda(), 'suave')
    ;(globalThis as { localStorage?: unknown }).localStorage ??= (() => {
      const m = new Map<string, string>()
      return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
    })()
    ;(globalThis as { localStorage: Storage }).localStorage.setItem(CLAVE_HUMANIZAR, '"nunca"')
    assert.equal(modoHumanizarBanda(), 'nunca')
    ;(globalThis as { localStorage: Storage }).localStorage.setItem(CLAVE_HUMANIZAR, 'siempre')
    assert.equal(modoHumanizarBanda(), 'siempre')
  })

  it('la memoria de la pista varía las copias aunque estén en clips distintos', () => {
    const memoria = crearMemoriaHumanizado()
    const a = guardarEscrituraHumanizar(st('Guitarra'), hoja, llamada(arpegio(4)), memoria, 'suave')
    assert.match(a.avisos[0]!, /compases variados/)
    const b = guardarEscrituraHumanizar(st('Guitarra'), hoja, { nombre: 'midi.clip.create', argumentos: { pistaId: 'p1', inicio: 32, duracion: 16, notas: arpegio(4) } }, memoria, 'suave')
    assert.match(b.avisos[0]!, /copia exacta/)
  })

  it('la batería recibe ghost notes y fills, y el diagnóstico ya no ve copias exactas', () => {
    const r = guardarEscrituraHumanizar(st('Batería'), hoja, llamada(batería(16)), crearMemoriaHumanizado(), 'suave')
    assert.match(r.avisos[0]!, /ghost notes/)
    assert.match(r.avisos[0]!, /fills/)
    const notas = r.args.notas as Nota[]
    const estado = { project: { bpm: 74, timeSignature: { numerador: 4 }, tracks: [{ id: 'p1', nombre: 'Batería', plugins: [], clips: [{ id: 'k1', nombre: 'Batería - Verso', inicio: 0, duracion: 64, notas }] }] } } as never
    const d = diagnosticoEscritura(estado, hoja, { pista: 'p1', encargo: 'batería' })!
    assert.doesNotMatch(d, /copia exacta/)
  })

  it('después de humanizar, la guardia de armonía no encuentra notas fuera de acorde', () => {
    const r = guardarEscrituraHumanizar(st('Guitarra'), hoja, llamada(arpegio(8)), crearMemoriaHumanizado(), 'siempre')
    const g = guardiaArmonia('midi.clip.create', r.args, { hoja, tipo: { bateria: false, bajo: false }, opciones: { modo: 'rechazar', maxAjuste: 0 } })
    // arpegio(8) es de Do mayor: el mismo veredicto que antes de humanizar (las mismas alturas en los mismos compases)
    const antes = guardiaArmonia('midi.clip.create', llamada(arpegio(8)).argumentos, { hoja, tipo: { bateria: false, bajo: false }, opciones: { modo: 'rechazar', maxAjuste: 0 } })
    assert.equal('error' in g, 'error' in antes)
  })

  it('convive con el legato: el tiempo se mueve antes, sin huecos entre notas (salvo el respiro de la misma altura) y sin avisos de coherencia', () => {
    const estado = st('Guitarra', 74)
    const memoria = crearMemoriaHumanizado()
    const l0 = llamada(arpegio(8))
    const h = guardarEscrituraHumanizar(estado, hoja, l0, memoria, 'suave')
    const l1 = { ...l0, argumentos: h.args }
    const lg = guardarEscrituraLegato(estado, 'canción de adoración', l1, 'worship')
    const notas = (lg.args.notas as Nota[]).slice().sort((a, b) => a.inicio - b.inicio)
    assert.match(lg.avisos[0] ?? '', /legato worship/)
    for (let i = 0; i < notas.length - 1; i++) {
      const fin = notas[i]!.inicio + notas[i]!.duracion
      assert.ok(fin >= notas[i + 1]!.inicio - 1 / 64 - 1e-3, `hueco tras la nota ${i}: ${JSON.stringify(notas.slice(i, i + 3))}`)
    }
    const proyecto = { project: { bpm: 74, timeSignature: { numerador: 4 }, tracks: [{ id: 'p1', nombre: 'Guitarra', plugins: [], clips: [{ id: 'k1', nombre: 'Guitarra - Verso', inicio: 0, duracion: 32, notas }] }] } } as never
    const m = analizarCoherencia(proyecto, hoja)
    assert.ok(!m.detalles.some((d) => /rejilla|robótica|después del final/.test(d)), m.detalles.join(' | '))
  })

  it('a cualquier tempo y en modo «siempre» la medición no marca «lejos de la rejilla» ni la batería ni la base', () => {
    for (const bpm of [60, 90, 140, 200]) {
      for (const nombre of ['Batería', 'Guitarra', 'Piano', 'Bajo']) {
        const notas = nombre === 'Batería' ? batería(16) : arpegio(16)
        const r = guardarEscrituraHumanizar(st(nombre, bpm), hoja, llamada(notas), crearMemoriaHumanizado(), 'siempre')
        const proyecto = { project: { bpm, timeSignature: { numerador: 4 }, tracks: [{ id: 'p1', nombre, plugins: [], clips: [{ id: 'k1', nombre: 'x', inicio: 0, duracion: 64, notas: r.args.notas }] }] } } as never
        const m = analizarCoherencia(proyecto, hoja)
        assert.ok(!m.detalles.some((d) => /rejilla/.test(d)), `${nombre} ${bpm} bpm: ${m.detalles.join(' | ')}`)
      }
    }
  })
})
