import { describe, it, expect } from 'vitest'
import {
  createTurnEngine,
  drainTurn,
  gateProjectAudit,
  gateStepAudit,
  type EngineEvent,
  type EngineHost,
  type EngineHostChatRequest,
} from '../../engine'
import { parsePlan, serializePlan, aprobarPlan, type PlanEstructurado } from '../../plan/structured-plan'
import { AGENT_ACTION_CLASSES, agentActionClassOfType } from '../../agent/action-policy'

const TIPOS_A9 = [
  'plan.get',
  'plan.status',
  'plan.updateStep',
  'plan.addStep',
  'plan.proposeChange',
  'run.log',
  'run.diff',
  'audit.project',
  'audit.mix',
  'audit.step',
  'audit.history',
  'audit.compareReference',
  'session.summary',
] as const

describe('A9 · política de acciones (fail closed)', () => {
  it('clasifica las 13 herramientas de auditoría y progreso', () => {
    for (const t of TIPOS_A9) {
      expect(agentActionClassOfType(t), t).toBeDefined()
    }
  })

  it('todas son lectura salvo las tres que escriben sobre el plan', () => {
    const escritura = TIPOS_A9.filter((t) => AGENT_ACTION_CLASSES[t] === 'write')
    expect(escritura.sort()).toEqual(['plan.addStep', 'plan.proposeChange', 'plan.updateStep'])
    for (const t of TIPOS_A9) {
      if (escritura.includes(t)) continue
      expect(AGENT_ACTION_CLASSES[t], t).toBe('read')
    }
  })
})

describe('A9 · gate de QA por paso', () => {
  it('sin veredicto y con criterios → no se puede marcar hecho (fail closed)', () => {
    const r = gateStepAudit({ hayCriterios: true })
    expect(r.ok).toBe(false)
    expect(r.issues.length).toBeGreaterThan(0)
  })

  it('veredicto ok pero sin evidencia con criterios → no se puede marcar hecho', () => {
    const r = gateStepAudit({ hayCriterios: true, verdict: { ok: true } })
    expect(r.ok).toBe(false)
  })

  it('veredicto ok con evidencia → se puede marcar hecho y la evidencia se adjunta', () => {
    const r = gateStepAudit({ hayCriterios: true, verdict: { ok: true, evidencia: ['LUFS -14.0'] } })
    expect(r.ok).toBe(true)
    expect(r.evidencia).toEqual(['LUFS -14.0'])
  })

  it('veredicto ko → issues con el motivo del host', () => {
    const r = gateStepAudit({ hayCriterios: true, verdict: { ok: false, issues: ['falta la pista'] } })
    expect(r.ok).toBe(false)
    expect(r.issues).toEqual(['falta la pista'])
  })

  it('paso sin criterios y sin host de QA → ok con nota explícita', () => {
    const r = gateStepAudit({ hayCriterios: false })
    expect(r.ok).toBe(true)
    expect(r.evidencia.length).toBe(1)
  })
})

describe('A9 · gate de cierre del turno', () => {
  it('sin auditoría del proyecto → no bloquea (el host no la implementa)', () => {
    expect(gateProjectAudit(undefined).ok).toBe(true)
  })

  it('auditoría con incidencias no aceptadas → el turno no se cierra', () => {
    const r = gateProjectAudit({ ok: false, issues: ['pista sin instrumento'] })
    expect(r.ok).toBe(false)
    expect(r.issues).toEqual(['pista sin instrumento'])
  })

  it('incidencias aceptadas explícitamente → no bloquean', () => {
    const r = gateProjectAudit({ ok: false, issues: ['pista sin instrumento'], acceptedIssues: ['pista sin instrumento'] })
    expect(r.ok).toBe(true)
  })

  it('auditoría de mezcla fuera de criterio → el turno no se cierra', () => {
    const r = gateProjectAudit({ ok: true, mix: { ok: false, issues: ['True Peak 0 dBTP'] } })
    expect(r.ok).toBe(false)
    expect(r.issues).toContain('True Peak 0 dBTP')
  })

  it('auditoría limpia → avisos no bloqueantes', () => {
    const r = gateProjectAudit({ ok: true, warnings: ['pista silenciada'] })
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual(['pista silenciada'])
  })
})

// ── Motor: los gates se aplican de verdad ────────────────────────────────────

function planMd(pasos: string[]): string {
  return [
    '# Plan · Proyecto completo',
    '',
    '> Objetivo: construir tema · Modo: create · Estado: aprobado (2026-10-20) · Revisión: 3',
    '',
    '## Pasos',
    ...pasos,
    '',
    '## Notas del usuario',
    'Notas.',
  ].join('\n')
}

function aprobado(md: string): string {
  const p = parsePlan(md) as PlanEstructurado
  return serializePlan(aprobarPlan(p, '2026-10-20'))
}

function hostDePlan(opts: {
  plan: string
  auditStep?: EngineHost['auditStep']
  auditProject?: EngineHost['auditProject']
}): EngineHost & { getPlan: () => string } {
  let plan = opts.plan
  return {
    now: () => 1_000_000,
    buildSystemPrompt: ({ mode }) => `Eres el coproductor. Modo ${mode}.`,
    listTools: () => [],
    async chat(req: EngineHostChatRequest) {
      const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      const paso = /paso (S\d+)/.exec(lastUser)?.[1] ?? 'S0'
      return { success: true, content: `Listo: ${paso} terminado.`, usedModel: 'mock' }
    },
    async executeTools(calls) {
      return calls.map((c) => ({ callId: c.id, name: c.name, status: 'success' as const, data: { ok: true } }))
    },
    readDoc: (slug) => (slug === 'plan.md' ? plan : null),
    writeDoc: (slug, content) => {
      if (slug === 'plan.md') plan = content
    },
    auditStep: opts.auditStep,
    auditProject: opts.auditProject,
    getPlan: () => plan,
  }
}

describe('A9 · motor: QA no marca [x] sin audit.step', () => {
  it('paso con criterios y sin host de QA → queda bloqueado, no [x]', async () => {
    const host = hostDePlan({
      plan: aprobado(
        planMd(['- [ ] S1 · Mezcla · @mezcla — Ajustar balance', '  - criterio: LUFS -14 +/- 1']),
      ),
    })
    const engine = createTurnEngine(host)
    const events: EngineEvent[] = []
    const result = await drainTurn(
      engine.runTurn({ text: 'haz el paso', mode: 'create', conversationId: 'c1' }),
      (e) => events.push(e),
    )
    expect(result.status).toBe('completed')
    const final = parsePlan(host.getPlan())!
    expect(final.pasos[0]!.estado).toBe('bloqueado')
    expect(final.pasos[0]!.motivoBloqueo).toContain('audit.step')
  })

  it('paso con criterios y audit.step con cumple:true + evidencia → [x] con evidencia', async () => {
    const host = hostDePlan({
      plan: aprobado(
        planMd(['- [ ] S1 · Mezcla · @mezcla — Ajustar balance', '  - criterio: LUFS -14 +/- 1']),
      ),
      auditStep: () => ({ ok: true, evidencia: ['LUFS -13.8 LUFS'] }),
    })
    const engine = createTurnEngine(host)
    await drainTurn(engine.runTurn({ text: 'haz el paso', mode: 'create', conversationId: 'c1' }))
    const final = parsePlan(host.getPlan())!
    expect(final.pasos[0]!.estado).toBe('hecho')
    expect(final.pasos[0]!.evidencia.join(' ')).toContain('LUFS -13.8')
  })

  it('audit.step con comply:false → el paso se bloquea tras el reintento', async () => {
    const host = hostDePlan({
      plan: aprobado(
        planMd(['- [ ] S1 · Mezcla · @mezcla — Ajustar balance', '  - criterio: LUFS -14 +/- 1']),
      ),
      auditStep: () => ({ ok: false, issues: ['LUFS -9.2 fuera de objetivo'] }),
    })
    const engine = createTurnEngine(host)
    await drainTurn(engine.runTurn({ text: 'haz el paso', mode: 'create', conversationId: 'c1' }))
    const final = parsePlan(host.getPlan())!
    expect(final.pasos[0]!.estado).toBe('bloqueado')
    expect(final.pasos[0]!.motivoBloqueo).toContain('LUFS -9.2')
  })
})

describe('A9 · motor: el Director no cierra sin audit.project limpio', () => {
  it('auditoría del proyecto con incidencias → el turno falla (no cierra limpio)', async () => {
    const host = hostDePlan({
      plan: aprobado(planMd(['- [ ] S1 · Estructura · @coproductor — Crear pista'])),
      auditProject: () => ({ ok: false, issues: ['Pista MIDI sin instrumento cargado'] }),
    })
    const engine = createTurnEngine(host)
    const result = await drainTurn(engine.runTurn({ text: 'haz el paso', mode: 'create', conversationId: 'c1' }))
    expect(result.status).toBe('failed')
    expect(result.run.error).toContain('QA del proyecto no pasó')
    expect(result.run.error).toContain('Pista MIDI sin instrumento cargado')
  })

  it('incidencias aceptadas → el turno cierra con avisos', async () => {
    const host = hostDePlan({
      plan: aprobado(planMd(['- [ ] S1 · Estructura · @coproductor — Crear pista'])),
      auditProject: () => ({
        ok: false,
        issues: ['Pista MIDI sin instrumento cargado'],
        acceptedIssues: ['Pista MIDI sin instrumento cargado'],
      }),
    })
    const engine = createTurnEngine(host)
    const result = await drainTurn(engine.runTurn({ text: 'haz el paso', mode: 'create', conversationId: 'c1' }))
    expect(result.status).toBe('completed')
  })

  it('audit.mix fuera de criterio → el turno no cierra', async () => {
    const host = hostDePlan({
      plan: aprobado(planMd(['- [ ] S1 · Mezcla · @mezcla — Ajustar balance'])),
      auditProject: () => ({ ok: true, mix: { ok: false, issues: ['True Peak 0.2 dBTP'] } }),
    })
    const engine = createTurnEngine(host)
    const result = await drainTurn(engine.runTurn({ text: 'haz el paso', mode: 'create', conversationId: 'c1' }))
    expect(result.status).toBe('failed')
    expect(result.run.error).toContain('True Peak 0.2 dBTP')
  })
})
