/**
 * QA determinista de la banda: el diagnóstico de sonido entra en la revisión de cada etapa.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW, registrarSondaPlugins } from '../../../shared/src/index'
import { medirBanda, resumenPartes } from '../src/motor/turno/turno-banda'

async function conPiano() {
  const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
  await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' }, 'user')
  const id = tienda.obtenerEstado().project.tracks[0]!.id
  await tienda.executor.execute('midi.clip.create', { pistaId: id, nombre: 'A', inicio: 0, duracion: 4, notas: [{ pitch: 60, inicio: 0, duracion: 1, velocidad: 90 }] }, 'user')
  return { tienda, id }
}

describe('medirBanda + diagnóstico de sonido', () => {
  it('músicos: notas sin instrumento no aprueban y dicen cómo cargarlo', async () => {
    registrarSondaPlugins(() => ({ plugin: null }))
    try {
      const { tienda } = await conPiano()
      const m = await medirBanda(tienda, async () => null)('musicos')
      assert.equal(m?.ok, false)
      assert.ok(m?.detalles.some((d) => /ningún instrumento/.test(d) && /track\.addVstLayer/.test(d)), JSON.stringify(m))
    } finally {
      registrarSondaPlugins(null)
    }
  })

  it('mezcla: pista en mute no aprueba aunque el análisis no pueda medir', async () => {
    registrarSondaPlugins(() => ({ plugin: { id: 'p', nombre: 'Piano VST' } as never, listo: true }))
    try {
      const { tienda, id } = await conPiano()
      await tienda.executor.execute('track.update', { trackId: id, datos: { silenciada: true } }, 'user')
      const m = await medirBanda(tienda, async () => null)('mezcla')
      assert.equal(m?.ok, false)
      assert.ok(m?.detalles.some((d) => /silenciada/.test(d)))
      // Sin problemas y sin medición: no medible (null), no un fallo inventado.
      await tienda.executor.execute('track.update', { trackId: id, datos: { silenciada: false } }, 'user')
      assert.equal(await medirBanda(tienda, async () => null)('mezcla'), null)
    } finally {
      registrarSondaPlugins(null)
    }
  })

  it('máster a volumen 0: no aprueba (antes se daba por «no medible» y la canción salía muda)', async () => {
    const { tienda } = await conPiano()
    await tienda.executor.execute('master.update', { datos: { volumen: 0 } }, 'user')
    const m = await medirBanda(tienda, async () => null)('master')
    assert.equal(m?.ok, false)
    assert.match(m!.detalles[0]!, /volumen a 0/)
  })
})

describe('resumenPartes', () => {
  it('resume registro, ritmo del primer compás e intensidad de cada clip', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    await tienda.executor.execute('track.create', { nombre: 'Bajo', tipo: 'midi' }, 'user')
    await tienda.executor.execute('track.create', { nombre: 'Vacía', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    const notas = [0, 1.5, 2, 4].map((inicio) => ({ pitch: 38, inicio, duracion: 0.5, velocidad: 80 }))
    await tienda.executor.execute('midi.clip.create', { pistaId: id, nombre: 'Verso', inicio: 16, duracion: 8, notas }, 'user')
    const t = resumenPartes(tienda.obtenerEstado())
    assert.match(t, /«Bajo»/)
    assert.match(t, /Verso \(beats 16–24\): D2–D2, 2\.0 notas\/compás, velocidad media 80, ritmo del 1\.er compás en tiempos 1 2\.5 3/)
    assert.doesNotMatch(t, /Vacía/)
  })
})
