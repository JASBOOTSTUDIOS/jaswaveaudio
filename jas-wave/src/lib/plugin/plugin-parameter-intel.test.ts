import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  enrichParameter,
  inferSemanticTags,
  searchParameters,
} from './plugin-parameter-intel'

describe('plugin-parameter-intel', () => {
  it('no inventa semántica para nombres opacos', () => {
    assert.deepEqual(inferSemanticTags('P47'), [])
    assert.deepEqual(inferSemanticTags('param_12'), [])
  })

  it('etiqueta cutoff / brightness solo si el nombre lo dice', () => {
    const tags = inferSemanticTags('Filter Cutoff', 'Hz')
    assert.ok(tags.includes('cutoff'))
    assert.ok(tags.includes('filter'))
  })

  it('searchParameters rankea brightness hacia cutoff', () => {
    const params = [
      enrichParameter(
        { parameterId: '47', name: 'Filter Cutoff', normalizedValue: 0.7, unit: 'Hz' },
        'inst',
        'slot',
      ),
      enrichParameter(
        { parameterId: '9', name: 'P9', normalizedValue: 0.1 },
        'inst',
        'slot',
      ),
    ]
    const hit = searchParameters(params, 'brightness')
    assert.equal(hit[0]?.parameterId, '47')
    assert.equal(searchParameters(params, 'P9')[0]?.parameterId, '9')
  })
})
