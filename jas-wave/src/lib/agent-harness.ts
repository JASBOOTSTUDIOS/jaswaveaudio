/**
 * Adaptador jas-wave → @jaswave/ai-harness (persistencia plan.md vía agent-docs).
 */

export {
  HARNESS_MAX_ACTIONS_PER_REPAIR,
  HARNESS_MAX_REPAIR_TURNS,
  HARNESS_MIN_AUDIBLE_PEAK,
  HARNESS_STALE_LIMIT,
  actionFingerprint,
  buildHarnessRepairMessage,
  filterRedundantRepairActions,
  formatDawDebugDump,
  formatHarnessProgress,
  formatHarnessStopLine,
  harnessReviewNeeded,
  harnessShouldRepair,
  healthSignature,
  inspectDawHealth,
  runHarnessFollowups,
  seedAttemptedFingerprints,
  type DawHealthIssue,
  type DawHealthReport,
  type HarnessAuditTrack,
  type HarnessFollowupResult,
  type HarnessFollowupTurn,
  type HarnessHealthContext,
  type HarnessProgressEvent,
  type HarnessStopReason,
} from '@jaswave/ai-harness'

import {
  buildHarnessReviewMessage as buildHarnessReviewMessageCore,
  type PlanEvaluation,
} from '@jaswave/ai-harness'
import { getAgentDoc, PLAN_SLUG } from './agent-docs'

export type { ActionResult, DawAction } from '@jaswave/ai-harness'

export function buildHarnessReviewMessage(opts: {
  userText: string
  evalSummary: string
  actionsSummary: string
  projectId: string
  evaluation: PlanEvaluation | null
}): string {
  const plan = getAgentDoc(opts.projectId, PLAN_SLUG)
  return buildHarnessReviewMessageCore({
    userText: opts.userText,
    evalSummary: opts.evalSummary,
    actionsSummary: opts.actionsSummary,
    planMarkdown: plan?.content,
    evaluation: opts.evaluation,
  })
}
