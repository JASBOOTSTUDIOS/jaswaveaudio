/**
 * npx tsx --test src/lib/agent-loop-bridge.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pendingCallsToDawActions, applyPendingAgentRun, clearActiveAgentRun, getActiveAgentRun } from './agent-loop-bridge'
import { saveAgentRunFromResult } from './agent-run-store'
import { crearEstadoInicial, crearTiendaDAW, getStateRevision, toolRegistry } from '../../../shared/src'
import { registerAgentCatalogOnRegistry } from './agent-action-catalog'
import type { AgentRunResult } from '@jaswave/ai-harness'

describe('agent-loop-bridge', () => {
  it('pendingCalls → DawAction para Aplicar', () => {
    const r = {
      status: 'waiting-for-confirmation',
      summary: 'ok',
      iterations: 1,
      results: [],
      decisions: [],
      pendingCalls: [{ id: 'c1', tool: 'project.setBpm', arguments: { bpm: 120 } }],
    } as AgentRunResult
    const a = pendingCallsToDawActions(r)
    assert.equal(a[0]?.type, 'project.setBpm')
    assert.equal(a[0]?.payload?.bpm, 120)
  })

  it('Aplicar pending + conflict si revision cambió', async () => {
    clearActiveAgentRun()
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['project.setBpm'], tienda.registroComandos)

    const rev = getStateRevision(tienda.obtenerEstado())
    saveAgentRunFromResult(
      {
        status: 'waiting-for-confirmation',
        summary: 'ok',
        iterations: 1,
        results: [],
        decisions: [],
        pendingCalls: [{ id: 'c1', tool: 'project.setBpm', arguments: { bpm: 90 } }],
        lastObservation: { fingerprint: rev, text: '', relevantTrackIds: [] },
      } as unknown as AgentRunResult,
      { userText: '90 bpm', conversationId: 'c', messageId: 'm' },
    )

    await tienda.executor.execute('project.setBpm', { bpm: 110 })
    const out = await applyPendingAgentRun({
      tienda,
      agentMode: 'create',
      chat: async () => '<<<DECISION\n{"type":"complete","summary":"listo"}\nDECISION>>>',
    })
    assert.ok(out.conflict?.includes('STATE_CONFLICT'))
    assert.equal(out.runInvalidated, true)
    assert.equal(getActiveAgentRun(), null)
    clearActiveAgentRun()
  })

  it('Aplicar pending ejecuta tool y reanuda', async () => {
    clearActiveAgentRun()
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['project.setBpm'], tienda.registroComandos)

    const rev = getStateRevision(tienda.obtenerEstado())
    saveAgentRunFromResult(
      {
        status: 'waiting-for-confirmation',
        summary: 'ok',
        iterations: 1,
        results: [],
        decisions: [],
        pendingCalls: [{ id: 'c1', tool: 'project.setBpm', arguments: { bpm: 72 } }],
        lastObservation: { fingerprint: rev, text: '', relevantTrackIds: [] },
      } as unknown as AgentRunResult,
      { userText: 'más lento', conversationId: 'c', messageId: 'm' },
    )

    const out = await applyPendingAgentRun({
      tienda,
      agentMode: 'create',
      chat: async () =>
        '<<<DECISION\n{"type":"complete","summary":"tempo listo"}\nDECISION>>>',
    })
    assert.equal(out.conflict, undefined)
    assert.equal(out.applyResults[0]?.status, 'success')
    assert.equal(tienda.obtenerEstado().project.bpm.valor, 72)
    assert.equal(out.loop?.status, 'completed')
    clearActiveAgentRun()
  })
})
