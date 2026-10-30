/**
 * npx tsx --test src/lib/bpm-guard.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  crearEstadoInicial,
  crearTiendaDAW,
  isValidBpm,
  parseBpmInput,
  safeProjectBpm,
} from '../../../shared/src'
import { executeDawActions } from './ai-daw-agent'

describe('BPM guard', () => {
  it('safeProjectBpm no propaga NaN', () => {
    const st = crearEstadoInicial()
    st.project.bpm.valor = Number.NaN
    assert.equal(safeProjectBpm(st), 120)
    assert.equal(isValidBpm(NaN), false)
    assert.equal(parseBpmInput({}), null)
    assert.equal(parseBpmInput(125), 125)
  })

  it('project.setBpm rechaza NaN / vacío', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    const before = tienda.obtenerEstado().project.bpm.valor
    const bad = await tienda.executor.execute('project.setBpm', { bpm: Number.NaN })
    assert.equal(bad.success, false)
    assert.equal(tienda.obtenerEstado().project.bpm.valor, before)

    const empty = await executeDawActions(
      tienda,
      [{ type: 'project.setBpm', payload: {} }],
      { forceApply: true, agentMode: 'create', respectModeGate: false },
    )
    assert.equal(empty[0]?.success, false)
    assert.match(String(empty[0]?.message), /BPM inválido/i)
    assert.equal(tienda.obtenerEstado().project.bpm.valor, before)
  })

  it('project.setBpm válido aplica', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    const ok = await tienda.executor.execute('project.setBpm', { bpm: 125 })
    assert.equal(ok.success, true)
    assert.equal(tienda.obtenerEstado().project.bpm.valor, 125)
  })
})
