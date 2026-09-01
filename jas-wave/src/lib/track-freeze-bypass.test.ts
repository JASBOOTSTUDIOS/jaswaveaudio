/**
 * npx tsx --test src/lib/track-freeze-bypass.test.ts
 * (helpers de freeze-commands vía shared)
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  encodeFrozenComment,
  parseFrozenComment,
} from '../../../shared/src/commands/freeze-commands'

describe('freeze bypass snapshot', () => {
  it('roundtrips audioPath + bypass map', () => {
    const encoded = encodeFrozenComment('C:/tmp/x.wav', { a: true, b: false })
    const parsed = parseFrozenComment(encoded)
    assert.equal(parsed.audioPath, 'C:/tmp/x.wav')
    assert.deepEqual(parsed.bypassByPluginId, { a: true, b: false })
  })

  it('legacy frozen:path without bps', () => {
    const parsed = parseFrozenComment('frozen:C:/old.wav')
    assert.equal(parsed.audioPath, 'C:/old.wav')
    assert.equal(parsed.bypassByPluginId, undefined)
  })
})
