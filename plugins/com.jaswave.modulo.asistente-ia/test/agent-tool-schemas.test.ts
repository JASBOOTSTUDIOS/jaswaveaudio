/**
 * npx tsx --test src/lib/agent-tool-schemas.test.ts
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearEstadoInicial } from '../../../shared/src/index'
import { allAgentToolSchemas, listAgentToolSchemas } from '../src/motor/agent-tool-schemas'
import { computeFallbackActions, FALLBACK_TOOLS, isFallbackTool } from '../src/motor/agent-fallback-tools'
import { agentActionClassOfType } from '@jaswave/ai-harness'

describe('agent-tool-schemas', () => {
  it('todas las herramientas tienen clase y schema objeto; ask solo ve lecturas', () => {
    const all = allAgentToolSchemas()
    assert.ok(all.length > 30)
    for (const t of all) {
      assert.ok(agentActionClassOfType(t.name), `${t.name} sin clase`)
      assert.equal(t.parameters.type, 'object')
    }
    const ask = listAgentToolSchemas({ mode: 'ask', role: 'coproductor' })
    assert.ok(ask.length > 0)
    for (const t of ask) assert.equal(agentActionClassOfType(t.name), 'read', t.name)
    const create = listAgentToolSchemas({ mode: 'create', role: 'coproductor' })
    assert.ok(create.some((t) => t.name === 'project.setBpm'))
    assert.ok(create.some((t) => t.name === FALLBACK_TOOLS.userIntent))
    const qa = listAgentToolSchemas({ mode: 'create', role: 'qa' })
    assert.ok(qa.every((t) => agentActionClassOfType(t.name) === 'read'))
  })

  it('los esquemas salen del registro con comandos (el de la tienda) y traen tipos y nombres reales', async () => {
    // En la app el registro global está vacío: sin el de la tienda, el modelo veía `properties: {}`.
    const { registroComandos } = await import('@jaswave/host-sdk')
    const conComandos = registroComandos.list().length ? registroComandos : (await import('@jaswave/host-sdk')).getSharedStore().registroComandos
    assert.ok(conComandos.list().length > 30)
    const props = (n: string) => (allAgentToolSchemas().find((t) => t.name === n)?.parameters.properties ?? {}) as Record<string, { type?: string }>
    assert.equal(props('project.setBpm').bpm?.type, 'number')
    assert.equal(props('midi.clip.create').notas?.type, 'array')
    assert.equal(props('project.setTimeSignature').numerador?.type, 'number')
    const vacio = { list: () => [] }
    assert.notDeepEqual(allAgentToolSchemas(vacio), allAgentToolSchemas(), 'la caché no mezcla registros')
  })

  it('fallback.* calculan propuestas sin mutar el estado', () => {
    const state = crearEstadoInicial()
    const before = JSON.stringify(state)
    assert.equal(isFallbackTool('fallback.midiAuditFix'), true)
    assert.equal(isFallbackTool('track.create'), false)
    const tempo = computeFallbackActions(FALLBACK_TOOLS.userIntent, state, { text: 'baja el tempo a 80 bpm', mode: 'create' })
    assert.ok(tempo.some((a) => a.type === 'project.setBpm'))
    assert.deepEqual(computeFallbackActions(FALLBACK_TOOLS.midiAuditFix, state), [])
    assert.deepEqual(computeFallbackActions('fallback.desconocida', state), [])
    assert.equal(JSON.stringify(state), before)
  })
})
