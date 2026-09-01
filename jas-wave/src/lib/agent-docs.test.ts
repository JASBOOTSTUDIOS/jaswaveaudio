import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  docsFolderForProject,
  getMarkdownSection,
  mergePreservingUserNotes,
  parseDocBlocksFromText,
  sanitizeDocSlug,
  setMarkdownSection,
} from './agent-docs'
import { evaluatePlanAgainstDaw, planMarkdownFromProjectPlan } from './agent-plan-eval'
import { buildHarnessReviewMessage, harnessReviewNeeded } from './agent-harness'
import type { DAWState } from '../../../shared/src/types/state'

describe('agent-docs', () => {
  it('normaliza slugs a .md', () => {
    assert.equal(sanitizeDocSlug('Plan'), 'plan.md')
    assert.equal(sanitizeDocSlug('notas mezcla.md'), 'notas-mezcla.md')
  })

  it('preserva Notas del usuario al fusionar', () => {
    const prev = '# X\n\n## Notas del usuario\nNo pises esto.\n'
    const incoming = '# X\n\n## Evaluación\nnueva\n'
    const merged = mergePreservingUserNotes(prev, incoming)
    assert.match(getMarkdownSection(merged, 'Notas del usuario'), /No pises esto/)
  })

  it('parsea bloques <<<DOC', () => {
    const blocks = parseDocBlocksFromText('hola\n<<<DOC notas.md\n# Hola\nDOC>>>\n')
    assert.equal(blocks[0]?.slug, 'notas.md')
    assert.match(blocks[0]?.content ?? '', /# Hola/)
  })

  it('setMarkdownSection inserta o reemplaza', () => {
    const md = setMarkdownSection('# T\n\n## A\nhi\n', 'Evaluación', 'ok')
    assert.equal(getMarkdownSection(md, 'Evaluación').trim(), 'ok')
  })

  it('resuelve carpeta docs junto al .jaswave', () => {
    assert.equal(docsFolderForProject('C:\\music\\tema.jaswave'), 'C:\\music\\docs')
    assert.equal(docsFolderForProject('/home/u/tema.jaswave'), '/home/u/docs')
  })
})

describe('agent-plan-eval', () => {
  it('marca tareas cubiertas por pistas del DAW', () => {
    const plan = planMarkdownFromProjectPlan({
      kind: 'projectPlan',
      nombre: 'Demo',
      bpm: 90,
      keyLabel: 'C',
      minutes: 2,
      tracks: [{ nombre: 'Bajo Cálido', rol: 'bass', tipo: 'midi', pluginNombre: 'Analog Lab V' }],
    })
    const state = {
      project: {
        tracks: [
          {
            id: 't1',
            nombre: 'Bajo Cálido',
            plugins: [{ nombre: 'Analog Lab V' }],
            clips: [],
          },
        ],
      },
    } as unknown as DAWState
    const ev = evaluatePlanAgainstDaw(plan, state)
    assert.equal(ev.missing.length, 0)
    assert.equal(ev.done, 1)
    assert.match(getMarkdownSection(ev.markdown, 'Implementado'), /Bajo/)
    assert.match(getMarkdownSection(ev.markdown, 'Evaluación'), /Intención vs ejecución/)
  })
})

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
