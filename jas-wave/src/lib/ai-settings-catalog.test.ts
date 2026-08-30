/**
 * Catálogo unificado + fallback entre modelos.
 * npx tsx --test src/lib/ai-settings-catalog.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildFallbackAttempts,
  createProviderProfile,
  aiChatWithFallback,
  listCatalogModels,
  selectCatalogModel,
  type AiSettings,
  type AiChatRequest,
} from './ai-settings'

function miniSettings(): AiSettings {
  const ollama = createProviderProfile('ollama', {
    id: 'p-ollama',
    models: ['llama3.2', 'mistral'],
    selectedModel: 'llama3.2',
    lastHealth: 'healthy',
  })
  const kilo = createProviderProfile('kilocode', {
    id: 'p-kilo',
    apiKey: 'test-key',
    models: ['anthropic/claude-sonnet-4.5'],
    selectedModel: 'anthropic/claude-sonnet-4.5',
    lastHealth: 'healthy',
  })
  return {
    version: 2,
    activeProviderId: kilo.id,
    providers: [kilo, ollama],
    temperature: 0.4,
    maxTokens: 1024,
    fallbackEnabled: true,
  }
}

describe('catalog + fallback', () => {
  it('lista modelos de todos los proveedores', () => {
    const cat = listCatalogModels(miniSettings())
    assert.ok(cat.some((c) => c.model === 'llama3.2'))
    assert.ok(cat.some((c) => c.model.includes('claude')))
  })

  it('selectCatalogModel cambia activo y modelo', () => {
    const next = selectCatalogModel(miniSettings(), 'p-ollama', 'mistral')
    assert.equal(next.activeProviderId, 'p-ollama')
    assert.equal(next.providers.find((p) => p.id === 'p-ollama')!.selectedModel, 'mistral')
  })

  it('buildFallbackAttempts pone el activo primero', () => {
    const chain = buildFallbackAttempts(miniSettings())
    assert.equal(chain[0]!.provider.id, 'p-kilo')
    assert.ok(chain.some((a) => a.provider.id === 'p-ollama'))
  })

  it('aiChatWithFallback reintenta con el mismo contexto', async () => {
    const settings = miniSettings()
    const seen: string[] = []
    const chat = async (req: AiChatRequest) => {
      seen.push(req.model)
      assert.equal(req.messages.length, 1)
      if (req.model.includes('claude')) {
        return { success: false, error: 'down', errorCode: 'service_unavailable' as const }
      }
      return { success: true, content: 'ok desde ollama' }
    }
    const r = await aiChatWithFallback(chat, [{ role: 'user', content: 'hola' }], {
      temperature: 0.4,
      maxTokens: 512,
      settings,
    })
    assert.equal(r.success, true)
    assert.equal(r.content, 'ok desde ollama')
    assert.equal(r.fallbackUsed, true)
    assert.ok(seen.length > 1)
  })

  it('402 payment_required también dispara fallback', async () => {
    const settings = miniSettings()
    const chat = async (req: AiChatRequest) => {
      if (req.model.includes('claude')) {
        return {
          success: false,
          error: 'Sin crédito / pago requerido (402). Add credits…',
          errorCode: 'payment_required' as const,
        }
      }
      return { success: true, content: 'ok free' }
    }
    const r = await aiChatWithFallback(chat, [{ role: 'user', content: 'hola' }], {
      temperature: 0.4,
      maxTokens: 512,
      settings,
    })
    assert.equal(r.success, true)
    assert.equal(r.content, 'ok free')
    assert.equal(r.fallbackUsed, true)
  })
})
