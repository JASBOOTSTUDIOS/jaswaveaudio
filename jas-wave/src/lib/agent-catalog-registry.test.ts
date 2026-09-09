/**
 * npx tsx --test src/lib/agent-catalog-registry.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearToolRegistry } from '../../../shared/src/ai/tool-registry'
import { KNOWN_AGENT_ACTION_TYPES, registerAgentCatalogOnRegistry } from './agent-action-catalog'

describe('agent catalog → Tool Registry', () => {
  it('todas las KNOWN_AGENT_ACTION_TYPES aparecen en generatePromptFragment', () => {
    const registry = crearToolRegistry()
    registerAgentCatalogOnRegistry(registry)
    const fragment = registry.generatePromptFragment()
    const missing = KNOWN_AGENT_ACTION_TYPES.filter((t) => !fragment.includes(t))
    assert.deepEqual(missing, [])
  })
})
