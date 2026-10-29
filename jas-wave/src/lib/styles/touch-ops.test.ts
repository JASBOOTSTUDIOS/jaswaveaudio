/**
 * npx tsx --test src/lib/styles/touch-ops.test.ts
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { crearEstadoInicial, crearRng, crearTiendaDAW } from '../../../../shared/src'
import { reiniciarBibliotecaToques, touchAnalyze, touchApply, touchLearn, touchList } from './touch-ops'

type N = { pitch: number; inicio: number; duracion: number; velocidad: number }

/** Acordes en cada tiempo, tocados tarde y arpegiados grave→agudo. */
function interpretacion(compases = 8): N[] {
  const rng = crearRng(3)
  const ms = 60000 / 120
  const notas: N[] = []
  for (let b = 0; b < compases * 4; b++) {
    const desv = (8 + 2 * rng.gauss()) / ms
    ;[48, 52, 55, 60].forEach((p, j) =>
      notas.push({ pitch: p, inicio: b + desv + (j * 15) / ms, duracion: 0.8, velocidad: b % 4 === 0 ? 100 : 75 }),
    )
  }
  return notas
}

async function tiendaConClips() {
  const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
  await tienda.executor.execute('project.setBpm', { bpm: 120 })
  const r = await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi', id: 'piano' })
  assert.equal(r.success, true, r.error?.message)
  const a = await tienda.executor.execute('midi.clip.create', { pistaId: 'piano', id: 'toca', inicio: 0, duracion: 32, notas: interpretacion() })
  assert.equal(a.success, true, a.error?.message)
  const cuant: N[] = []
  for (let b = 0; b < 16; b++) for (const p of [50, 53, 57]) cuant.push({ pitch: p, inicio: b, duracion: 1, velocidad: 90 })
  const c = await tienda.executor.execute('midi.clip.create', { pistaId: 'piano', id: 'nueva', inicio: 32, duracion: 16, notas: cuant })
  assert.equal(c.success, true, c.error?.message)
  return tienda
}

describe('touch-ops', () => {
  beforeEach(() => reiniciarBibliotecaToques())

  it('analysis.touch: informe del toque de un clip', async () => {
    const tienda = await tiendaConClips()
    const a = touchAnalyze(tienda, { trackId: 'piano', clipIds: ['toca'] })
    assert.equal(a.ok, true, a.message)
    assert.ok(a.perfil!.timing.global.media > 5 && a.perfil!.timing.global.media < 11)
    assert.ok(a.perfil!.acordes.probArpegiado > 0.9)
    assert.equal(a.perfil!.acordes.ordenAscendente, 1)
    assert.match(a.message, /Micro-timing/)
  })

  it('learn → list → apply con un solo undo', async () => {
    const tienda = await tiendaConClips()
    const l = await touchLearn(tienda, { trackId: 'piano', clipIds: ['toca'], nombre: 'Mi piano', instrumento: 'piano' })
    assert.equal(l.ok, true, l.message)
    assert.ok(l.perfilId)
    const lista = await touchList()
    assert.equal(lista.length, 1)
    // Mismo nombre → actualiza, no duplica.
    const l2 = await touchLearn(tienda, { trackId: 'piano', clipIds: ['toca'], nombre: 'mi piano' })
    assert.equal(l2.perfilId, l.perfilId)
    assert.equal((await touchList()).length, 1)

    const antes = tienda.obtenerEstado().project.tracks.find((t) => t.id === 'piano')!.clips.find((c) => c.id === 'nueva') as unknown as { notas: N[] }
    const depth = tienda.executor.getUndoDepth()
    const ap = await touchApply(tienda, { nombre: 'Mi piano', trackId: 'piano', clipId: 'nueva', semilla: 4 })
    assert.equal(ap.ok, true, ap.message)
    assert.equal(tienda.executor.getUndoDepth(), depth + 1)
    const despues = tienda.obtenerEstado().project.tracks.find((t) => t.id === 'piano')!.clips.find((c) => c.id === 'nueva') as unknown as { notas: N[] }
    assert.equal(despues.notas.length, antes.notas.length)
    const r = touchAnalyze(tienda, { trackId: 'piano', clipIds: ['nueva'] })
    assert.ok(r.perfil!.timing.global.media > 4, `timing ${r.perfil!.timing.global.media}`)
    assert.ok(r.perfil!.acordes.probArpegiado > 0.7)
    await tienda.executor.undo()
    const deshecho = tienda.obtenerEstado().project.tracks.find((t) => t.id === 'piano')!.clips.find((c) => c.id === 'nueva') as unknown as { notas: N[] }
    assert.deepEqual(
      deshecho.notas.map((n) => n.inicio),
      antes.notas.map((n) => n.inicio),
    )
  })

  it('errores claros: perfil inexistente, pista sin clips, nombre vacío', async () => {
    const tienda = await tiendaConClips()
    assert.equal((await touchApply(tienda, { nombre: 'nada', trackId: 'piano' })).ok, false)
    assert.equal((await touchLearn(tienda, { trackId: 'piano', nombre: '' })).ok, false)
    assert.equal(touchAnalyze(tienda, { trackId: 'otra' }).ok, false)
  })
})
