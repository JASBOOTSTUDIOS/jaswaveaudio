/**
 * npx tsx --test src/lib/audio-fx-blame.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { confidenceFromImprovement, scoreAudioBadness } from './audio-fx-blame'

describe('audio-fx-blame scoring', () => {
  it('healthy quiet mix scores low', () => {
    const s = scoreAudioBadness({
      status: 'healthy',
      underrunDelta: 0,
      overflowDelta: 0,
      highFillDropDelta: 0,
      fillRatioVsHigh: 0.4,
      masterPeak: 0.3,
      maxStemPeak: 0.2,
    })
    assert.ok(s < 15)
  })

  it('saturación + drops puntúa alto', () => {
    const s = scoreAudioBadness({
      status: 'saturated',
      underrunDelta: 5,
      overflowDelta: 20,
      highFillDropDelta: 40000,
      fillRatioVsHigh: 0.95,
      masterPeak: 0.99,
      maxStemPeak: 0.8,
    })
    assert.ok(s >= 150)
  })

  it('confidence escala con improvement', () => {
    assert.equal(confidenceFromImprovement(50, 100), 'high')
    assert.equal(confidenceFromImprovement(25, 100), 'medium')
    assert.equal(confidenceFromImprovement(5, 100), 'low')
    assert.equal(confidenceFromImprovement(50, 3), 'low')
  })
})
