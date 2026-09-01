import { describe, it, expect } from 'vitest'
import {
  classifyPlanTask,
  evaluatePlanAgainstDaw,
  evaluatePlanTask,
} from '../plan/eval'
import type { DAWState } from '@jaswave/shared'

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

describe('plan eval estructurado', () => {
  it('classifyPlanTask distingue track vs sidechain', () => {
    expect(classifyPlanTask('Pista «Bajo» con MIDI')).toBe('track')
    expect(classifyPlanTask('Sidechain del kick al bass')).toBe('sidechain')
    expect(classifyPlanTask('Exportar bounce WAV')).toBe('bounce')
  })

  it('track task falla sin notas', () => {
    const st = stateWithTrack({ nombre: 'Lead', notes: 0 })
    const check = evaluatePlanTask('Pista «Lead»', st)
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/sin clips|0 notas|vac/)
  })

  it('track task ok con notas e instrumento', () => {
    const st = stateWithTrack({ nombre: 'Bajo', notes: 12 })
    const check = evaluatePlanTask('Pista «Bajo»', st)
    expect(check.ok).toBe(true)
  })

  it('sidechain con routing sigue no-audible en 1.0', () => {
    const st = stateWithTrack({ nombre: 'X', notes: 0 }) as DAWState
    const fail = evaluatePlanTask('Sidechain kick → bass', st)
    expect(fail.ok).toBe(false)
    ;(st.project as { routing: { sidechains: unknown[] } }).routing.sidechains = [{ id: 'sc1' }]
    const still = evaluatePlanTask('Sidechain kick → bass', st)
    expect(still.ok).toBe(false)
    expect(still.reason).toMatch(/sidechain-unverified|I\/O audible/)
  })

  it('evaluatePlanAgainstDaw incluye checks', () => {
    const md = `# Plan

## Por implementar
- [ ] Pista «Bajo»

## Implementado
`
    const st = stateWithTrack({ nombre: 'Bajo', notes: 8 })
    const ev = evaluatePlanAgainstDaw(md, st)
    expect(ev.checks.length).toBe(1)
    expect(ev.checks[0]!.ok).toBe(true)
    expect(ev.missing.length).toBe(0)
  })

  it('bounce requiere LUFS o compareTarget', () => {
    const st = stateWithTrack({ nombre: 'X', notes: 0 })
    const fail = evaluatePlanTask('Exportar bounce WAV', st, { renderPaths: ['/tmp/out.wav'] })
    expect(fail.ok).toBe(false)
    expect(fail.reason).toMatch(/compareTarget|LUFS/)
    const ok = evaluatePlanTask('Exportar bounce WAV', st, {
      renderPaths: ['/tmp/out.wav'],
      lastBounceLufs: -14.2,
    })
    expect(ok.ok).toBe(true)
  })

  it('mix master requiere evidencia loudness', () => {
    const st = stateWithTrack({ nombre: 'X', notes: 0 }) as DAWState
    const fail = evaluatePlanTask('Master streaming -14 LUFS', st)
    expect(fail.ok).toBe(false)
    expect(fail.kind).toBe('bounce')
    const ok = evaluatePlanTask('Master streaming -14 LUFS', st, {
      renderPaths: ['/tmp/out.wav'],
      compareTargetOk: true,
    })
    expect(ok.ok).toBe(true)
  })
})
