import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groovesParecidos } from './parecidos'

const lista = [
  { id: 'jw-worship-4-4-puente-crescendo', nombre: 'Worship 4/4 Puente crescendo' },
  { id: 'jw-worship-4-4-verso-suave', nombre: 'Worship 4/4 Verso suave' },
  { id: 'jw-worship-4-4-coro-lleno', nombre: 'Worship 4/4 Coro lleno' },
  { id: 'jw-rock-4-4-basico', nombre: 'Rock 4/4 Básico' },
]

describe('groovesParecidos', () => {
  it('resuelve un id inventado pero casi correcto al groove único más parecido', () => {
    const r = groovesParecidos(lista, 'jw-worship-4-4-puente-crescendo-por-capas')
    assert.equal(r.mejor?.id, 'jw-worship-4-4-puente-crescendo')
  })

  it('con varios candidatos igual de buenos no adivina y los propone', () => {
    const r = groovesParecidos(lista, 'worship 4 4')
    assert.equal(r.mejor, undefined)
    assert.ok(r.candidatos.length >= 3)
    assert.ok(r.candidatos.every((c) => c.id.includes('worship')))
  })

  it('sin nada en común no devuelve nada', () => {
    const r = groovesParecidos(lista, 'xyz-qqq')
    assert.equal(r.mejor, undefined)
    assert.deepEqual(r.candidatos, [])
  })
})
