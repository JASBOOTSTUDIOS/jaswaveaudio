/**
 * @jaswave/ai-harness — bucle de reparación IA + evaluación plan.md ↔ DAW.
 * Sin dependencias de Electron/React; el cliente (jas-wave) aporta persistencia y executor.
 *
 * Estructura:
 *   context/ prompting/ recovery/ planning/ quality/ execution/ compatibility/
 */

export type { AgentTurnContext, AgentTrackSummary } from './context/agent-context'
export { composeAgentTurnContext, formatAgentContextForPrompt } from './context/compose-agent-context'
export { composeAgentPrompt, type ComposeAgentPromptInput } from './prompting/compose-agent-prompt'
export { agentBasePrompt } from './prompting/base-prompt'
export { agentMusicPolicyPrompt } from './prompting/music-policy'

export { parseActionsFromText, stripActionsBlock } from './recovery/legacy-actions-parser'
export {
  deterministicFallbacksFromUserIntent,
  isCreativeGenerationRequest,
} from './recovery/deterministic-fallbacks'
export {
  legacyActionsToToolCalls,
  toolCallsToLegacyActions,
  filterUnknownTools,
  normalizeToolArgs,
  type AgentToolCall,
} from './compatibility/legacy-actions-adapter'

export {
  shouldUseWorkPlan,
  buildWorkPlanFromActions,
  projectStateFingerprint,
  type AgentWorkPlan,
  type AgentWorkPhase,
  type PlannedAction,
} from './planning/agent-work-plan'
export { runAgentWorkPlan, type AgentWorkPlanRunResult, type AgentWorkPlanEventName } from './execution/plan-runner'

export {
  AGENT_LOOP_LIMITS,
  AGENT_LOOP_MAX_TOOLS_PER_ITERATION,
  type AgentRunStatus,
  type AgentDecision,
  type AgentObservation,
  type AgentLoopToolCall,
  type AgentLoopToolResult,
  type AgentRunResult,
  type AgentExecutionLimits,
} from './loop/agent-run-types'
export { runAgentLoop, type AgentLoopDeps } from './loop/agent-loop'
export { parseAgentDecisionFromText } from './recovery/parse-agent-decision'
export {
  observeAgentContext,
  inferObserveIntent,
  syntheticReadResult,
  type ObservationRequest,
} from './context/agent-observer'
export { validateAgentToolCalls, isLoopReadTool, isSyntheticReadTool } from './loop/validate-tool-calls'

export type { QualityGate, QualityGateResult, QualityVerdict, QualityFinding } from './quality/types'
export { evaluateMidiQuality } from './quality/midi-quality-gate'
export { evaluateArrangementQuality } from './quality/arrangement-quality-gate'
export { evaluateRenderQuality } from './quality/render-quality-gate'

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

export {
  clipCoversSection,
  formatSectionGapLine,
  listSectionGaps,
  listSectionSpans,
  parseBeatsRangeFromTask,
  type SectionGap,
  type SectionSpan,
} from './plan/section-coverage'

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
  HARNESS_MAX_OUTER_LOOPS,
  createHarnessJobContextStore,
  peekHarnessJobContext,
  runHarnessUntilPlanComplete,
  stashHarnessJobContext,
} from './loop/until-plan'

export {
  inspectProduction,
  formatNextGapInstruction,
  type ProductionAuditContext,
  type ProductionAuditReport,
  type ProductionIssue,
  type ProductionListenEvidence,
  type ProductionPluginGuide,
} from './loop/production-audit'

export {
  AGENT_MODE_META,
  detectAgentMode,
  modeBlocksMutation,
  modePromptBlock,
  wantsFullProject,
  isSongRefineIntent,
  isTempoOnlyRefine,
  isProjectWipeIntent,
  isGenreRewriteIntent,
  inferBpmFromTempoIntent,
  parseExplicitBpm,
  parseExplicitTimeSignature,
  isProjectAuditIntent,
  isStyleGapIntent,
  isStyleApplyIntent,
  isMidiClipEditIntent,
  isClipSectionSplitIntent,
  hasStyleReference,
  wantsWebResearch,
  type AgentMode,
} from './agent/modes'

export {
  estimateReasoningDepth,
  parseModelIntentBrief,
  planReasoningPhases,
  phasesForDepth,
  remainingPhasesAfterNormalize,
  stripIntentBlock,
  REASONING_MAX_STEPS,
  REASONING_MIN_STEPS,
  type ModelIntentBrief,
  type ReasoningDepthPlan,
} from './agent/reasoning-depth'

export {
  REASONING_PHASE_META,
  APP_VOCAB_GLOSSARY,
  COUNCIL_VOICES,
  buildFinalTurnUserMessage,
  formatPhaseTitle,
  reasoningSeedUserMessage,
  type ReasoningPhase,
} from './agent/reasoning-prompts'

export {
  parseReadBlockFromText,
  runAbbreviatedReasoning,
  runCouncilReviewReasoning,
  runReasoningLoop,
  stripReadBlock,
  sanitizeInnerThought,
  REASONING_REPAIR_PHASES,
  REASONING_POST_APPLY_PHASES,
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
  musicBuildHintsFromUserText,
  isSoloMusicBuildPending,
  forcePreviewAplicar,
  isDestructiveAction,
  isDestructiveToolName,
  limitToOneDestructiveAction,
  limitToOneMutatingAction,
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
  isOffTopicCreatePlanReply,
} from './ask/read-context'

export { buildStyleGapReport, buildWorshipDrumEnhanceActions, worshipModernDrumExpectations, expectationsFromStyleProfileSummaries } from './ask/style-gap-report'

export {
  buildMidiClipEditActions,
  buildSplitLongClipsActions,
  actionsLackMidiNoteEdits,
} from './ask/midi-edit-actions'

export {
  getSelectedTrackId,
  getSelectedClipId,
  listMidiClips,
  resolvePianoRollClip,
  selectTrackPayload,
} from './ask/selection'
