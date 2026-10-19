/**
 * Pipeline post-turno: health → audit → plan-eval → bounce evidence.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { PlanEvalContext, PlanEvaluation } from '@jaswave/ai-harness'
import { inspectDawHealth, harnessShouldRepair } from '@jaswave/ai-harness'
import { evaluatePlanAgainstDaw } from './agent-plan-eval'
import { buildAuditSnapshot, buildHarnessHealthContext } from './agent-audit-bridge'
import type { ActionResult } from './ai-daw-agent'
import { getAgentDoc, PLAN_SLUG } from './agent-docs'

export type CertifyPipelineResult = {
  healthOk: boolean
  planEval: PlanEvaluation | null
  issues: string[]
  shouldRepair: boolean
  /** Errores del auditor de producción / health. */
  auditErrors: number
  /** Huecos sección×pista pendientes. */
  sectionGaps: number
}

const g = globalThis as unknown as {
  __jaswaveLastRender?: { paths: string[]; lufs?: number }
  __jaswaveCompareTarget?: { ok: boolean; deltaDb?: number }
  __jaswaveLastListen?: { ok: boolean; issues?: string[]; summary?: string; target?: string }
}

export function recordRenderOutput(path: string, lufs?: number): void {
  const prev = g.__jaswaveLastRender?.paths ?? []
  g.__jaswaveLastRender = { paths: [...prev, path].slice(-5), lufs }
}

export function recordCompareTargetResult(ok: boolean, deltaDb?: number): void {
  g.__jaswaveCompareTarget = { ok, deltaDb }
}

function ingestResultsEvidence(results: ActionResult[]): void {
  for (const r of results) {
    if (r.type === 'analysis.compareTarget' && r.success && r.data && typeof r.data === 'object') {
      const cmp = r.data as { deltaDb?: number; ok?: boolean }
      const delta = typeof cmp.deltaDb === 'number' ? cmp.deltaDb : undefined
      const ok = cmp.ok === true || (delta != null && Math.abs(delta) <= 1.5)
      recordCompareTargetResult(ok, delta)
      g.__jaswaveLastListen = {
        ...(g.__jaswaveLastListen ?? { ok }),
        ok,
        target: 'streaming',
      }
    }
    if (
      (r.type === 'render.start' || r.type === 'daw.masterPass' || r.type === 'analysis.fullReport') &&
      r.success &&
      r.data &&
      typeof r.data === 'object'
    ) {
      const data = r.data as {
        outputPath?: string
        loudness?: { integratedLufs?: number; integrated?: number }
        listenReport?: { ok?: boolean; issues?: string[]; summary?: string; target?: string }
        ok?: boolean
        issues?: string[]
        summary?: string
      }
      const listen = data.listenReport
      if (listen && typeof listen === 'object') {
        g.__jaswaveLastListen = {
          ok: listen.ok !== false,
          issues: listen.issues,
          summary: listen.summary,
          target: listen.target,
        }
      } else if (r.type === 'analysis.fullReport' && typeof data.ok === 'boolean') {
        g.__jaswaveLastListen = {
          ok: data.ok,
          issues: data.issues,
          summary: data.summary,
        }
      }
      if (data.outputPath) {
        recordRenderOutput(data.outputPath, data.loudness?.integratedLufs ?? data.loudness?.integrated)
      }
    }
  }
}

function buildPlanEvalContext(
  tienda: TiendaDAW,
  healthCtx: Awaited<ReturnType<typeof buildHarnessHealthContext>>,
): PlanEvalContext {
  const st = tienda.obtenerEstado()
  const sends = st.project?.routing?.sends?.filter((s) => s.activo !== false && (s.cantidad ?? 0) > 0) ?? []
  return {
    auditTracks: healthCtx.auditTracks?.map((t) => ({
      id: t.id,
      name: t.name,
      peak: t.peak,
      notes: t.notes,
      vstSlot: t.vstSlot,
    })),
    sidechainHostRouted: healthCtx.sidechainHostRouted,
    sidechainPeaks: healthCtx.sidechainPeaks,
    renderPaths: g.__jaswaveLastRender?.paths,
    lastBounceLufs: g.__jaswaveLastRender?.lufs,
    compareTargetOk: g.__jaswaveCompareTarget?.ok,
    compareTargetDeltaDb: g.__jaswaveCompareTarget?.deltaDb,
    activeSendCount: sends.length,
  }
}

export async function runPostTurnCertifyPipeline(
  tienda: TiendaDAW,
  results: ActionResult[],
  opts?: { sidechainApplied?: boolean },
): Promise<CertifyPipelineResult> {
  ingestResultsEvidence(results)
  const issues: string[] = []
  const healthCtx = await buildHarnessHealthContext(tienda, opts)
  const snap = await buildAuditSnapshot(tienda)
  issues.push(...snap.issues)

  const st = tienda.obtenerEstado()
  const planCtx = buildPlanEvalContext(tienda, healthCtx)
  const doc = getAgentDoc(st.project.id, PLAN_SLUG)
  const planEval = doc ? evaluatePlanAgainstDaw(doc.content, st, planCtx) : null

  const health = inspectDawHealth(st, results, planEval, healthCtx)
  if (!health.ok) {
    issues.push(...health.errors.map((e) => e.message))
  }

  return {
    healthOk: health.ok,
    planEval,
    issues,
    shouldRepair: harnessShouldRepair(health),
    auditErrors: health.errors.length,
    sectionGaps: health.sectionGaps?.length ?? 0,
  }
}
