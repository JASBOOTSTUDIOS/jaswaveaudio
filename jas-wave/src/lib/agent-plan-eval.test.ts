/**
 * npx tsx --test src/lib/agent-plan-eval.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyPlanTask,
  evaluatePlanAgainstDaw,
  evaluatePlanTask,
} from '@jaswave/ai-harness'
import type { DAWState } from '../../../shared/src/types/state'

function stateWithTrack(opts: {
  nombre: string
  notes: number
  plugins?: { nombre: string; estado?: string }[]
}): DAWState {
  const notas = Array.from({ length: opts.notes }, (_, i) => ({ pitch: 60, inicio: i, duracion: 0.5 }))
  return {
    project: {
      tracks: [
        {
          id: 't1',
          nombre: opts.nombre,
          tipo: 'midi',
          plugins: opts.plugins ?? [{ nombre: 'JasWave Roles', estado: 'cargado' }],
          clips: [{ id: 'c1', nombre: 'Clip', notas }],
        },
      ],
      routing: { buses: [], sends: [], sidechains: [] },
    },
  } as unknown as DAWState
}

describe('agent-plan-eval estructurado', () => {
  it('classifyPlanTask distingue track vs sidechain', () => {
    assert.equal(classifyPlanTask('Pista «Bajo» con MIDI'), 'track')
    assert.equal(classifyPlanTask('Sidechain del kick al bass'), 'sidechain')
    assert.equal(classifyPlanTask('Exportar bounce WAV'), 'bounce')
  })

  it('track task falla sin notas', () => {
    const st = stateWithTrack({ nombre: 'Lead', notes: 0 })
    const check = evaluatePlanTask('Pista «Lead»', st)
    assert.equal(check.ok, false)
    assert.match(check.reason, /sin clips|0 notas|vac/)
  })

  it('track task ok con notas e instrumento', () => {
    const st = stateWithTrack({ nombre: 'Bajo', notes: 12 })
    const check = evaluatePlanTask('Pista «Bajo»', st)
    assert.equal(check.ok, true)
  })

  it('sidechain con routing sigue no-audible en 1.0', () => {
    const st = stateWithTrack({ nombre: 'X', notes: 0 }) as DAWState
    const fail = evaluatePlanTask('Sidechain kick → bass', st)
    assert.equal(fail.ok, false)
    ;(st.project as { routing: { sidechains: unknown[] } }).routing.sidechains = [{ id: 'sc1' }]
    const still = evaluatePlanTask('Sidechain kick → bass', st)
    assert.equal(still.ok, false)
    assert.match(still.reason, /sidechain-unverified|I\/O audible/)
  })

  it('evaluatePlanAgainstDaw incluye checks', () => {
    const md = `# Plan

## Por implementar
- [ ] Pista «Bajo»

## Implementado
`
    const st = stateWithTrack({ nombre: 'Bajo', notes: 8 })
    const ev = evaluatePlanAgainstDaw(md, st)
    assert.equal(ev.checks.length, 1)
    assert.equal(ev.checks[0]!.ok, true)
    assert.equal(ev.missing.length, 0)
  })
})
