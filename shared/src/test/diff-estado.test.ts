import { describe, it, expect } from 'vitest'
import { computeSemanticDiff, formatSemanticDiffSummary } from '../state/diff-estado'
import { crearEstadoInicial } from '../state/estado-inicial'

describe('diff-estado', () => {
  it('detecta pistas añadidas', () => {
    const before = crearEstadoInicial()
    const after = structuredClone(before) as ReturnType<typeof crearEstadoInicial>
    after.project.tracks.push({
      id: 't-new',
      nombre: 'Bajo',
      tipo: 'midi',
      volumen: 0.8,
      paneo: 0,
      silenciada: false,
      soloActiva: false,
      armada: false,
      frozen: false,
      plugins: [],
      clips: [],
      automatizaciones: [],
      color: '#fff',
    } as never)
    const diff = computeSemanticDiff(before, after)
    expect(diff.tracksAdded).toContain('Bajo')
    expect(formatSemanticDiffSummary(diff)).toMatch(/pista/)
  })
})
