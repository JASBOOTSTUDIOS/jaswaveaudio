import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DAWState } from '../../../shared/src/types/state'
import {
  filterMentionables,
  groupMentionables,
  listMentionables,
  mentionDraftAtCaret,
  orderedMentionables,
} from './ai-mentions'

function estado(): DAWState {
  return {
    project: {
      id: 'p1',
      tracks: [
        {
          id: 't1',
          nombre: 'Piano',
          tipo: 'instrument',
          clips: [{ id: 'c1', nombre: 'Intro' }],
          plugins: [{ id: 'pl1', nombre: 'Param EQ', tipo: 'effect' }],
        },
      ],
      master: { plugins: [] },
    },
  } as unknown as DAWState
}

describe('autocompletado del chat', () => {
  const todo = listMentionables(estado())

  it('«/» solo muestra comandos, modos y acciones', () => {
    const hits = filterMentionables(todo, '', '/')
    assert.ok(hits.length > 0)
    assert.ok(hits.every((h) => h.kind === 'action' || h.kind === 'mode'))
    assert.ok(hits.some((h) => h.label === '/aprender'))
  })

  it('«@» solo muestra referencias, sin comandos ni modos', () => {
    const hits = filterMentionables(todo, '', '@')
    assert.ok(hits.every((h) => h.kind !== 'action' && h.kind !== 'mode'))
    assert.ok(hits.some((h) => h.kind === 'track' && h.label === 'Piano'))
    assert.ok(hits.some((h) => h.kind === 'clip' && h.label === 'Intro'))
    assert.ok(hits.some((h) => h.kind === 'agent'))
  })

  it('los alias en inglés encuentran el comando en español sin duplicarlo', () => {
    const hits = filterMentionables(todo, 'learn', '/')
    assert.deepEqual(hits.map((h) => h.label), ['/aprender'])
    const etiquetas = filterMentionables(todo, '', '/').map((h) => h.label)
    assert.equal(etiquetas.filter((l) => l === '/learn').length, 0)
    assert.equal(new Set(etiquetas).size, etiquetas.length)
  })

  it('el orden de las flechas coincide con el orden en que se pintan los grupos e incluye agentes', () => {
    const hits = filterMentionables(todo, '', '@')
    const pintado = groupMentionables(hits).flatMap((g) => g.items.map((i) => i.id))
    assert.deepEqual(orderedMentionables(hits).map((i) => i.id), pintado)
    assert.equal(pintado.length, hits.length)
    assert.ok(orderedMentionables(hits).some((i) => i.kind === 'agent'))
  })

  it('mentionDraftAtCaret indica el disparador', () => {
    assert.deepEqual(mentionDraftAtCaret('hola @pi', 8), { start: 5, query: 'pi', trigger: '@' })
    assert.deepEqual(mentionDraftAtCaret('/pl', 3), { start: 0, query: 'pl', trigger: '/' })
    assert.deepEqual(mentionDraftAtCaret('mira /pl', 8), { start: 5, query: 'pl', trigger: '/' })
  })

  it('una barra dentro de una palabra no abre comandos y los argumentos cierran la lista', () => {
    assert.equal(mentionDraftAtCaret('a/b', 3), null)
    assert.equal(mentionDraftAtCaret('/plan hazlo', 11), null)
    assert.deepEqual(mentionDraftAtCaret('/plan @pi', 9), { start: 6, query: 'pi', trigger: '@' })
  })
})
