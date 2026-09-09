import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  docsFolderForProject,
  getMarkdownSection,
  mergePreservingUserNotes,
  parseDocBlocksFromText,
  sanitizeDocSlug,
  setMarkdownSection,
  ensurePlanTemplate,
  normalizePlanCheckboxes,
  formatDocsForPrompt,
  DEFAULT_PLAN_MD,
} from './agent-docs'
import {
  applyUserRequestToPlanMd,
  evaluatePlanAgainstDaw,
  planMarkdownFromProjectPlan,
} from './agent-plan-eval'
import { buildHarnessReviewMessage, harnessReviewNeeded } from './agent-harness'
import {
  buildDocTextAnchor,
  formatMusicalSelectionForPrompt,
  headingNearSnippet,
} from './ai-selection-context'
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

  it('ensurePlanTemplate añade secciones que faltan', () => {
    const md = ensurePlanTemplate('# Plan: Pop\n\n## Intención\nPop moderno.\n\n## Por implementar\n- [ ] BPM 120\n')
    assert.match(getMarkdownSection(md, 'Intención'), /Pop moderno/)
    assert.match(getMarkdownSection(md, 'Por implementar'), /BPM 120/)
    assert.ok(getMarkdownSection(md, 'Implementado') !== undefined)
    assert.match(md, /## Evaluación/)
    assert.match(md, /## Notas del usuario/)
  })

  it('normalizePlanCheckboxes convierte viñetas sueltas', () => {
    const md = normalizePlanCheckboxes('# Plan\n\n## Por implementar\n- Pista «Bajo»\n\n## En curso\n')
    assert.match(getMarkdownSection(md, 'Por implementar'), /- \[ \] Pista «Bajo»/)
  })

  it('applyUserRequestToPlanMd anota el pedido y añade una tarea', () => {
    const next = applyUserRequestToPlanMd(DEFAULT_PLAN_MD, 'Crea un bajo funk a 100 BPM')
    assert.ok(next)
    assert.match(getMarkdownSection(next!, 'Intención'), /Último pedido/)
    assert.match(getMarkdownSection(next!, 'Intención'), /bajo funk/)
    assert.match(getMarkdownSection(next!, 'Por implementar'), /- \[ \] Crea un bajo funk/)
    assert.equal(applyUserRequestToPlanMd(DEFAULT_PLAN_MD, 'hola'), null)
    assert.equal(applyUserRequestToPlanMd(DEFAULT_PLAN_MD, 'hazlo'), null)
    assert.equal(applyUserRequestToPlanMd(DEFAULT_PLAN_MD, 'qué pistas hay?'), null)
    assert.equal(
      applyUserRequestToPlanMd(
        DEFAULT_PLAN_MD,
        'Implementa SOLO la sección «Qué se busca» del plan. No reescribas las demás secciones ni Notas del usuario.',
      ),
      null,
    )
    assert.equal(applyUserRequestToPlanMd(DEFAULT_PLAN_MD, 'actualiza el plan a lo que te dije.'), null)
    assert.equal(applyUserRequestToPlanMd(DEFAULT_PLAN_MD, 'continua.'), null)
  })

  it('plan.md no se exige en cada mensaje', () => {
    const text = formatDocsForPrompt('test-docs-policy')
    assert.match(text, /no en cada pregunta corta/)
    assert.equal(/OBLIGATORIO en CADA mensaje/i.test(text), false)
  })

  it('resuelve carpeta docs junto al .jaswave', () => {
    assert.equal(docsFolderForProject('C:\\music\\tema.jaswave'), 'C:\\music\\docs')
    assert.equal(docsFolderForProject('/home/u/tema.jaswave'), '/home/u/docs')
  })
})

describe('selección de plan.md', () => {
  const md = `# Plan\n\n## Por implementar\n- [ ] Pista «Bajo»\n- [ ] Pad aéreo\n`

  it('headingNearSnippet encuentra la sección', () => {
    assert.equal(headingNearSnippet(md, 'Pista «Bajo»'), 'Por implementar')
  })

  it('formatMusicalSelectionForPrompt pide actualizar solo el fragmento', () => {
    const a = buildDocTextAnchor({ slug: 'plan.md', markdown: md, text: '- [ ] Pista «Bajo»' })
    assert.equal(a.kind, 'doc-text')
    assert.equal(a.heading, 'Por implementar')
    const block = formatMusicalSelectionForPrompt(a)
    assert.match(block, /SOLO este fragmento/)
    assert.match(block, /Pista «Bajo»/)
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
            tipo: 'midi',
            plugins: [{ nombre: 'Analog Lab V' }],
            clips: [],
          },
        ],
      },
    } as unknown as DAWState
    const ev = evaluatePlanAgainstDaw(plan, state)
    assert.equal(ev.missing.length, 1)
    assert.equal(ev.done, 1)
    assert.match(getMarkdownSection(ev.markdown, 'Implementado'), /Crear pista|Bajo/)
    assert.match(getMarkdownSection(ev.markdown, 'Por implementar'), /MIDI|Escribir/)
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
