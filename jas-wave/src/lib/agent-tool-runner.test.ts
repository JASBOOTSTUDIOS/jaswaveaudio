/**
 * npx tsx --test src/lib/agent-tool-runner.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW, getStateRevision, toolRegistry } from '../../../shared/src'
import { registerAgentCatalogOnRegistry } from './agent-action-catalog'
import { runRegisteredTool, runRegisteredTools } from './agent-tool-runner'

describe('agent-tool-runner (ADR-0017)', () => {
  it('project.setBpm vía Registry/Command actualiza revision', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['project.setBpm'], tienda.registroComandos)

    const before = getStateRevision(tienda.obtenerEstado())
    const r = await runRegisteredTool(
      tienda,
      { id: 'c1', tool: 'project.setBpm', arguments: { bpm: 96 } },
      { forceApply: true, agentMode: 'create' },
    )
    assert.equal(r.status, 'success')
    assert.equal(tienda.obtenerEstado().project.bpm.valor, 96)
    assert.notEqual(getStateRevision(tienda.obtenerEstado()), before)
  })

  it('STATE_CONFLICT si expectedRevision no coincide', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['project.setBpm'], tienda.registroComandos)

    const r = await runRegisteredTool(
      tienda,
      { id: 'c2', tool: 'project.setBpm', arguments: { bpm: 100, __expectedRevision: 'deadbeef' } },
      { forceApply: true, agentMode: 'create' },
    )
    assert.equal(r.status, 'error')
    assert.equal(r.error?.code, 'STATE_CONFLICT')
  })

  it('idempotencia: callId ya ejecutado se omite', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    const done = new Set(['c3'])
    const r = await runRegisteredTools(
      tienda,
      [{ id: 'c3', tool: 'project.setBpm', arguments: { bpm: 140 } }],
      { forceApply: true, agentMode: 'create', executedCallIds: done },
    )
    assert.equal(r[0]?.status, 'success')
    assert.equal((r[0]?.data as { skipped?: boolean })?.skipped, true)
    assert.notEqual(tienda.obtenerEstado().project.bpm.valor, 140)
  })
})
