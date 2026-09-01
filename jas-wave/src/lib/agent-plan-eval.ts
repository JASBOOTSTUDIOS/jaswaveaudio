/**
 * Adaptador jas-wave → @jaswave/ai-harness (persistencia plan.md vía agent-docs).
 */

export type {
  PlanEvaluation,
  PlanTask,
  PlanTaskCheck,
  PlanTaskKind,
  ProjectPlanData,
  ProjectPlanTrack,
} from '@jaswave/ai-harness'

export {
  DEFAULT_PLAN_MD,
  PLAN_SLUG,
  USER_NOTES_HEADING,
  classifyPlanTask,
  evaluatePlanAgainstDaw,
  evaluatePlanTask,
  getMarkdownSection,
  parsePlanTasks,
  planMarkdownFromProjectPlan,
  setMarkdownSection,
  type PlanEvalContext,
} from '@jaswave/ai-harness'

import type { DAWState } from '../../../shared/src/types/state'
import {
  DEFAULT_PLAN_MD,
  PLAN_SLUG,
  evaluatePlanAgainstDaw,
  parsePlanTasks,
  planMarkdownFromProjectPlan,
  type PlanEvaluation,
  type PlanEvalContext,
} from '@jaswave/ai-harness'
import type { ProjectPlanData } from './project-plan'
import { getAgentDoc, listAgentDocs, writeAgentDoc } from './agent-docs'

export function syncPlanAfterDawChange(
  projectId: string,
  state: DAWState,
  ctx?: PlanEvalContext,
): PlanEvaluation | null {
  const doc = getAgentDoc(projectId, PLAN_SLUG)
  if (!doc) return null
  if (
    doc.content.trim() === DEFAULT_PLAN_MD.trim() &&
    parsePlanTasks(doc.content).every((t) => t.text.includes('añade tareas'))
  ) {
    return null
  }
  const ev = evaluatePlanAgainstDaw(doc.content, state, ctx)
  writeAgentDoc(projectId, PLAN_SLUG, ev.markdown, { origin: 'ai', preserveUserNotes: true })
  return ev
}

export function ensurePlanFromCompose(
  projectId: string,
  plan: ProjectPlanData,
  opts?: { force?: boolean },
): void {
  const existing = getAgentDoc(projectId, PLAN_SLUG)
  const emptyish =
    !existing ||
    existing.content.trim() === DEFAULT_PLAN_MD.trim() ||
    parsePlanTasks(existing.content).every((t) => /añade tareas/i.test(t.text))
  if (opts?.force || emptyish) {
    writeAgentDoc(projectId, PLAN_SLUG, planMarkdownFromProjectPlan(plan), {
      origin: 'ai',
      preserveUserNotes: true,
    })
  }
}

export function listDocSlugs(projectId: string): string[] {
  return listAgentDocs(projectId).map((d) => d.slug)
}
