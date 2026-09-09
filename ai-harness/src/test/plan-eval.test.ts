import { describe, it, expect } from 'vitest'
import {
  classifyPlanTask,
  evaluatePlanAgainstDaw,
  evaluatePlanTask,
  planMarkdownFromProjectPlan,
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

  it('track MIDI por sección exige notas en el rango de beats', () => {
    const st = stateWithTrack({ nombre: 'Drums', notes: 8 })
    ;(st.project as { tracks: Array<{ clips: Array<{ inicio: number; duracion: number; notas: unknown[] }> }> }).tracks[0]!.clips =
      [
        {
          inicio: 0,
          duracion: 16,
          notas: Array.from({ length: 8 }, (_, i) => ({ pitch: 36, inicio: i, duracion: 0.5 })),
        },
      ]
    const fail = evaluatePlanTask('MIDI «Drums» · sección Coro (beats 64–96)', st)
    expect(fail.ok).toBe(false)
    expect(fail.reason).toMatch(/64–96|64-96/)
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

  it('planMarkdownFromProjectPlan desglosa crear pista y MIDI', () => {
    const md = planMarkdownFromProjectPlan({
      kind: 'projectPlan',
      nombre: 'Demo',
      bpm: 90,
      keyLabel: 'C',
      minutes: 2,
      tracks: [{ nombre: 'Bajo', rol: 'bass', tipo: 'midi' }],
    })
    expect(md).toMatch(/### Qué se busca/)
    expect(md).toMatch(/- \[ \] Crear pista MIDI «Bajo»/)
    expect(md).toMatch(/- \[ \] Escribir MIDI por sección en «Bajo»/)
  })

  it('evaluatePlanAgainstDaw conserva prosa y marca [x]', () => {
    const md = `# Plan

## Por implementar
Ritmo: 120 BPM, 4/4.

- [ ] Pista «Bajo»

## Implementado
`
    const st = stateWithTrack({ nombre: 'Bajo', notes: 8 })
    const ev = evaluatePlanAgainstDaw(md, st)
    expect(ev.checks[0]!.ok).toBe(true)
    expect(ev.markdown).toMatch(/Ritmo: 120 BPM/)
    expect(ev.markdown).toMatch(/- \[x\] Pista «Bajo»/)
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
