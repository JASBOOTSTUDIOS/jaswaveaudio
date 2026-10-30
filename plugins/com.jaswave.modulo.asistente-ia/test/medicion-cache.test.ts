/**
 * Mediciones nativas de la banda: caché por huella del proyecto (revisión + notas + mezcla), tiempo máximo y
 * respaldo con la última medición válida. Sin render real: la «medición nativa» es un contador.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW } from '../../../shared/src/index'
import { huellaMezcla, medirBanda } from '../src/motor/turno/turno-banda'

const MEZCLA = { pistas: [{ trackId: 'x', integrated: -18 }], master: { integrated: -14.2, truePeakDb: -2 } }

async function proyecto() {
  const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
  await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' }, 'user')
  const id = tienda.obtenerEstado().project.tracks[0]!.id
  await tienda.executor.execute('midi.clip.create', { pistaId: id, nombre: 'A', inicio: 0, duracion: 4, notas: [{ pitch: 60, inicio: 0, duracion: 1, velocidad: 90 }] }, 'user')
  return { tienda, id }
}

describe('caché de mediciones nativas por huella', () => {
  it('no vuelve a renderizar si el proyecto no cambió (mezcla y máster comparten la medición)', async () => {
    const { tienda } = await proyecto()
    let renders = 0
    const medir = medirBanda(tienda, async () => (renders++, { ...MEZCLA, pistas: [{ trackId: tienda.obtenerEstado().project.tracks[0]!.id, integrated: -18 }] }))
    const a = await medir('mezcla')
    const b = await medir('mezcla')
    const c = await medir('master')
    assert.equal(renders, 1)
    assert.deepEqual(a, b)
    assert.ok(c && c.detalles.length > 0)
  })

  it('vuelve a medir si cambia el volumen de una pista (la revisión del proyecto no lo ve, la huella sí)', async () => {
    const { tienda, id } = await proyecto()
    const antes = huellaMezcla(tienda.obtenerEstado())
    let renders = 0
    const medir = medirBanda(tienda, async () => (renders++, { ...MEZCLA, pistas: [{ trackId: id, integrated: -18 }] }))
    await medir('mezcla')
    await tienda.executor.execute('track.update', { trackId: id, datos: { volumen: 0.5 } }, 'user')
    assert.notEqual(huellaMezcla(tienda.obtenerEstado()), antes)
    await medir('mezcla')
    assert.equal(renders, 2)
  })

  it('vuelve a medir si cambia una nota sin cambiar cuántas hay', async () => {
    const { tienda, id } = await proyecto()
    let renders = 0
    const medir = medirBanda(tienda, async () => (renders++, { ...MEZCLA, pistas: [{ trackId: id, integrated: -18 }] }))
    await medir('mezcla')
    const clip = tienda.obtenerEstado().project.tracks[0]!.clips[0]!
    const huella = huellaMezcla(tienda.obtenerEstado())
    const r = await tienda.executor.execute('midi.notes.set', { pistaId: id, clipId: clip.id, notas: [{ pitch: 64, inicio: 0, duracion: 1, velocidad: 90 }] }, 'user')
    assert.ok(r.success, JSON.stringify(r.error))
    assert.notEqual(huellaMezcla(tienda.obtenerEstado()), huella)
    await medir('mezcla')
    assert.equal(renders, 2)
  })

  it('una medición fallida no se guarda: se reintenta', async () => {
    const { tienda, id } = await proyecto()
    let renders = 0
    const medir = medirBanda(tienda, async () => (++renders === 1 ? null : { ...MEZCLA, pistas: [{ trackId: id, integrated: -18 }] }))
    assert.equal(await medir('mezcla'), null)
    assert.ok(await medir('mezcla'))
    assert.equal(renders, 2)
  })

  it('tiempo máximo con respaldo: si el render se cuelga usa la última medición válida', async () => {
    const { tienda, id } = await proyecto()
    let renders = 0
    const medir = medirBanda(
      tienda,
      async () => (++renders === 1 ? { ...MEZCLA, pistas: [{ trackId: id, integrated: -18 }] } : new Promise<never>(() => undefined)),
      { maxMs: 30 },
    )
    const primera = await medir('mezcla')
    assert.ok(primera)
    await tienda.executor.execute('track.update', { trackId: id, datos: { volumen: 0.7 } }, 'user')
    const t0 = Date.now()
    const segunda = await medir('mezcla')
    assert.ok(Date.now() - t0 < 2000, 'no espera indefinidamente')
    assert.deepEqual(segunda, primera, 'usa la última medición válida')
  })

  it('tiempo máximo sin respaldo: no medible (null), no un fallo inventado', async () => {
    const { tienda } = await proyecto()
    const medir = medirBanda(tienda, () => new Promise<never>(() => undefined), { maxMs: 20 })
    assert.equal(await medir('master'), null)
  })
})
