/**
 * Tests Fase 0: certify storage shape, undo depth revert, pending subset meta.
 * npx tsx --test src/lib/agent-turn-undo.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canRevertTurn, toStoredCertify } from './agent-turn-undo'
import { formatSemanticDiffSummary, emptySemanticDiff } from '../../../shared/src/state/diff-estado'

describe('agent-turn-undo', () => {
  it('canRevertTurn requiere profundidad mayor y no reverted', () => {
    assert.equal(canRevertTurn({ undoDepthAtStart: 2, currentDepth: 5 }), true)
    assert.equal(canRevertTurn({ undoDepthAtStart: 5, currentDepth: 5 }), false)
    assert.equal(canRevertTurn({ undoDepthAtStart: 2, currentDepth: 5, reverted: true }), false)
    assert.equal(canRevertTurn({ currentDepth: 5 }), false)
  })

  it('toStoredCertify compacta planEval', () => {
    const c = toStoredCertify({
      healthOk: false,
      shouldRepair: true,
      issues: ['a', 'b'],
      planEval: { done: 1, planned: 3 },
    })
    assert.equal(c.healthOk, false)
    assert.equal(c.shouldRepair, true)
    assert.equal(c.planDone, 1)
    assert.equal(c.planPlanned, 3)
    assert.deepEqual(c.issues, ['a', 'b'])
  })
})

describe('semantic diff summary for decision card', () => {
  it('formatSemanticDiffSummary refleja pistas añadidas', () => {
    const d = emptySemanticDiff()
    d.tracksAdded.push('Bajo')
    d.clipsAdded = 2
    const s = formatSemanticDiffSummary(d)
    assert.match(s, /pista/)
    assert.match(s, /clip/)
  })
})
