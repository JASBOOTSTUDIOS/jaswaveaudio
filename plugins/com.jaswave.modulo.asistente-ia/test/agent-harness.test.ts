/**
 * Revisión del harness del asistente (contrato con el DAW real).
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildHarnessReviewMessage, harnessReviewNeeded } from '../src/motor/agent-harness'

describe('agent-harness', () => {
  it('pide revisión tras mutar el DAW, no tras solo leer docs', () => {
    assert.equal(harnessReviewNeeded([{ type: 'track.create', success: true, message: 'ok' }]), true)
    assert.equal(harnessReviewNeeded([{ type: 'doc.read', success: true, message: 'ok' }]), false)
  })

  it('el mensaje de revisión pide las tres capas', () => {
    const msg = buildHarnessReviewMessage({
      userText: 'crea un bajo',
      evalSummary: 'Falta el pad',
      actionsSummary: '✓ pista',
      projectId: 'test-harness',
      evaluation: {
        planned: 2,
        done: 1,
        missing: ['Pad aéreo'],
        extraTracks: [],
        summary: 'Falta el pad',
        markdown: '',
        checks: [],
      },
    })
    assert.match(msg, /Intención/)
    assert.match(msg, /Por implementar/)
    assert.match(msg, /Implementado/)
    assert.match(msg, /crea un bajo/)
    assert.match(msg, /Notas del usuario/)
  })
})
