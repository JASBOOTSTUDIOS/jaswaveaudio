import { describe, it, expect } from 'vitest'
import { evaluatePlanTask } from '../plan/eval'
import { crearEstadoInicial } from '../../../shared/src/state/estado-inicial'
import type { PlanEvalContext } from '../plan/eval-context'

describe('plan eval con contexto', () => {
  it('bounce ok con render path', () => {
    const st = crearEstadoInicial()
    const ctx: PlanEvalContext = { renderPaths: ['C:/out/song.wav'], lastBounceLufs: -14.2 }
    const check = evaluatePlanTask('Exportar bounce WAV', st, ctx)
    expect(check.ok).toBe(true)
    expect(check.reason).toMatch(/song\.wav/)
  })

  it('sidechain con host routed sigue fail en 1.0 (no audible)', () => {
    const st = crearEstadoInicial()
    st.project.routing = {
      ...st.project.routing,
      sidechains: [{ id: 'sc1', origenTrackId: 'a', destinoTrackId: 'b', cantidad: 1, activo: true } as never],
    }
    const ctx: PlanEvalContext = { sidechainHostRouted: true, sidechainPeaks: { b: 0.05 } }
    const check = evaluatePlanTask('Sidechain kick al bass', st, ctx)
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/sidechain-unverified|I\/O audible/)
  })
})
