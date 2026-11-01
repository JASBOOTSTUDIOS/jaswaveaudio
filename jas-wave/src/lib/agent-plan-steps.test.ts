/**
 * npx tsx --test src/lib/agent-plan-steps.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parsePlan } from '@jaswave/ai-harness'
import {
  agregarPaso,
  alternarPasoHecho,
  aprobarPlanMd,
  leerPlan,
  mensajeDeEjecucionDePaso,
  omitirPaso,
  pasoSiguienteDeEjecucion,
  reanudarPaso,
  resumenPasos,
  volverABorrador,
} from './agent-plan-steps'

const PLAN = [
  '# Plan · Mejorar la mezcla',
  '',
  '> Objetivo: subir impacto · Modo: create · Estado: borrador (2026-10-20) · Revisión: 2',
  '',
  '## Pasos',
  '- [x] S1 · Diagnóstico · @qa — Medir mezcla actual',
  '  - criterio: reporte guardado',
  '- [ ] S2 · Mezcla · @ingeniero-mezcla — Gain staging',
  '  - criterio: −18 ±3 dBFS',
  '  - herramientas: analysis.track, track.update',
  '- [-] S3 · Master · @masterizacion — Compresor paralelo',
  '',
  '## Notas del usuario',
  'No tocar el final.',
].join('\n')

describe('agent-plan-steps', () => {
  it('leerPlan detecta el formato estructurado', () => {
    const plan = leerPlan(PLAN)
    assert.ok(plan)
    assert.equal(plan!.pasos.length, 3)
    assert.equal(resumenPasos(plan!), '1/3 · 1 omitido')
  })

  it('leerPlan devuelve null en formato viejo', () => {
    assert.equal(leerPlan('# Plan\n\n## Por implementar\n- [ ] Algo\n'), null)
  })

  it('alternarPasoHecho marca y desmarca conservando notas', () => {
    const done = alternarPasoHecho(PLAN, 'S2')
    assert.ok(done)
    assert.equal(parsePlan(done!)!.pasos[1]!.estado, 'hecho')
    assert.match(done!, /No tocar el final\./)
    const back = alternarPasoHecho(done!, 'S2')
    assert.equal(parsePlan(back!)!.pasos[1]!.estado, 'pendiente')
    assert.equal(alternarPasoHecho(PLAN, 'S99'), null)
  })

  it('omitirPaso y reanudarPaso cambian el estado', () => {
    const om = omitirPaso(PLAN, 'S2')
    assert.equal(parsePlan(om!)!.pasos[1]!.estado, 'omitido')
    const re = reanudarPaso(om!, 'S2')
    assert.equal(parsePlan(re!)!.pasos[1]!.estado, 'pendiente')
  })

  it('agregarPaso añade al final con id siguiente y pendiente', () => {
    const next = agregarPaso(PLAN, ' Limpiar  200–400 Hz ', {
      fase: 'Mezcla',
      agente: 'ingeniero-mezcla',
      criterios: ['sin resonancia'],
    })
    assert.ok(next)
    const plan = parsePlan(next!)!
    const p = plan.pasos.at(-1)!
    assert.equal(p.id, 'S4')
    assert.equal(p.titulo, 'Limpiar 200–400 Hz')
    assert.equal(p.estado, 'pendiente')
    assert.equal(p.fase, 'Mezcla')
    assert.equal(p.agente, 'ingeniero-mezcla')
    assert.deepEqual(p.criterios, ['sin resonancia'])
    assert.match(next!, /No tocar el final\./)
    assert.equal(agregarPaso(PLAN, '   '), null)
    assert.equal(agregarPaso('# Plan viejo', 'algo'), null)
  })

  it('aprobarPlanMd pasa a aprobado una sola vez; volverABorrador devuelve a editar', () => {
    const ok = aprobarPlanMd(PLAN, '2026-10-21')
    assert.ok(ok)
    const plan = parsePlan(ok!)!
    assert.equal(plan.estadoPlan, 'aprobado')
    assert.equal(plan.revision, 3)
    assert.equal(aprobarPlanMd(ok!), null)
    const draft = volverABorrador(ok!)
    assert.equal(parsePlan(draft!)!.estadoPlan, 'borrador')
    assert.equal(volverABorrador(PLAN), null)
  })

  it('mensajeDeEjecucionDePaso pide solo ese paso con sus criterios', () => {
    const plan = leerPlan(PLAN)!
    const msg = mensajeDeEjecucionDePaso(plan.pasos[1]!)
    assert.match(msg, /SOLO la sección del paso S2/)
    assert.match(msg, /Gain staging/)
    assert.match(msg, /−18 ±3 dBFS/)
    assert.match(msg, /analysis\.track/)
    assert.match(msg, /No reescribas el plan entero/)
  })

  it('pasoSiguienteDeEjecucion salta hechos y omitidos', () => {
    const plan = leerPlan(PLAN)!
    assert.equal(pasoSiguienteDeEjecucion(plan)?.id, 'S2')
  })
})
