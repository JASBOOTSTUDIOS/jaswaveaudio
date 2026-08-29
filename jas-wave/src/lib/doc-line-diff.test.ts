import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeLineDiff, diffStats } from './doc-line-diff'

describe('doc-line-diff', () => {
  it('detecta líneas añadidas y eliminadas', () => {
    const lines = computeLineDiff('a\nb\nc', 'a\nx\nc')
    const stats = diffStats(lines)
    assert.equal(stats.removed, 1)
    assert.equal(stats.added, 1)
    assert.equal(stats.unchanged, 1)
  })

  it('marca documento nuevo como todo añadido', () => {
    const lines = computeLineDiff('', '# Plan\n- [ ] tarea')
    assert.ok(lines.every((l) => l.type === 'add'))
  })
})
