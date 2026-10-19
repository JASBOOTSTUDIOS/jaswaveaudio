/**
 * Tests: wipe determinista del proyecto.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensureWipeProjectAction, buildWipeProjectAction } from './project-wipe'
import { isProjectWipeIntent } from './ai-modes'

describe('project-wipe', () => {
  it('detecta limpia el proyecto por completo', () => {
    assert.equal(isProjectWipeIntent('limpia el proyecto por completo'), true)
  })

  it('sustituye clip.delete rotos por daw.wipeProject', () => {
    const out = ensureWipeProjectAction(
      [{ type: 'clip.delete', payload: { pistaId: '1788895445' } }],
      'limpia el proyecto por completo',
      true,
    )
    assert.equal(out.length, 1)
    assert.equal(out[0]!.type, 'daw.wipeProject')
  })

  it('buildWipeProjectAction', () => {
    const a = buildWipeProjectAction({ aplicar: false })
    assert.equal(a.type, 'daw.wipeProject')
    assert.equal(a.payload?.aplicar, false)
  })
})
