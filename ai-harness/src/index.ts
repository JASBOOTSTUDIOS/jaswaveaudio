/**
 * @jaswave/ai-harness — bucle de reparación IA + evaluación plan.md ↔ DAW.
 * Sin dependencias de Electron/React; el cliente (jas-wave) aporta persistencia y executor.
 *
 * Estructura:
 *   plan/  — evaluación plan.md ↔ DAW
 *   loop/  — harness de reparación + cola de jobs
 *   agent/ — modos y política de acciones
 *   ask/   — contexto de solo lectura (consultas)
 */

export type { HarnessActionResult, HarnessDawAction } from './types/actions'
export type {
  PlanEvaluation,
  PlanTask,
  PlanTaskCheck,
  PlanTaskKind,
  ProjectPlanData,
  ProjectPlanTrack,
} from './plan/types'

export {
  DEFAULT_PLAN_MD,
  PLAN_SLUG,
  USER_NOTES_HEADING,
  getMarkdownSection,
  setMarkdownSection,
} from './plan/markdown'

export type { PlanEvalContext, PlanEvalAuditTrack } from './plan/eval-context'

export {
  classifyPlanTask,
  evaluatePlanAgainstDaw,
  evaluatePlanTask,
  parsePlanTasks,
  planMarkdownFromProjectPlan,
} from './plan/eval'

export { planHasOpenTasks } from './plan/tasks'

export {
  HARNESS_MAX_ACTIONS_PER_REPAIR,
  HARNESS_MAX_REPAIR_TURNS,
  HARNESS_MIN_AUDIBLE_PEAK,
  HARNESS_STALE_LIMIT,
  actionFingerprint,
  buildHarnessRepairMessage,
  buildHarnessReviewMessage,
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
  type ActionResult,
  type DawAction,
} from './loop/harness'

export {
  type AgentJob,
  type AgentJobKind,
  type AgentJobQueueStore,
  type AgentJobRunner,
  type PlanMarkdownResolver,
  cancelAgentJobs,
  createAgentJobQueueStore,
  drainAgentJobQueue,
  enqueueAgentJob,
  getAgentJobState,
  planHasPendingTasks,
  registerAgentJobRunner,
  setPlanMarkdownResolver,
  shouldContinueHarness,
  subscribeAgentJobs,
} from './loop/job-queue'

export {
  type HarnessJobContext,
  type HarnessUntilPlanDeps,
  createHarnessJobContextStore,
  peekHarnessJobContext,
  runHarnessUntilPlanComplete,
  stashHarnessJobContext,
} from './loop/until-plan'

export {
  AGENT_MODE_META,
  detectAgentMode,
  modeBlocksMutation,
  modePromptBlock,
  wantsFullProject,
  isSongRefineIntent,
  isTempoOnlyRefine,
  inferBpmFromTempoIntent,
  isProjectAuditIntent,
  type AgentMode,
} from './agent/modes'

export {
  REASONING_PHASE_META,
  buildFinalTurnUserMessage,
  reasoningSeedUserMessage,
  type ReasoningPhase,
} from './agent/reasoning-prompts'

export {
  parseReadBlockFromText,
  runAbbreviatedReasoning,
  runReasoningLoop,
  stripReadBlock,
  sanitizeInnerThought,
  REASONING_REPAIR_PHASES,
  type ReasoningChatTurn,
  type ReasoningStep,
  type RunReasoningLoopOpts,
} from './agent/reasoning-loop'

export {
  AGENT_DOCS_WRITE_ACTIONS,
  AGENT_READ_ONLY_ACTIONS,
  actionRiskLevel,
  batchNeedsDestructiveConfirm,
  ensureMusicBuildForFullProject,
  forcePreviewAplicar,
  isDestructiveAction,
  isDocsWriteAction,
  isMutatingAction,
  isPreviewOnlyAction,
  isReadOnlyAction,
  partitionActions,
  payloadOfAction,
  withAplicarTrue,
  type ActionPartition,
  type AgentAction,
} from './agent/action-policy'

export {
  answerLocalReadQuery,
  buildReadOnlyProjectContext,
  formatMidiTimelineForPrompt,
  buildMidiAuditReport,
  collectMidiAuditIssues,
  buildMidiAuditFixActions,
  buildMidiAuditClarifications,
  isGarbageAssistantReply,
} from './ask/read-context'

export {
  getSelectedTrackId,
  listMidiClips,
  resolvePianoRollClip,
  selectTrackPayload,
} from './ask/selection'
