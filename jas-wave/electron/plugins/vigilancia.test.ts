/**
 * npx tsx --test electron/plugins/vigilancia.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearVigilancia, type EstadisticaSlot } from './vigilancia'

function host(respuestas: EstadisticaSlot[][]) {
  const enviados: Record<string, unknown>[] = []
  let i = 0
  return {
    enviados,
    enviar: async (cmd: Record<string, unknown>) => {
      enviados.push(cmd)
      if (cmd.type === 'getSlotStats') return { ok: true, slots: respuestas[Math.min(i++, respuestas.length - 1)] }
      return { ok: true }
    },
  }
}

const slot = (slotId: string, path: string, avgLoad: number, exceptions = 0, overruns = 0): EstadisticaSlot => ({
  slot: slotId,
  path,
  avgLoad,
  overruns,
  exceptions,
})

describe('vigilancia de plugins vivos', () => {
  it('un plugin que satura 5 muestras se pone en bypass en todas sus instancias y en cuarentena', async () => {
    const h = host([[slot('t1:a', 'C:/x/Pesado.vst3', 0.97), slot('t2:b', 'C:/x/Pesado.vst3', 0.4), slot('t3:c', 'C:/x/Ligero.vst3', 0.1)]])
    const apartados: string[] = []
    const avisos: string[] = []
    const v = crearVigilancia({
      enviar: h.enviar,
      activo: () => true,
      apartar: (r) => apartados.push(r),
      notificar: (_d, m) => avisos.push(m),
      intervaloMs: 3_600_000,
      ahora: () => 0,
    })
    for (let k = 0; k < 4; k++) assert.deepEqual(await v.sondear(), [])
    const d = await v.sondear()
    v.detener()
    assert.equal(d.length, 1)
    assert.deepEqual(apartados, ['C:/x/Pesado.vst3'])
    const bypass = h.enviados.filter((c) => c.type === 'setBypass').map((c) => c.slotId).sort()
    assert.deepEqual(bypass, ['t1:a', 't2:b'])
    assert.match(avisos[0]!, /Pesado\.vst3.*satura/)
  })

  it('acumula excepciones aunque el host reinicie los contadores en cada lectura', async () => {
    const h = host([[slot('s', 'C:/x/Fragil.vst3', 0.1, 1)], [slot('s', 'C:/x/Fragil.vst3', 0.1, 1)], [slot('s', 'C:/x/Fragil.vst3', 0.1, 1)]])
    let t = 0
    const apartados: string[] = []
    const v = crearVigilancia({
      enviar: h.enviar,
      activo: () => true,
      apartar: (r) => apartados.push(r),
      notificar: () => undefined,
      intervaloMs: 3_600_000,
      ahora: () => (t += 1000),
    })
    await v.sondear()
    await v.sondear()
    const d = await v.sondear()
    v.detener()
    assert.equal(d[0]?.motivo, 'excepciones')
    assert.deepEqual(apartados, ['C:/x/Fragil.vst3'])
  })

  it('con el host parado o respuestas inválidas no hace nada', async () => {
    const h = host([[{ slot: 1, path: null } as unknown as EstadisticaSlot]])
    const v = crearVigilancia({ enviar: h.enviar, activo: () => false, apartar: () => assert.fail(), notificar: () => assert.fail(), intervaloMs: 3_600_000 })
    assert.deepEqual(await v.sondear(), [])
    assert.equal(h.enviados.length, 0)
    v.detener()
    const v2 = crearVigilancia({ enviar: h.enviar, activo: () => true, apartar: () => assert.fail(), notificar: () => assert.fail(), intervaloMs: 3_600_000 })
    for (let k = 0; k < 6; k++) assert.deepEqual(await v2.sondear(), [])
    v2.detener()
  })
})
