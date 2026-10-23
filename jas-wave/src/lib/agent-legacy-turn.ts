/**
 * Programa de turno «coproductor» (A1): la orquestación que antes vivía en
 * `components/coproducer-panel.tsx` (handleSendMessage / processActionsForMode / post-turno),
 * movida tal cual al motor. Mantiene los flujos visibles actuales (tarjeta Aplicar, aclaraciones,
 * consejo) hasta que A3–A5 los sustituyan, pero TODO chat pasa por `ctx.chat` (system prompt +
 * fallback + presupuesto único) y la UI solo pinta eventos.
 *
 * Orden del turno: (1) modo + atajos locales → (2) razonamiento → (3) agent loop / single-shot con
 * herramientas de respaldo (`fallback.*`) → (4) post-turno (certify, docs, harness, revisión).
 */

import {
  agentDecisionFromToolCalls,
  createBudgetGuard,
  formatAgentBudgetStopFor,
  parseAgentDecisionFromText,
  type AgentLoopChatReply,
  type EngineAnswer,
  type EngineChatMessage,
  type EngineNeed,
  type TurnContext,
  type TurnProgram,
  type TurnProgramOutcome,
} from '@jaswave/ai-harness'
import {
  answerLocalReadQuery,
  buildReadOnlyProjectContext,
  buildMidiAuditReport,
  buildMidiAuditClarifications,
  isGarbageAssistantReply,
  isOffTopicCreatePlanReply,
  buildStyleGapReport,
  styleEnhanceProfileFromText,
  actionsLackMidiNoteEdits,
} from './ai-read-context'
import { formatAiUserError, getActiveProvider, loadAiSettings, providerReasoningPaceMs, type AiChatWithFallbackResult } from './ai-settings'
import {
  buildAgentSystemPrompt,
  stripActionsBlock,
  parseActionsFromText,
  parsePlanFromText,
  executeDawActions,
  formatActionResultsForUser,
  type ActionResult,
  type DawAction,
} from './ai-daw-agent'
import { pendingCallsToDawActions, runCoproducerAgentLoop, clearActiveAgentRun, getActiveAgentRun } from './agent-loop-bridge'
import { restoreActiveAgentRun, type PersistedAgentRun } from './agent-run-store'
import {
  forcePreviewAplicar,
  ensureMusicBuildForFullProject,
  isSoloMusicBuildPending,
  isClassifiedAction,
  isMutatingAction,
  modeBlocksMutation,
  autonomyBlocksMutation,
  logPermissionForAction,
  partitionActions,
  limitToOneMutatingAction,
  withAplicarTrue,
} from './ai-action-policy'
import { ensureWipeProjectAction } from './project-wipe'
import { buildHarnessHealthContext } from './agent-audit-bridge'
import { formatMusicalSelectionForPrompt, getMusicalSelectionAnchor } from './ai-selection-context'
import {
  assistantAskedUserToWriteOptions,
  extractGenreFromClarifyText,
  extractMinutesFromClarifyText,
  isClarificationReply,
  isGreetingOrChitchat,
  isProjectStatusQuestion,
  lastCreativeUserText,
  isMidiAuditFixReply,
  isMidiAuditSkipFixReply,
  isTrackPickClarificationReply,
  mustForceMusicBuild,
  resolveClarificationsFromAssistant,
  stripProseClarifyLists,
  type ClarificationQuestion,
} from './ai-clarify'
import {
  buildTrackPickClarifications,
  extractTrackHintFromUserText,
  extractTrackIdFromClarifyAnswer,
  formatResolvedTrackContext,
  resolveTrackHint,
} from './track-resolve'
import {
  inferBpmFromTempoIntent,
  isProjectAuditIntent,
  isSongRefineIntent,
  isStyleGapIntent,
  isStyleApplyIntent,
  isMidiClipEditIntent,
  isClipSectionSplitIntent,
  isTempoOnlyRefine,
  wantsFullProject,
  isGenreRewriteIntent,
  isProjectWipeIntent,
  workingMode,
  type AgentMode,
} from './ai-modes'
import { buildAssembledAgentContext } from './agent-context-bridge'
import { dryRunDawActions, ensureToolRegistryContext, planDawActions } from './agent-tool-bridge'
import { runPostTurnCertifyPipeline } from './agent-certify-pipeline'
import { enqueueAgentJob, planHasPendingTasks } from './agent-job-queue'
import { parseChecklistFromText, stripChecklistBlock, type AgentChecklist } from './ai-agent-checklist'
import { stashHarnessJobContext, type HarnessJobContext } from './agent-harness-job-runner'
import { appendAiDawAudit } from './ai-daw-audit-store'
import { collectCitedMessages, formatUserTurnWithCitations, historyWithCitedPins } from './ai-mentions'
import type { ProjectPlanData } from './project-plan'
import { specToProjectPlan } from './music-build'
import type { MusicBuildResult } from './music-build/types'
import { getConversation, patchMessage, updateMessageContent, type StoredChatMessage } from './ai-chat-store'
import { sanitizeAssistantMarkdown } from './assistant-markdown'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { DAWState } from '../../../shared/src/types/state'
import { applyMarkdownDocsFromModel, bindAgentDocsDisk, parseDocBlocksFromText } from './agent-docs'
import { extractDocEditsFromResults, mergeDocEdits, type ChatDocEdit } from './chat-doc-edits'
import { ensurePlanFromCompose, syncPlanAfterDawChange, type PlanEvaluation } from './agent-plan-eval'
import {
  buildHarnessReviewMessage,
  formatHarnessProgress,
  formatHarnessStopLine,
  harnessReviewNeeded,
  runHarnessFollowups,
} from './agent-harness'
import { requestOpenTool } from '../workspace/types'
import type { MidiPreviewData } from '../../components/midi-generation-preview'
import type { MidiClipMdPreviewData } from '../../components/midi-clip-md-preview'
import { listAgentToolSchemas } from './agent-tool-schemas'
import { FALLBACK_TOOLS, runFallbackTool } from './agent-fallback-tools'
import type { ApplyPendingAnswer } from './agent-engine-host'
import { iaRemotaDisponible } from './ia/transporte-ia'

export const LEGACY_PROGRAM_ID = 'coproductor-legacy'

/** Datos del turno que aporta el host (ids de mensajes del chat, citas…). */
export type LegacyTurnContext = {
  userMsgId: string
  assistantMsgId: string
  citedIds: string[]
  /** El proveedor no estaba online al enviar: se prefieren respuestas locales. */
  preferLocal: boolean
  projectId: string
}

/** Evento para que la vista relea la conversación del chat. */
export const CHAT_UPDATED = 'chat-updated'

function appendDocEdits(acc: ChatDocEdit[], results: ActionResult[]): ChatDocEdit[] {
  return mergeDocEdits(acc, extractDocEditsFromResults(results))
}

function absorbTurnMeta(
  out: ProcessActionsOutcome,
  dest: { undo?: number; diff?: string },
): void {
  if (out.undoDepthAtStart != null) dest.undo = out.undoDepthAtStart
  if (out.appliedDiffSummary) dest.diff = out.appliedDiffSummary
}

export function finishAgentTurn(
  projectId: string,
  state: DAWState,
  results: ActionResult[],
  modelText?: string,
  opts?: {
    preferModelEval?: boolean
    forcePlanMd?: boolean
    planFromModel?: ProjectPlanData | null
    planEval?: PlanEvaluation | null
  },
): { extra: string; evaluation: PlanEvaluation | null; mutated: boolean; docsWritten: string[]; docEdits: ChatDocEdit[] } {
  bindAgentDocsDisk(projectId, state.project?.ruta)

  const planHit = results.find(
    (r) =>
      (r.type === 'daw.composeProject' && (r.data as { kind?: string } | undefined)?.kind === 'projectPlan') ||
      (r.type === 'daw.musicBuild' && (r.data as { kind?: string } | undefined)?.kind === 'musicBuild'),
  )
  if (planHit?.data) {
    const data = planHit.data as { kind?: string }
    if (data.kind === 'musicBuild') {
      const build = data as MusicBuildResult
      ensurePlanFromCompose(projectId, specToProjectPlan(build.spec, build.applied), {
        force: opts?.forcePlanMd,
      })
    } else {
      ensurePlanFromCompose(projectId, planHit.data as import('./project-plan').ProjectPlanData, {
        force: opts?.forcePlanMd,
      })
    }
  } else if (opts?.planFromModel) {
    ensurePlanFromCompose(projectId, opts.planFromModel, { force: true })
  }

  const skipSync = new Set(['doc.list', 'doc.read', 'doc.evaluate', 'doc.write', 'doc.create', 'doc.append'])
  const musicBuildPlanned = results.some((r) => {
    if (r.type !== 'daw.musicBuild') return false
    const d = r.data as MusicBuildResult | undefined
    return d?.kind === 'musicBuild' && !d.applied
  })
  const mutated = results.some((r) => r.success && !skipSync.has(r.type))
  let extra = ''
  let evaluation: PlanEvaluation | null = null
  let docsWritten: string[] = []
  let docEdits: ChatDocEdit[] = []
  const applyDocs = () => {
    const applied = modelText ? applyMarkdownDocsFromModel(projectId, modelText) : { slugs: [], edits: [] }
    docsWritten = applied.slugs
    docEdits = applied.edits
    if (docsWritten.length && !musicBuildPlanned) {
      extra = [extra, `Docs actualizados: ${docsWritten.join(', ')}`].filter(Boolean).join('\n')
    }
    return docsWritten
  }
  applyDocs()
  // Si el modelo no mandó <<<DOC>>> pero sí <<<PLAN>>>, forzar plan.md
  if (
    opts?.forcePlanMd &&
    opts.planFromModel &&
    !docsWritten.includes('plan.md') &&
    !parseDocBlocksFromText(modelText || '').some((b) => b.slug === 'plan.md')
  ) {
    ensurePlanFromCompose(projectId, opts.planFromModel, { force: true })
    docsWritten = [...docsWritten, 'plan.md']
    extra = [extra, 'Docs actualizados: plan.md (desde <<<PLAN>>>)'].filter(Boolean).join('\n')
  }
  evaluation = opts?.planEval ?? syncPlanAfterDawChange(projectId, state)
  if (evaluation?.summary && !musicBuildPlanned && mutated) {
    extra = [extra, evaluation.summary].filter(Boolean).join('\n')
  }

  if (extra || planHit || docsWritten.length || opts?.planFromModel) {
    requestOpenTool('docs', { zone: 'left' })
  }
  return { extra, evaluation, mutated, docsWritten, docEdits }
}

/** Líneas visibles del realce de estilo según el perfil derivado del pedido. */
function describeStyleEnhanceProfile(p: ReturnType<typeof styleEnhanceProfileFromText>): string[] {
  const out: string[] = []
  if (p.ghostNotes) out.push('- Ghost notes suaves en la caja')
  if (p.openHats) out.push('- Hats abiertos en tramos de “coro”')
  if (p.crashFills) out.push(`- Fills + crashes cada ${p.phraseBars ?? 8} compases`)
  if (p.humanize) out.push('- Humanize leve del timing/velocidad')
  return out.length ? out : ['- Ajustes de groove en el clip de batería']
}

function pickMusicBuild(results: ActionResult[]): MusicBuildResult | undefined {
  const hit = results.find(
    (r) => r.type === 'daw.musicBuild' && (r.data as { kind?: string } | undefined)?.kind === 'musicBuild',
  )
  return hit?.data as MusicBuildResult | undefined
}

type ProcessActionsOutcome = {
  results: ActionResult[]
  pendingActions?: StoredChatMessage['pendingActions']
  confirmActions?: StoredChatMessage['confirmActions']
  ranMutations: boolean
  undoDepthAtStart?: number
  appliedDiffSummary?: string
}

function resultsOrPending(out: ProcessActionsOutcome): ActionResult[] {
  if (out.results.length) return out.results
  const pending = out.pendingActions?.actions ?? []
  if (pending.length) {
    return pending.map((a) => ({
      type: a.type,
      success: true,
      message: `Propuesto: ${a.type} (Construir para aplicar)`,
    }))
  }
  const confirm = out.confirmActions?.actions ?? []
  return confirm.map((a) => ({
    type: a.type,
    success: true,
    message: `Pendiente de confirmación: ${a.type}`,
  }))
}

/** Gate: mutaciones siempre van a propuesta (Aplicar) salvo READ_ONLY vacío. */
export async function processActionsForMode(opts: {
  tienda: TiendaDAW
  actions: DawAction[]
  resolvedMode: AgentMode
  userText: string
  conversationId: string
  messageId: string
  source: 'model_actions' | 'fallback'
}): Promise<ProcessActionsOutcome> {
  const { tienda, resolvedMode, userText, conversationId, messageId, source } = opts
  let rawActions = opts.actions
  if (isProjectWipeIntent(userText) && !isGenreRewriteIntent(userText)) {
    rawActions = ensureWipeProjectAction(rawActions, userText, true)
  }
  const actions = forcePreviewAplicar(rawActions, resolvedMode)
  const ctx = { conversationId, messageId, agentMode: resolvedMode, source }

  for (const a of actions) {
    logPermissionForAction(a, 'ai')
    appendAiDawAudit({
      ...ctx,
      tool: a.type,
      params: { ...(a.payload ?? {}) },
      status: 'proposed',
    })
  }

  // Confirm-before-apply: plan/think/ask O create — mutaciones → pending + diff (como Cursor).
  const proposeFirst =
    modeBlocksMutation(resolvedMode) ||
    autonomyBlocksMutation() ||
    resolvedMode === 'create' ||
    resolvedMode === 'auto'

  // Fail closed: acciones sin clase de riesgo no se proponen ni ejecutan.
  const blockedResults: ActionResult[] = []
  for (const a of actions.filter((x) => !isClassifiedAction(x))) {
    const message = `Bloqueada: ${a.type} no tiene clase de riesgo conocida`
    appendAiDawAudit({ ...ctx, tool: a.type, params: { ...(a.payload ?? {}) }, status: 'rejected', result: { success: false, message } })
    blockedResults.push({ type: a.type, success: false, message })
  }

  if (proposeFirst) {
    const classified = actions.filter((a) => isClassifiedAction(a))
    const readonly = classified.filter((a) => !isMutatingAction(a))
    const pending = classified.filter(isMutatingAction)
    let results: ActionResult[] = [...blockedResults]
    if (readonly.length) {
      results = [
        ...results,
        ...(await executeDawActions(tienda, readonly, {
          agentMode: resolvedMode,
          forceApply: false,
          source,
          conversationId,
          messageId,
        })),
      ]
    }
    let previewDiff: import('../../../shared/src/state/diff-estado').SemanticStateDiff | undefined
    let previewSummary = ''
    const { kept: pendingKept, deferred: pendingDeferred } = limitToOneMutatingAction(pending)
    if (pendingKept.length) {
      ensureToolRegistryContext(tienda)
      const preview = await dryRunDawActions(tienda, pendingKept)
      previewDiff = preview.diff
      previewSummary =
        pendingDeferred.length > 0
          ? `${preview.summary || 'preview'} · 1 de ${pending.length} (resto uno a uno)`
          : preview.summary
      appendAiDawAudit({
        ...ctx,
        tool: 'planner.preview',
        params: { summary: previewSummary, pending: pendingKept.length, deferred: pendingDeferred.length },
        status: preview.ok ? 'executed' : 'failed',
        result: { success: preview.ok, message: previewSummary || 'preview' },
      })
      const { publishMidiProposalFromActions } = await import('./ai-midi-proposal-store')
      publishMidiProposalFromActions(pendingKept, { messageId })
    }
    for (const a of pendingKept) {
      appendAiDawAudit({
        ...ctx,
        tool: a.type,
        params: { ...(a.payload ?? {}) },
        status: 'proposed',
        result: { success: true, message: 'Pendiente de Aplicar' },
      })
    }
    for (const a of pendingDeferred) {
      appendAiDawAudit({
        ...ctx,
        tool: a.type,
        params: { ...(a.payload ?? {}) },
        status: 'skipped_by_mode',
        result: {
          success: true,
          message: 'Diferido: solo 1 mutación por paso (valida y continúa)',
        },
      })
    }
    const actionStatuses: Record<string, 'pending' | 'accepted' | 'rejected'> = {}
    pendingKept.forEach((_, i) => {
      actionStatuses[String(i)] = 'pending'
    })
    return {
      results,
      pendingActions:
        pendingKept.length > 0
          ? {
              status: 'pending',
              actions: pendingKept,
              agentMode: resolvedMode,
              previewDiff,
              previewSummary: previewSummary || undefined,
              actionStatuses,
            }
          : undefined,
      ranMutations: false,
    }
  }

  // blocked (sin clase) ya quedó registrado arriba en blockedResults.
  const { readonly, mutating, destructive } = partitionActions(actions, userText)
  let appliedDiffSummary: string | undefined
  let undoDepthAtStart: number | undefined
  if (mutating.length) {
    ensureToolRegistryContext(tienda)
    const preview = await dryRunDawActions(tienda, mutating)
    appliedDiffSummary = preview.summary || undefined
    const plan = planDawActions(mutating, preview.diff)
    appendAiDawAudit({
      ...ctx,
      tool: 'planner.preview',
      params: { summary: plan.summary, risk: plan.estimatedRisk },
      status: preview.ok ? 'executed' : 'failed',
      result: { success: preview.ok, message: preview.summary },
    })
  }
  const toRun = [...readonly, ...mutating]
  let results: ActionResult[] = [...blockedResults]
  if (toRun.length) {
    const { snapshotUndoDepth } = await import('./agent-turn-undo')
    undoDepthAtStart = snapshotUndoDepth(tienda)
    results = [
      ...results,
      ...(await executeDawActions(tienda, toRun, {
        agentMode: resolvedMode,
        forceApply: false,
        source,
        conversationId,
        messageId,
      })),
    ]
  }
  if (destructive.length) {
    const { kept, deferred } = limitToOneMutatingAction(destructive)
    for (const a of kept) {
      appendAiDawAudit({
        ...ctx,
        tool: a.type,
        params: { ...(a.payload ?? {}) },
        status: 'pending_confirm',
        result: { success: false, message: 'Esperando confirmación del usuario' },
      })
    }
    for (const a of deferred) {
      appendAiDawAudit({
        ...ctx,
        tool: a.type,
        params: { ...(a.payload ?? {}) },
        status: 'skipped_by_mode',
        result: {
          success: true,
          message: 'Diferido: solo 1 borrado por paso (continúa tras Aplicar)',
        },
      })
    }
    return {
      results,
      confirmActions:
        kept.length > 0
          ? {
              status: 'pending',
              actions: kept,
              reason:
                deferred.length > 0
                  ? `1 paso ahora (${deferred.length} más después, uno a uno). ¿Confirmas?`
                  : 'Esta acción borra o altera contenido de forma irreversible. ¿Confirmas?',
            }
          : undefined,
      pendingActions: undefined,
      ranMutations: results.some((r) => r.success && isMutatingAction({ type: r.type })),
      undoDepthAtStart,
      appliedDiffSummary,
    }
  }
  return {
    results,
    confirmActions: undefined,
    ranMutations: results.some((r) => r.success && isMutatingAction({ type: r.type })),
    undoDepthAtStart,
    appliedDiffSummary,
  }
}

/** Shims de la antigua vista: el código movido sigue igual pero emite eventos del motor. */
function viewShims(ctx: TurnContext) {
  const provider: { status?: 'online' | 'offline' | 'misconfigured'; detail?: string } = {}
  const emitProvider = () => {
    if (provider.status) ctx.emit({ type: 'provider', status: provider.status, detail: provider.detail || undefined })
  }
  return {
    setHarnessPhase: (label: string) => ctx.phase(label),
    setAiStatus: (s: 'online' | 'offline' | 'misconfigured') => {
      provider.status = s
      emitProvider()
    },
    setStatusDetail: (d: string) => {
      provider.detail = d
      emitProvider()
    },
    touch: () => ctx.emit({ type: 'agent.message', role: ctx.run.role, text: '', data: { kind: CHAT_UPDATED } }),
  }
}

/** Respuesta del chat del motor con la forma que espera el código movido. */
function asFallbackResult(r: Awaited<ReturnType<TurnContext['chat']>>): AiChatWithFallbackResult {
  return {
    success: r.success,
    content: r.content,
    error: r.budgetMessage ?? r.error,
    errorCode: r.budgetStop ? 'unknown' : (r.errorCode as AiChatWithFallbackResult['errorCode']),
    hint: r.hint,
    provider: r.provider,
    usedProviderId: r.usedProviderId,
    usedModel: r.usedModel,
    fallbackUsed: r.fallbackUsed,
  }
}

function legacyRunData(): Record<string, unknown> {
  const run = getActiveAgentRun()
  return { legacyAgentRun: run ? { ...run } : null }
}

function hydrateLegacyRun(ctx: TurnContext): void {
  const saved = ctx.run.data?.legacyAgentRun as PersistedAgentRun | null | undefined
  if (!getActiveAgentRun() && saved?.runId) restoreActiveAgentRun(saved)
}

async function runCoproducerTurn(ctx: TurnContext, tienda: TiendaDAW): Promise<TurnProgramOutcome> {
  const dawStore = tienda
  const lc = (ctx.input.context ?? {}) as Partial<LegacyTurnContext>
  const conversation = { id: ctx.run.conversationId }
  const userMsgId = lc.userMsgId ?? ''
  const assistantMsgId = lc.assistantMsgId ?? ctx.run.messageId ?? ''
  const projectId = lc.projectId ?? (dawStore.obtenerEstado().project?.id || 'default')
  const refreshed = getConversation(conversation.id)
  const messages = (refreshed?.messages ?? []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && m.id !== userMsgId && m.id !== assistantMsgId,
  )
  const userText = ctx.run.userText
  const workText = lastCreativeUserText(messages, userText)
  const cited = collectCitedMessages(userText, lc.citedIds ?? [], dawStore.obtenerEstado(), messages)
  const agentMode = ctx.run.mode as AgentMode
  const ac = { signal: ctx.signal }
  // Presupuesto único del turno: el motor carga cada intento HTTP; las capas solo consultan.
  const turnBudget = createBudgetGuard(ctx.budget)
  const stillMine = () => !ctx.signal.aborted
  const { setHarnessPhase, setAiStatus, setStatusDetail, touch } = viewShims(ctx)
  const setConversation = (_c: unknown) => touch()
  const refreshHistoryList = () => touch()
  const aiStatus = lc.preferLocal ? 'offline' : 'online'

  try {
      const state = dawStore.obtenerEstado()
      bindAgentDocsDisk(projectId, state.project?.ruta)
      // Consultas locales muy cortas solo si el proveedor no está online
      const preferLocal = aiStatus !== 'online' || !iaRemotaDisponible()
      const local = preferLocal ? answerLocalReadQuery(state, userText) : null
      let accumulated = local ?? ''
      let actionsSummary = ''
      let lastResults: ActionResult[] = []
      let modelRaw = ''
      let pendingActions: StoredChatMessage['pendingActions']
      let confirmActions: StoredChatMessage['confirmActions']
      let clarifications: StoredChatMessage['clarifications']
      let agentChecklist: AgentChecklist | undefined
      let ranMutations = false
      let parsedPlanForDocs: ProjectPlanData | null = null
      let finalReasoningSteps: StoredChatMessage['reasoningSteps']
      let docEdits: ChatDocEdit[] = []
      let turnCertify: StoredChatMessage['certify']
      const turnMeta: { undo?: number; diff?: string } = {}
      let skipAiTurn = false
      let trackContextExtra = ''
      const resolvedMode = workingMode(agentMode, workText)
      const styleGapIntent = isStyleGapIntent(workText)
      const styleApplyIntent = isStyleApplyIntent(workText)
      const midiClipEditIntent = isMidiClipEditIntent(workText)
      const clipSectionSplitIntent = isClipSectionSplitIntent(workText)
      const auditIntent = isProjectAuditIntent(workText) || styleGapIntent
      const midiAuditReport =
        isProjectAuditIntent(userText) && !styleGapIntent && !styleApplyIntent
          ? buildMidiAuditReport(state)
          : ''
      const styleGapSeed = styleGapIntent
        ? buildStyleGapReport(state, { userText })
        : ''
      // Realce de estilo genérico: rasgos derivados del pedido del usuario (sin género por defecto).
      const styleEnhanceFallback = styleApplyIntent
        ? await runFallbackTool(ctx, FALLBACK_TOOLS.styleEnhance, { text: workText })
        : []
      const midiClipEditFallback =
        midiClipEditIntent || styleApplyIntent
          ? await runFallbackTool(ctx, FALLBACK_TOOLS.midiClipEdit, { text: workText })
          : []
      const sectionSplitFallback = clipSectionSplitIntent
        ? await runFallbackTool(ctx, FALLBACK_TOOLS.sectionSplit)
        : []
      const wantsAuditFix =
        isMidiAuditFixReply(userText) ||
        (/^arr[eé]glalo\b/i.test(userText.trim()) && !auditIntent)

      if (isGreetingOrChitchat(userText)) {
        accumulated = 'Hola. Dime qué quieres crear o cambiar: pista, MIDI, tempo…'
        skipAiTurn = true
      } else if (isProjectStatusQuestion(userText)) {
        accumulated =
          answerLocalReadQuery(state, userText) ||
          buildReadOnlyProjectContext(state)
        skipAiTurn = true
      }

      if (isTrackPickClarificationReply(userText)) {
        const trackId = extractTrackIdFromClarifyAnswer(userText)
        if (trackId) trackContextExtra = formatResolvedTrackContext(state, trackId)
      } else if (
        !isClarificationReply(userText) &&
        !auditIntent &&
        !wantsAuditFix &&
        !isMidiAuditSkipFixReply(userText)
      ) {
        const hint = extractTrackHintFromUserText(userText)
        if (hint) {
          const resolved = resolveTrackHint(state, hint)
          if (resolved.ambiguous && resolved.candidates.length >= 2) {
            clarifications = {
              status: 'pending',
              questions: buildTrackPickClarifications(resolved.candidates, hint.label),
            }
            accumulated = `Hay varias pistas que podrían ser «${hint.label}». Elige cuál quieres que use para esta edición:`
            skipAiTurn = true
          } else if (resolved.trackId) {
            trackContextExtra = formatResolvedTrackContext(state, resolved.trackId)
          }
        }
      }

      // Respuesta al formulario de auditoría / «arréglalo» → propuesta Aplicar (sin musicBuild)
      if (wantsAuditFix && !isMidiAuditSkipFixReply(userText)) {
        const fixes = await runFallbackTool(ctx, FALLBACK_TOOLS.midiAuditFix)
        if (fixes.length) {
          setHarnessPhase('Preparando arreglo de duplicados…')
          const out = await processActionsForMode({
            tienda: dawStore,
            actions: fixes,
            resolvedMode: 'create',
            userText,
            conversationId: conversation.id,
            messageId: assistantMsgId,
            source: 'fallback',
          })
          pendingActions = out.pendingActions
          confirmActions = out.confirmActions
          lastResults = out.results
          absorbTurnMeta(out, turnMeta)
          actionsSummary = formatActionResultsForUser(resultsOrPending(out))
          accumulated = [
            `Listo: **${fixes.length}** acción(es) para quitar duplicados.`,
            'Revisa la tarjeta abajo: aplica cada cambio por separado o pulsa **Todas**.',
          ].join('\n')
        } else {
          accumulated = 'No hay clips con duplicados detectados para arreglar ahora.'
        }
      } else if (isMidiAuditSkipFixReply(userText)) {
        accumulated = 'De acuerdo — dejo el proyecto como está. El informe anterior sigue válido.'
      } else if (!local && !skipAiTurn) {
        if (!iaRemotaDisponible()) {
          // Sin modelo remoto (ni Electron ni backend): si pide crear, ejecutamos igual en el DAW local
          const forced = await runFallbackTool(ctx, FALLBACK_TOOLS.userIntent, { text: workText, mode: agentMode })
          if (forced.length) {
            const out = await processActionsForMode({
              tienda: dawStore,
              actions: forced,
              resolvedMode,
              userText,
              conversationId: conversation.id,
              messageId: assistantMsgId,
              source: 'fallback',
            })
            lastResults = out.results
            docEdits = appendDocEdits(docEdits, out.results)
            pendingActions = out.pendingActions
            confirmActions = out.confirmActions
            ranMutations = out.ranMutations
            absorbTurnMeta(out, turnMeta)
            actionsSummary = formatActionResultsForUser(resultsOrPending(out))
            accumulated = [
              modeBlocksMutation(resolvedMode)
                ? 'Propuesta lista — pulsa Construir para aplicar (sin modelo remoto).'
                : 'He aplicado los cambios directamente en JasWave (sin modelo remoto).',
              actionsSummary,
            ].join('\n\n')
          } else {
            accumulated =
              midiAuditReport ||
              answerLocalReadQuery(state, userText) ||
              formatAiUserError({
                error: 'No hay modelo remoto disponible.',
                errorCode: 'not_available',
                hint: 'Abre Electron o configura un proveedor en Ajustes → IA.',
                provider: getActiveProvider().kind,
              })
          }
        } else {
          const { formatLibraryPresetsForContext } = await import('./library/ops')
          const presetsBlock = await formatLibraryPresetsForContext(dawStore, 12)
          const chatTurns = messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

          setHarnessPhase('Razonando…')
          const { runAgentReasoningForTurn } = await import('./agent-reasoning-bridge')
          let cfg = loadAiSettings()
          let provider = getActiveProvider(cfg)

          // El host recuerda el modelo que respondió tras un fallback (rememberWorkingModel).

          const reasoning = await runAgentReasoningForTurn({
            tienda: dawStore,
            budget: turnBudget,
            state,
            userText,
            resolvedMode,
            chatTurns,
            libraryPresetsBlock: presetsBlock,
            projectContextExtra: (() => {
              const parts: string[] = []
              if (styleGapSeed) {
                parts.push(
                  [
                    '## Borrador local de gap de estilo (datos del DAW — ancla)',
                    styleGapSeed,
                    'Úsalo como base. Mejora con web.search si hace falta. Responde al usuario en este tono de productor (NO Auditoría MIDI P1/P2, NO «244.0b»).',
                    'PROHIBIDO musicBuild y plan de días.',
                  ].join('\n'),
                )
              } else if (midiAuditReport) {
                parts.push(
                  [
                    '## Informe técnico local (datos reales del DAW — ancla obligatoria)',
                    midiAuditReport,
                    'Razona como productor sobre ESTOS hallazgos. No inventes clips ni ignores duplicados/largos.',
                    'En el turno final: explica en prosa + prioriza; no respondas solo con ¡¡¡.',
                  ].join('\n'),
                )
              }
              if (trackContextExtra) parts.push(trackContextExtra)
              return parts.length ? parts.join('\n\n') : undefined
            })(),
            abort: ac.signal,
            paceBetweenPhasesMs: providerReasoningPaceMs(provider.kind),
            onPhaseLabel: (label) => setHarnessPhase(label),
            onStep: (steps) => {
              patchMessage(conversation.id, assistantMsgId, {
                reasoningSteps: steps.map((s) => ({ ...s, collapsed: false })),
              })
              const after = getConversation(conversation.id)
              if (after) setConversation(after)
            },
            chatFn: async (reasonMessages) => {
              if (!stillMine()) return { success: false }
              cfg = loadAiSettings()
              const r = await ctx.chat({
                purpose: 'reasoning',
                messages: reasonMessages as EngineChatMessage[],
                temperature: Math.min(0.9, Math.max(cfg.temperature, 0.55)),
                maxTokens: Math.max(cfg.maxTokens, 16384),
                skipPlan: true,
              })
              if (!stillMine()) return { success: false }
              return { success: Boolean(r.success), content: r.content }
            },
          })
          if (!stillMine()) throw new DOMException('Aborted', 'AbortError')
          finalReasoningSteps = reasoning.steps.map((s) => ({ ...s, collapsed: true }))

          const systemContext = [
            buildAssembledAgentContext(dawStore, state, userText, chatTurns, presetsBlock),
            formatMusicalSelectionForPrompt(getMusicalSelectionAnchor()),
            buildAgentSystemPrompt(state, userText, agentMode, messages),
            styleGapSeed
              ? [
                  '## Gap de estilo (borrador local con datos reales)',
                  styleGapSeed,
                  'Responde al usuario en español claro de productor DAW. Mejora este borrador; no lo sustituyas por «Auditoría MIDI» ni códigos P1/P2.',
                ].join('\n')
              : midiAuditReport
                ? [
                    '## Informe técnico local (datos reales)',
                    midiAuditReport,
                    'Responde al usuario como productor usando estos datos. Si propones ACTIONS, que sean propuestas para Aplicar.',
                  ].join('\n')
                : '',
            trackContextExtra,
          ]
            .filter(Boolean)
            .join('\n\n')
          const think = resolvedMode === 'think' || resolvedMode === 'ask'
          const modelUser = formatUserTurnWithCitations(reasoning.finalUserMessage, cited)
          const prior = historyWithCitedPins(refreshed?.messages ?? messages, cited, [
            assistantMsgId,
            userMsgId,
          ])

          try {
            if (!stillMine()) throw new DOMException('Aborted', 'AbortError')
            cfg = loadAiSettings()
            provider = getActiveProvider(cfg)
            setHarnessPhase(`Consultando ${provider.name} · ${provider.selectedModel}…`)
            // Chat único del motor: system prompt + fallback + presupuesto; tools nativas en el loop (A2).
            const finalChat = async (userContent: string, opts: { tools?: boolean; stream?: boolean } = {}) =>
              ctx.chat({
                purpose: opts.tools ? 'agent' : 'final',
                system: systemContext,
                messages: [...(prior as EngineChatMessage[]), { role: 'user', content: userContent }],
                temperature: think ? Math.max(cfg.temperature, 0.55) : cfg.temperature,
                maxTokens: Math.max(cfg.maxTokens, think ? 16384 : 8192),
                ...(opts.tools ? { tools: nativeLoopTools(ctx) } : {}),
                ...(opts.stream
                  ? { onDelta: (text: string) => ctx.emit({ type: 'agent.delta', role: ctx.run.role, text }) }
                  : {}),
              })
            const runFinalChat = async (userContent: string): Promise<AiChatWithFallbackResult> =>
              asFallbackResult(await finalChat(userContent, { stream: true }))

            let result: AiChatWithFallbackResult
            let agentLoopHandled = false
            const useAgentLoop = !think && (resolvedMode === 'create' || resolvedMode === 'auto')
            if (useAgentLoop) {
              setHarnessPhase('Agent Loop…')
              const loopOut = await runCoproducerAgentLoop({
                tienda: dawStore,
                budget: turnBudget,
                userText: workText,
                abort: ac.signal,
                agentMode: resolvedMode,
                conversationId: conversation.id,
                messageId: assistantMsgId,
                priorBrief: [reasoning.decisionBrief, reasoning.canonicalPrompt]
                  .filter(Boolean)
                  .join('\n\n')
                  .slice(0, 3500),
                chat: async (body) => toLoopReply(await finalChat(body, { tools: true })),
              })
              if (loopOut.status === 'cancelled') throw new DOMException('Aborted', 'AbortError')
              if (loopOut.status === 'waiting-for-user') {
                agentLoopHandled = true
                const q = JSON.stringify(loopOut.summary || '¿Cómo seguimos?')
                const clarifyRaw = `<<<CLARIFY[{"id":"loop","question":${q},"options":["Continuar","Otra idea","Cancelar"],"allowCustom":true}]CLARIFY>>>`
                clarifications = {
                  status: 'pending',
                  questions: resolveClarificationsFromAssistant(clarifyRaw),
                }
                result = { success: true, content: loopOut.summary || '¿Cómo seguimos?' }
                accumulated = loopOut.summary || '¿Cómo seguimos?'
              } else if (loopOut.status === 'waiting-for-confirmation' || loopOut.pendingCalls?.length) {
                agentLoopHandled = true
                let pending = pendingCallsToDawActions(loopOut)

                // Wipe puro: sustituir deletes rotos por daw.wipeProject (IDs reales al Aplicar).
                if (isProjectWipeIntent(userText) && !isGenreRewriteIntent(userText)) {
                  pending = ensureWipeProjectAction(pending, userText, true)
                }

                // Canción completa: forzar musicBuild con hints (bpm/género/minutos) + midi procedural.
                if (wantsFullProject(userText) || isGenreRewriteIntent(userText)) {
                  if (
                    !pending.some((a) => a.type === 'daw.musicBuild' || a.type === 'daw.composeProject')
                  ) {
                    const emptyish = pending.filter((a) => {
                      const p = a.payload ?? {}
                      if (a.type === 'project.setBpm') {
                        const bpm = Number(p.bpm ?? p.valor ?? p.tempo)
                        return !Number.isFinite(bpm)
                      }
                      if (a.type === 'clip.delete') {
                        return !String(p.pistaId ?? p.trackId ?? '').trim() || !String(p.clipId ?? '').trim()
                      }
                      if (a.type === 'midi.clip.create') {
                        const n = p.notas ?? p.notes
                        return !Array.isArray(n) || n.length === 0
                      }
                      if (a.type === 'track.toggleMute' || a.type === 'track.update') {
                        return !String(p.trackId ?? p.pistaId ?? '').trim()
                      }
                      return false
                    })
                    const microOnly = pending.every((a) =>
                      /^(clip\.delete|track\.(toggleMute|update)|project\.setBpm|midi\.clip\.create)$/.test(a.type),
                    )
                    if (pending.length === 0 || (microOnly && emptyish.length >= Math.ceil(pending.length * 0.5))) {
                      pending = ensureMusicBuildForFullProject(pending, userText, { aplicar: true })
                    }
                  } else {
                    pending = ensureMusicBuildForFullProject(pending, userText, { aplicar: true })
                  }
                }

                // Canción completa + solo musicBuild: AUTO-APLICAR (no dejar al usuario colgado en "Confirma 1 paso").
                const autoBuild =
                  (wantsFullProject(userText) || isGenreRewriteIntent(userText)) &&
                  isSoloMusicBuildPending(pending)

                if (autoBuild) {
                  setHarnessPhase('Music Build: creando canción…')
                  const buildActions = withAplicarTrue(pending)
                  for (const a of buildActions) {
                    appendAiDawAudit({
                      conversationId: conversation.id,
                      messageId: assistantMsgId,
                      agentMode: 'create',
                      source: 'model_actions',
                      tool: a.type,
                      params: { ...(a.payload ?? {}) },
                      status: 'proposed',
                    })
                  }
                  lastResults = await executeDawActions(dawStore, buildActions, {
                    agentMode: 'create',
                    forceApply: true,
                    source: 'model_actions',
                    conversationId: conversation.id,
                    messageId: assistantMsgId,
                    respectModeGate: false,
                  })
                  ranMutations = lastResults.some((r) => r.success)
                  actionsSummary = formatActionResultsForUser(lastResults)
                  clearActiveAgentRun()
                  const stAfter = dawStore.obtenerEstado()
                  const tracksN = stAfter.project?.tracks?.length ?? 0
                  const clipsN =
                    stAfter.project?.tracks?.reduce(
                      (n, t) => n + ((t as { clips?: unknown[] }).clips?.length ?? 0),
                      0,
                    ) ?? 0
                  if (ranMutations && tracksN > 0) {
                    // A5: resumen con evidencia; NO pregunta «¿te gustó?» (el usuario pide ajustes si quiere).
                    accumulated =
                      clipsN > 0
                        ? `Kael (QA): Revisé el arrangement — ${tracksN} pistas, ${clipsN} clips. Si quieres ajustes, dime qué cambiar.`
                        : `Kael (QA): Estructura lista (${tracksN} pistas).`
                    result = { success: true, content: accumulated }
                  } else {
                    pendingActions = undefined
                    accumulated =
                      actionsSummary ||
                      'Music Build no aplicó cambios. Revisa el Terminal e inténtalo de nuevo.'
                    result = { success: true, content: accumulated }
                  }
                } else {
                  // Preservar AgentRun; proponer tarjeta Aplicar.
                  const out = await processActionsForMode({
                    tienda: dawStore,
                    actions: pending,
                    resolvedMode: 'create',
                    userText,
                    conversationId: conversation.id,
                    messageId: assistantMsgId,
                    source: 'model_actions',
                  })
                  lastResults = out.results
                  pendingActions = out.pendingActions
                  confirmActions = out.confirmActions
                  ranMutations = out.ranMutations
                  absorbTurnMeta(out, turnMeta)
                  actionsSummary = formatActionResultsForUser(resultsOrPending(out))
                  accumulated =
                    loopOut.summary ||
                    'Propuesta lista. Revisa el diff y pulsa Aplicar — el Agent Loop continuará después.'
                  result = { success: true, content: accumulated }
                }
              } else if (loopOut.status === 'completed') {
                agentLoopHandled = true
                result = { success: true, content: loopOut.summary || 'Hecho.' }
                accumulated = loopOut.summary || 'Hecho.'
              } else {
                result = {
                  success: false,
                  error: loopOut.summary || 'Agent Loop sin decisión',
                  errorCode: 'unknown',
                }
              }
            } else {
              result = await runFinalChat(modelUser)
            }
            if (!stillMine()) throw new DOMException('Aborted', 'AbortError')
            if ('fallbackUsed' in result) {
              if (result.fallbackUsed && result.usedModel) {
                setHarnessPhase(`Respondió con ${result.usedModel}`)
              }
            }

            if (agentLoopHandled && result.success) {
              // Ya resolvimos pending/complete/clarify; no reinyectar musicBuild ni heurísticas.
              setAiStatus('online')
              setStatusDetail('')
            } else if (result.success && result.content?.trim()) {
              const raw = result.content
              modelRaw = raw
              let actions = parseActionsFromText(raw).filter(
                (a) => typeof a.type === 'string' && /^[a-z0-9]+(\.[a-z0-9]+)+$/i.test(a.type),
              )
              let clarifyQs = resolveClarificationsFromAssistant(raw)
              // Modelo pidió opciones en prosa (sin bloque CLARIFY válido) → fallo de protocolo
              if (assistantAskedUserToWriteOptions(raw) && clarifyQs.length === 0) {
                clarifyQs = []
              }
              const skipClarify =
                mustForceMusicBuild(userText) ||
                (isSongRefineIntent(workText) && !isTempoOnlyRefine(workText)) ||
                assistantAskedUserToWriteOptions(raw) ||
                messages.some(
                  (m) =>
                    m.clarifications?.status === 'answered' ||
                    m.clarifications?.status === 'skipped',
                )
              const forceFullSong =
                isClarificationReply(userText) ||
                (skipClarify && wantsFullProject(workText))
              const forceBuild = skipClarify
              // Tras respuestas / créalo / refinar / ya aclarado: NUNCA otra ronda de preguntas
              if (skipClarify) clarifyQs = []

              const parsedPlan = parsePlanFromText(raw)
              if (parsedPlan) parsedPlanForDocs = parsedPlan
              if (parsedPlan && !actions.some((a) => a.type === 'daw.composeProject' || a.type === 'daw.musicBuild')) {
                if (wantsFullProject(workText) || forceFullSong) {
                  const bpmHint =
                    inferBpmFromTempoIntent(workText, state.project?.bpm?.valor ?? 120) ??
                    parsedPlan.bpm
                  actions = [
                    {
                      type: 'daw.musicBuild',
                      payload: {
                        aplicar: true,
                        prompt: workText,
                        nombre: parsedPlan.nombre,
                        bpm: bpmHint,
                        minutos: parsedPlan.minutes,
                        midiSource: 'ai',
                      },
                    },
                    ...actions,
                  ]
                } else {
                  actions = [
                    {
                      type: 'daw.composeProject',
                      payload: {
                        aplicar: resolvedMode === 'create',
                        nombre: parsedPlan.nombre,
                        bpm: parsedPlan.bpm,
                        tonalidad: parsedPlan.keyLabel,
                        minutos: parsedPlan.minutes,
                        pensamiento: parsedPlan.pensamiento,
                        pistas: parsedPlan.tracks,
                      },
                    },
                    ...actions,
                  ]
                }
              }
              if (actions.length === 0 && clarifyQs.length === 0) {
                actions = await runFallbackTool(ctx, FALLBACK_TOOLS.userIntent, { text: workText, mode: skipClarify ? 'create' : agentMode })
              }
              if (actions.length === 0 && forceFullSong) {
                const mins = extractMinutesFromClarifyText(userText)
                const genero = extractGenreFromClarifyText(userText)
                const bpm =
                  inferBpmFromTempoIntent(userText, state.project?.bpm?.valor ?? 120) ?? 72
                actions = [
                  {
                    type: 'project.setBpm',
                    payload: { bpm },
                  },
                  {
                    type: 'daw.musicBuild',
                    payload: {
                      aplicar: true,
                      prompt: isClarificationReply(userText)
                        ? `Canción según plan.md y respuestas: ${userText.slice(0, 1200)}`
                        : userText,
                      minutos: mins ?? 3,
                      ...(genero ? { genero } : {}),
                      midiSource: 'ai',
                      bpm,
                    },
                  },
                ]
              }
              if (
                actions.length === 0 &&
                clarifyQs.length > 0 &&
                (wantsFullProject(workText) || resolvedMode === 'create') &&
                !forceBuild
              ) {
                // Una sola ronda de tarjeta; esperar Enviar respuestas
              } else if (actions.length === 0 && clarifyQs.length === 0 && wantsFullProject(workText)) {
                actions = await runFallbackTool(ctx, FALLBACK_TOOLS.userIntent, { text: workText, mode: 'create' })
              }
              // Aplicar estilo → parche de batería si el modelo no emitió ACTIONS útiles
              if (
                styleApplyIntent &&
                styleEnhanceFallback.length > 0 &&
                !actions.some((a) =>
                  /^(midi\.notes\.(set|patch)|midi\.humanize|midi\.clip\.md\.apply)$/i.test(a.type),
                )
              ) {
                actions = [...styleEnhanceFallback, ...actions]
                clarifyQs = []
              }
              // Suavizar / intro / toms / pads: forzar edición MIDI si el modelo solo puso setBpm
              if (
                (midiClipEditIntent || styleApplyIntent) &&
                midiClipEditFallback.length > 0 &&
                actionsLackMidiNoteEdits(actions)
              ) {
                actions = [
                  ...actions.filter((a) => a.type !== 'daw.musicBuild' && a.type !== 'daw.composeProject'),
                  ...midiClipEditFallback,
                ]
                clarifyQs = []
              }
              // Partir mega-clips en pedazos / secciones
              if (
                clipSectionSplitIntent &&
                sectionSplitFallback.length > 0 &&
                !actions.some((a) => a.type === 'midi.clip.splitIntoSections' || a.type === 'clip.split')
              ) {
                actions = [
                  ...actions.filter((a) => a.type !== 'daw.musicBuild' && a.type !== 'daw.composeProject'),
                  ...sectionSplitFallback,
                ]
                clarifyQs = []
              }
              // Si el modelo inventó ACTIONS inválidas pero hay canción completa, garantizar musicBuild
              if (forceFullSong && !actions.some((a) => a.type === 'daw.musicBuild' || a.type === 'project.setBpm')) {
                const mins = extractMinutesFromClarifyText(workText)
                const genero = extractGenreFromClarifyText(workText)
                const bpm =
                  inferBpmFromTempoIntent(workText, state.project?.bpm?.valor ?? 120) ?? 72
                actions = [
                  { type: 'project.setBpm', payload: { bpm } },
                  {
                    type: 'daw.musicBuild',
                    payload: {
                      aplicar: true,
                      prompt: workText.slice(0, 1500),
                      minutos: mins ?? 3,
                      ...(genero ? { genero } : {}),
                      midiSource: 'ai',
                      bpm,
                    },
                  },
                  ...actions,
                ]
              }
              // Solo tempo: si el modelo no emitió nada útil, bajar/subir BPM
              if (
                isTempoOnlyRefine(userText) &&
                !actions.some((a) => a.type === 'project.setBpm')
              ) {
                const bpm =
                  inferBpmFromTempoIntent(userText, state.project?.bpm?.valor ?? 120) ?? 72
                actions = [{ type: 'project.setBpm', payload: { bpm } }, ...actions]
                clarifyQs = []
              }
              // Refinar tempo+estilo: asegurar setBpm; corregir musicBuild a 120 si pidió más lenta
              if (isSongRefineIntent(userText) && !isTempoOnlyRefine(userText)) {
                const bpm =
                  inferBpmFromTempoIntent(userText, state.project?.bpm?.valor ?? 120) ?? 72
                if (!actions.some((a) => a.type === 'project.setBpm')) {
                  actions = [{ type: 'project.setBpm', payload: { bpm } }, ...actions]
                }
                actions = actions.map((a) => {
                  if (a.type !== 'daw.musicBuild') return a
                  const p = (a.payload ?? {}) as Record<string, unknown>
                  const modelBpm = typeof p.bpm === 'number' ? p.bpm : null
                  if (modelBpm != null && modelBpm <= 100) return a
                  return { ...a, payload: { ...p, bpm, aplicar: true } }
                })
              }
              actions = ensureMusicBuildForFullProject(actions, userText, {
                aplicar: resolvedMode === 'create' || forceBuild,
              })
              if (auditIntent || isStyleGapIntent(userText) || (resolvedMode === 'ask' && !styleApplyIntent)) {
                actions = actions.filter((a) => a.type !== 'daw.musicBuild' && a.type !== 'daw.composeProject')
              }
              if (styleApplyIntent || midiClipEditIntent) {
                // Evitar reconstruir canción entera: solo edición de groove / humanize
                actions = actions.filter((a) => a.type !== 'daw.musicBuild' && a.type !== 'daw.composeProject')
              }

              // Si pidió editar MIDI y aún no hay notes.set/patch, inyectar fallback otra vez
              if (
                (midiClipEditIntent || styleApplyIntent) &&
                midiClipEditFallback.length > 0 &&
                actionsLackMidiNoteEdits(actions)
              ) {
                actions = [...actions, ...midiClipEditFallback]
              }

              let text = stripProseClarifyLists(
                stripChecklistBlock(
                  sanitizeAssistantMarkdown(
                    raw
                      .replace(/<<<ACTIONS[\s\S]*?ACTIONS>>>/gi, '')
                      .replace(/<<<PLAN[\s\S]*?PLAN>>>/gi, '')
                      .replace(/<<<DOC[\s\S]*?DOC>>>/gi, ''),
                  ),
                ),
              )
              if (
                (isGarbageAssistantReply(text) ||
                  isOffTopicCreatePlanReply(userText, text) ||
                  (isStyleGapIntent(userText) && /Auditor[ií]a MIDI|P[123]\s*[·:]/i.test(text))) &&
                (auditIntent ||
                  resolvedMode === 'ask' ||
                  isProjectAuditIntent(userText) ||
                  isStyleGapIntent(userText))
              ) {
                if (isStyleGapIntent(userText)) {
                  text = buildStyleGapReport(state, { userText })
                } else {
                  text =
                    midiAuditReport ||
                    buildMidiAuditReport(state) ||
                    [
                      'No pude cerrar un informe útil en este intento.',
                      'Reintenta el mismo pedido.',
                    ].join('\n')
                }
              }
              // Si el modelo contestó poco o con jerga técnica en un style_gap, preferir el informe productor
              if (
                styleGapIntent &&
                (isGarbageAssistantReply(text) ||
                  /Auditor[ií]a MIDI|\*{0,2}P[123]\*{0,2}|🔴\s*P1|🟡\s*P2|🟢\s*P3|244\.0b|formulario/i.test(
                    text,
                  ) ||
                  text.trim().length < 120)
              ) {
                text = styleGapSeed || buildStyleGapReport(state, { userText })
              }
              if (
                (styleApplyIntent || midiClipEditIntent) &&
                actions.some((a) => /midi\./i.test(a.type)) &&
                (isGarbageAssistantReply(text) ||
                  /Auditor[ií]a MIDI|gap analysis|Qué le falta|🔴\s*P1|P[123]\s*[·:(]/i.test(text) ||
                  text.trim().length < 40)
              ) {
                text = midiClipEditIntent
                  ? [
                      'Voy a editar los **clips MIDI** (no solo el tempo):',
                      '- Intro / groove de batería más suave (toms, platillos, build al redoblante si aplica)',
                      '- Dinámicas más bajas donde pediste suavidad',
                      '- Pads / capas ambientales si lo pediste',
                      '',
                      'Revisa la tarjeta **Aplicar** abajo.',
                    ].join('\n')
                  : [
                      'Voy a acercar la **batería** al estilo que pediste:',
                      ...describeStyleEnhanceProfile(styleEnhanceProfileFromText(workText)),
                      '',
                      'Revisa la tarjeta **Aplicar** abajo. El resto de pistas (bajo, keys, pad, lead) las puedo adecuar en un segundo paso si quieres.',
                    ].join('\n')
              }
              // Preguntas solo si aún no se respondió / no hay créalo
              if (clarifyQs.length > 0 && !forceBuild) {
                clarifications = { status: 'pending', questions: clarifyQs }
                accumulated =
                  text.trim() ||
                  'Elige las opciones con los botones y pulsa Enviar respuestas. Si ninguna encaja, usa el campo del final.'
              } else if (actions.length > 0) {
                if (!stillMine()) throw new DOMException('Aborted', 'AbortError')
                const modeForApply = forceBuild ? 'create' : resolvedMode
                // Checklist solo si el modelo emite <<<CHECKLIST>>> explícito.
                // Auto-partir cada acción en Continuar dejaba solo BPM aplicado y el resto colgado.
                const explicitChecklist = parseChecklistFromText(raw)
                const wantStepChecklist =
                  Boolean(explicitChecklist) &&
                  !modeBlocksMutation(modeForApply) &&
                  (modeForApply === 'create' || modeForApply === 'auto' || forceBuild)

                if (wantStepChecklist && explicitChecklist) {
                  const checklist = explicitChecklist
                  const readonly = actions.filter((a) => !isMutatingAction(a))
                  if (readonly.length) {
                    lastResults = await executeDawActions(dawStore, readonly, {
                      agentMode: modeForApply,
                      forceApply: false,
                      source: 'model_actions',
                      conversationId: conversation.id,
                      messageId: assistantMsgId,
                    })
                    docEdits = appendDocEdits(docEdits, lastResults)
                  }
                  agentChecklist = checklist
                  pendingActions = undefined
                  actionsSummary = `Checklist: ${checklist.items.length} paso(s). Pulsa Continuar en cada uno.`
                  accumulated =
                    text.trim() ||
                    'Tengo claro el plan. Revisa el checklist y pulsa **Continuar** para ejecutar cada paso en el DAW (sin perder el flujo).'
                } else {
                  const out = await processActionsForMode({
                    tienda: dawStore,
                    actions,
                    resolvedMode: modeForApply,
                    userText,
                    conversationId: conversation.id,
                    messageId: assistantMsgId,
                    source: parseActionsFromText(raw).length ? 'model_actions' : 'fallback',
                  })
                  lastResults = out.results
                  docEdits = appendDocEdits(docEdits, out.results)
                  pendingActions = out.pendingActions
                  confirmActions = out.confirmActions
                  ranMutations = out.ranMutations
                  absorbTurnMeta(out, turnMeta)
                  actionsSummary = formatActionResultsForUser(resultsOrPending(out))
                  if (!text.trim() || /ableton|logic pro|no puedo generar|<<<ACTIONS|<<<CLARIFY/i.test(text)) {
                    text = out.pendingActions
                      ? 'Listo: propuesta lista. Revisa el diff y pulsa Aplicar (todos los cambios juntos).'
                      : 'Listo.'
                  }
                  accumulated = text
                }
              } else {
                accumulated = text.trim() || midiAuditReport || 'Hecho.'
              }
              setAiStatus('online')
              setStatusDetail('')
            } else {
              const forced =
                (styleApplyIntent || midiClipEditIntent) &&
                (midiClipEditFallback.length || styleEnhanceFallback.length)
                  ? [
                      ...(midiClipEditFallback.length ? midiClipEditFallback : styleEnhanceFallback),
                    ]
                  : await runFallbackTool(ctx, FALLBACK_TOOLS.userIntent, { text: workText, mode: agentMode })
              if (forced.length) {
                const out = await processActionsForMode({
                  tienda: dawStore,
                  actions: forced,
                  resolvedMode: styleApplyIntent || midiClipEditIntent ? 'create' : resolvedMode,
                  userText,
                  conversationId: conversation.id,
                  messageId: assistantMsgId,
                  source: 'fallback',
                })
                lastResults = out.results
                docEdits = appendDocEdits(docEdits, out.results)
                pendingActions = out.pendingActions
                confirmActions = out.confirmActions
                ranMutations = out.ranMutations
                absorbTurnMeta(out, turnMeta)
                actionsSummary = formatActionResultsForUser(resultsOrPending(out))
                accumulated = styleApplyIntent || midiClipEditIntent
                  ? [
                      'El modelo no respondió bien; dejé lista la edición MIDI de los clips (groove / dinámica / pads según el pedido).',
                      'Revisa **Aplicar** abajo.',
                      actionsSummary,
                    ].join('\n\n')
                  : modeBlocksMutation(resolvedMode)
                    ? `El modelo no devolvió texto usable; dejé una propuesta lista para Construir.\n\n${actionsSummary}`
                    : `El modelo no devolvió texto usable; apliqué tu brief en el DAW.\n\n${actionsSummary}`
              } else {
                accumulated =
                  (auditIntent && midiAuditReport) ||
                  formatAiUserError({
                  error: result.error || 'No se pudo obtener respuesta del modelo.',
                  errorCode: result.errorCode,
                  hint: result.hint,
                  provider: result.provider || provider.kind,
                })
              }
              setAiStatus(result.errorCode === 'missing_api_key' ? 'misconfigured' : 'offline')
              setStatusDetail([result.error, result.hint].filter(Boolean).join(' — '))
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Error de comunicación con el motor de IA'
            const forced = await runFallbackTool(ctx, FALLBACK_TOOLS.userIntent, { text: workText, mode: agentMode })
            if (forced.length) {
              const out = await processActionsForMode({
                tienda: dawStore,
                actions: forced,
                resolvedMode,
                userText,
                conversationId: conversation.id,
                messageId: assistantMsgId,
                source: 'fallback',
              })
              lastResults = out.results
              docEdits = appendDocEdits(docEdits, out.results)
              pendingActions = out.pendingActions
              confirmActions = out.confirmActions
              ranMutations = out.ranMutations
              absorbTurnMeta(out, turnMeta)
              actionsSummary = formatActionResultsForUser(resultsOrPending(out))
              accumulated = modeBlocksMutation(resolvedMode)
                ? 'Hubo un error de red; dejé una propuesta para Construir.'
                : 'Hubo un error de red con el modelo; apliqué la generación en el DAW.'
            } else {
              accumulated = formatAiUserError({
                error: message,
                errorCode: 'unknown',
                hint: 'Revisa Ajustes → IA y pulsa «Probar».',
                provider: provider.kind,
              })
            }
            setAiStatus('offline')
            setStatusDetail(message)
          }
        }
      }

      // Tras auditoría MIDI “técnica” (duplicados): formulario. NO en gap de estilo.
      const auditRemediationEligible =
        !isStyleGapIntent(userText) &&
        (isProjectAuditIntent(userText) ||
          /Revisión rápida del proyecto|Auditoría MIDI/i.test(accumulated) ||
          Boolean(midiAuditReport)) &&
        !wantsAuditFix &&
        !isMidiAuditSkipFixReply(userText) &&
        !pendingActions &&
        !clarifications
      if (auditRemediationEligible) {
        const snap = dawStore.obtenerEstado()
        const qs = buildMidiAuditClarifications(snap)
        const fixes = await runFallbackTool(ctx, FALLBACK_TOOLS.midiAuditFix)
        if (qs.length) {
          clarifications = { status: 'pending', questions: qs as ClarificationQuestion[] }
        }
        if (fixes.length) {
          setHarnessPhase('Preparando propuesta de arreglo…')
          const out = await processActionsForMode({
            tienda: dawStore,
            actions: fixes as DawAction[],
            resolvedMode: 'create',
            userText,
            conversationId: conversation.id,
            messageId: assistantMsgId,
            source: 'fallback',
          })
          pendingActions = out.pendingActions
          confirmActions = out.confirmActions
          absorbTurnMeta(out, turnMeta)
          if (!actionsSummary) {
            actionsSummary = formatActionResultsForUser(resultsOrPending(out))
          }
        }
        if (auditIntent && midiAuditReport && !/Revisión rápida|Auditoría MIDI/i.test(accumulated)) {
          accumulated = [accumulated, midiAuditReport].filter(Boolean).join('\n\n')
        }
        if (styleGapIntent && styleGapSeed && !/Qué le falta|gap de estilo|ghost notes/i.test(accumulated)) {
          // Si el modelo no dejó respuesta usable, el seed productor es la respuesta
          if (
            !accumulated.trim() ||
            /Auditor[ií]a MIDI|\*{0,2}P[123]\*{0,2}|🔴\s*P1|244\.0b|formulario/i.test(accumulated)
          ) {
            accumulated = styleGapSeed
          }
        }
      }

      const sidechainAppliedPre = lastResults.some((r) => r.type === 'sidechain.connect' && r.success)
      if (!stillMine()) throw new DOMException('Aborted', 'AbortError')
      const certifyPre = ranMutations
        ? await runPostTurnCertifyPipeline(dawStore, lastResults, { sidechainApplied: sidechainAppliedPre })
        : null
      if (certifyPre) {
        const { toStoredCertify } = await import('./agent-turn-undo')
        turnCertify = toStoredCertify(certifyPre)
      }
      if (certifyPre && certifyPre.issues.length) {
        actionsSummary = [actionsSummary, `Certify: ${certifyPre.issues.slice(0, 3).join('; ')}`]
          .filter(Boolean)
          .join('\n')
      }
      const turnUndoDepthAtStart = turnMeta.undo
      const turnAppliedDiffSummary = turnMeta.diff
      if (turnAppliedDiffSummary) {
        actionsSummary = [turnAppliedDiffSummary, actionsSummary].filter(Boolean).join('\n')
      }

      const firstReview = finishAgentTurn(
        dawStore.obtenerEstado().project.id,
        dawStore.obtenerEstado(),
        lastResults,
        modelRaw,
        {
          forcePlanMd: modeBlocksMutation(resolvedMode) || Boolean(parsedPlanForDocs),
          planFromModel: parsedPlanForDocs,
          planEval: certifyPre?.planEval ?? null,
          preferModelEval: true,
        },
      )
      if (ranMutations && !agentChecklist && planHasPendingTasks(dawStore.obtenerEstado().project.id)) {
        const harnessCtx: HarnessJobContext = {
          userText,
          initialResults: lastResults,
          evaluation: certifyPre?.planEval ?? firstReview.evaluation,
          actionsSummary,
          conversationId: conversation.id,
          messageId: assistantMsgId,
        }
        stashHarnessJobContext(harnessCtx)
        enqueueAgentJob('harness-until-plan', dawStore.obtenerEstado().project.id)
      }
      if (firstReview.extra) {
        actionsSummary = [actionsSummary, firstReview.extra].filter(Boolean).join('\n')
      }
      docEdits = mergeDocEdits(docEdits, firstReview.docEdits)

      const canReview =
        iaRemotaDisponible() &&
        !local &&
        !ac.signal.aborted &&
        ranMutations &&
        !modeBlocksMutation(resolvedMode) &&
        harnessReviewNeeded(lastResults) &&
        (firstReview.mutated || Boolean(firstReview.evaluation))
      if (canReview) {
        try {
          const cfg = loadAiSettings()
          const chatOnce = async (userContent: string) => {
            if (ac.signal.aborted) return { success: false as const, content: '' }
            const r = await ctx.chat({
              purpose: 'harness',
              system: buildAgentSystemPrompt(dawStore.obtenerEstado(), userText, 'think', messages),
              messages: [{ role: 'user', content: userContent }],
              temperature: Math.max(cfg.temperature, 0.35),
              maxTokens: Math.min(cfg.maxTokens, 8192),
            })
            return { success: !!r.success, content: r.content }
          }

          setHarnessPhase('Inspeccionando el DAW…')
          const sidechainApplied = lastResults.some(
            (r) => r.type === 'sidechain.connect' && r.success,
          )
          const follow = await runHarnessFollowups({
            userText,
            budget: turnBudget,
            initialResults: lastResults,
            evaluation: firstReview.evaluation,
            actionsSummary,
            projectId: dawStore.obtenerEstado().project.id,
            abort: ac.signal,
            chat: chatOnce,
            parseActions: parseActionsFromText,
            execute: (actions) =>
              executeDawActions(dawStore, actions, {
                agentMode: 'create',
                forceApply: true,
                source: 'harness',
                conversationId: conversation.id,
                messageId: assistantMsgId,
                respectModeGate: false,
              }),
            getState: () => dawStore.obtenerEstado(),
            getHealthContext: () =>
              buildHarnessHealthContext(dawStore, { sidechainApplied }),
            afterTurn: (turnResults, raw) => {
              const step = finishAgentTurn(
                dawStore.obtenerEstado().project.id,
                dawStore.obtenerEstado(),
                turnResults,
                raw,
                { preferModelEval: true },
              )
              return step.evaluation ?? firstReview.evaluation
            },
            formatResults: formatActionResultsForUser,
            onProgress: ({ turn, maxTurns, report }) => {
              setHarnessPhase(formatHarnessProgress(turn, maxTurns, report))
            },
            preChat: async (repairPrompt) => {
              try {
                const { runAbbreviatedReasoning } = await import('@jaswave/ai-harness')
                const { formatLibraryPresetsForContext } = await import('./library/ops')
                const presetsBlock = await formatLibraryPresetsForContext(dawStore, 8)
                const ctx = buildAssembledAgentContext(
                  dawStore,
                  dawStore.obtenerEstado(),
                  userText,
                  [],
                  presetsBlock,
                )
                const brief = await runAbbreviatedReasoning({
                  userText,
                  budget: turnBudget,
                  mode: 'create',
                  projectContext: ctx,
                  repairContext: repairPrompt,
                  chat: async (msgs) => chatOnce(msgs.find((m) => m.role === 'user')?.content ?? repairPrompt),
                  runReadTools: async () => '(omitido en reparación)',
                  abort: ac.signal,
                })
                return brief || repairPrompt
              } catch {
                return repairPrompt
              }
            },
          })
          lastResults = follow.results
          docEdits = appendDocEdits(docEdits, follow.results)
          actionsSummary = follow.actionsSummary
          if (follow.text.trim()) {
            accumulated = [accumulated, follow.text].filter(Boolean).join('\n\n')
          }
          const leftover = follow.lastReport.errors.map((e) => e.message)
          if (follow.turns.length > 0 || follow.stoppedReason !== 'healthy') {
            actionsSummary = [
              actionsSummary,
              formatHarnessStopLine(follow.stoppedReason, follow.turns.length, leftover),
            ]
              .filter(Boolean)
              .join('\n')
          }

          if (follow.stoppedReason === 'budget') {
            actionsSummary = [actionsSummary, follow.budgetMessage ?? formatAgentBudgetStopFor(turnBudget)]
              .filter(Boolean)
              .join('\n')
          }
          if (
            !ac.signal.aborted &&
            follow.stoppedReason !== 'aborted' &&
            follow.stoppedReason !== 'budget' &&
            !turnBudget.exceeded()
          ) {
          const afterState = dawStore.obtenerEstado()
          setHarnessPhase('Revisión vs plan.md…')
          const reviewUser = buildHarnessReviewMessage({
            userText,
            evalSummary: follow.evaluation?.summary || firstReview.evaluation?.summary || firstReview.extra,
            actionsSummary,
            projectId: afterState.project.id,
            evaluation: follow.evaluation ?? firstReview.evaluation,
          })
          const reviewResult = await ctx.chat({
            purpose: 'review',
            system: buildAgentSystemPrompt(afterState, userText, 'think', messages),
            messages: [{ role: 'user', content: reviewUser }],
            temperature: Math.max(cfg.temperature, 0.4),
            maxTokens: Math.min(cfg.maxTokens, 8192),
          })
          if (reviewResult.success && reviewResult.content?.trim()) {
            const reviewRaw = reviewResult.content
            const reviewActions = parseActionsFromText(reviewRaw)
            let reviewResults: ActionResult[] = []
            if (reviewActions.length) {
              reviewResults = await executeDawActions(dawStore, reviewActions, {
                agentMode: 'create',
                forceApply: true,
                source: 'harness',
                conversationId: conversation.id,
                messageId: assistantMsgId,
                respectModeGate: false,
              })
              lastResults = [...lastResults, ...reviewResults]
              docEdits = appendDocEdits(docEdits, reviewResults)
            }
            const second = finishAgentTurn(
              dawStore.obtenerEstado().project.id,
              dawStore.obtenerEstado(),
              reviewResults,
              reviewRaw,
              { preferModelEval: true },
            )
            const reviewText = stripActionsBlock(reviewRaw)
            if (reviewText.trim()) {
              accumulated = [accumulated, reviewText].filter(Boolean).join('\n\n')
            }
            if (reviewResults.length) {
              actionsSummary = [actionsSummary, formatActionResultsForUser(reviewResults), second.extra]
                .filter(Boolean)
                .join('\n')
            } else if (second.extra) {
              actionsSummary = [actionsSummary, second.extra].filter(Boolean).join('\n')
            }
            docEdits = mergeDocEdits(docEdits, second.docEdits)
          }
          }
        } catch (err) {
          const reviewErr = err instanceof Error ? err.message : 'Error en revisión del harness'
          appendAiDawAudit({
            conversationId: conversation.id,
            messageId: assistantMsgId,
            agentMode: resolvedMode,
            tool: 'harness.review',
            params: {},
            status: 'failed',
            source: 'harness',
            result: { success: false, message: reviewErr },
          })
          accumulated = [accumulated, `⚠ Revisión del plan: ${reviewErr}`].filter(Boolean).join('\n\n')
        }
      }

      const midiPreview = (() => {
        const hit = lastResults.find(
          (r) =>
            r.success &&
            r.type === 'daw.generateMidiSong' &&
            (r.data as { kind?: string } | undefined)?.kind === 'midiPreview',
        )
        const data = hit?.data as MidiPreviewData | undefined
        return data
          ? { ...data, status: (data.applied ? 'applied' : 'pending') as 'applied' | 'pending' }
          : undefined
      })()
      const midiClipMdPreview = (() => {
        const hit = lastResults.find(
          (r) =>
            r.success &&
            (r.type === 'midi.clip.md.upsert' || r.type === 'midi.clip.md.apply') &&
            (r.data as { kind?: string } | undefined)?.kind === 'midiClipMdPreview',
        )
        const data = hit?.data as MidiClipMdPreviewData | undefined
        if (!data) return undefined
        if (!data.applied && data.notes?.length) {
          void import('./ai-midi-proposal-store').then(({ publishMidiProposalFromMdPreview }) => {
            publishMidiProposalFromMdPreview({
              trackId: data.trackId,
              clipId: data.clipId,
              notes: data.notes,
              label: data.nombre,
              messageId: assistantMsgId,
            })
          })
        }
        return {
          ...data,
          status: (data.applied ? 'applied' : 'pending') as 'applied' | 'pending',
        }
      })()
      const projectPlan = (() => {
        const hit = lastResults.find(
          (r) => r.type === 'daw.composeProject' && (r.data as { kind?: string } | undefined)?.kind === 'projectPlan',
        )
        const data = hit?.data as ProjectPlanData | undefined
        return data
          ? { ...data, status: (data.applied ? 'applied' : 'pending') as 'applied' | 'pending' }
          : undefined
      })()
      const musicBuild = pickMusicBuild(lastResults)
      const chatBody =
        musicBuild && !musicBuild.applied
          ? `Te preparé el plan de **${musicBuild.spec.nombre}** (${musicBuild.spec.tracks.length} pistas). Revisa la tarjeta y pulsa **Crear en el proyecto**.`
          : musicBuild?.applied
            ? `Listo: **${musicBuild.spec.nombre}** ya está en el arrange.`
            : accumulated || '⚠️ Sin respuesta.'
      updateMessageContent(
        conversation.id,
        assistantMsgId,
        chatBody,
        musicBuild ? undefined : actionsSummary || undefined,
        midiPreview,
        projectPlan,
        musicBuild,
        pendingActions,
        confirmActions,
        finalReasoningSteps,
        docEdits.length ? docEdits : undefined,
        midiClipMdPreview,
      )
      patchMessage(conversation.id, assistantMsgId, {
        ...(turnCertify ? { certify: turnCertify } : {}),
        ...(turnUndoDepthAtStart != null ? { undoDepthAtStart: turnUndoDepthAtStart } : {}),
        ...(turnAppliedDiffSummary ? { appliedDiffSummary: turnAppliedDiffSummary } : {}),
        ...(clarifications ? { clarifications } : {}),
        ...(agentChecklist ? { agentChecklist } : {}),
      })
      const after = getConversation(conversation.id)
      if (after) setConversation(after)
      refreshHistoryList()
    return finishOutcome(ctx, assistantMsgId, pendingActions, chatBody)
  } catch (err: unknown) {
    const aborted = (err instanceof DOMException && err.name === 'AbortError') || ac.signal.aborted
    if (aborted) {
      updateMessageContent(conversation.id, assistantMsgId, '⏹ Ejecución detenida.')
      touch()
      throw err
    }
    const message = err instanceof Error ? err.message : 'Error desconocido'
    updateMessageContent(
      conversation.id,
      assistantMsgId,
      formatAiUserError({
        error: `Error al procesar: ${message}`,
        errorCode: 'unknown',
        hint: 'Inténtalo de nuevo.',
      }),
    )
    touch()
    setStatusDetail(message)
    return { status: 'failed', error: message }
  }
}

function finishOutcome(
  ctx: TurnContext,
  messageId: string,
  pendingActions: StoredChatMessage['pendingActions'],
  summary: string,
): TurnProgramOutcome {
  if (pendingActions?.status === 'pending' && pendingActions.actions.length) {
    ctx.setData(legacyRunData())
    const need: EngineNeed = {
      id: ctx.newId('need'),
      kind: 'apply',
      message: pendingActions.previewSummary || `${pendingActions.actions.length} cambio(s) por aplicar`,
      data: { messageId },
    }
    return { status: 'needs-user', need, summary }
  }
  return { status: 'completed', summary }
}

/** Chips de inicio («Resumen del proyecto», …) sin modelo. */
async function runQuickTurn(ctx: TurnContext, tienda: TiendaDAW): Promise<TurnProgramOutcome> {
  const dawStore = tienda
  const lc = (ctx.input.context ?? {}) as Partial<LegacyTurnContext>
  const conversation = { id: ctx.run.conversationId }
  const assistantMsgId = lc.assistantMsgId ?? ctx.run.messageId ?? ''
  const userText = ctx.run.userText
  const agentMode = ctx.run.mode as AgentMode
  const { touch } = viewShims(ctx)
  const setConversation = (_c: unknown) => touch()
  const refreshHistoryList = () => touch()
      const state = dawStore.obtenerEstado()
      if (/crea|midi|piano|proyecto|plan/i.test(userText)) {
        const forced = await runFallbackTool(ctx, FALLBACK_TOOLS.userIntent, { text: userText, mode: agentMode })
        const resolvedMode = workingMode(agentMode, userText)
        const out = await processActionsForMode({
          tienda: dawStore,
          actions: forced,
          resolvedMode,
          userText,
          conversationId: conversation.id,
          messageId: assistantMsgId,
          source: 'fallback',
        })
        const results = out.results
        const firstReview = finishAgentTurn(
          dawStore.obtenerEstado().project.id,
          dawStore.obtenerEstado(),
          results,
        )
        const quickDocEdits = mergeDocEdits(appendDocEdits([], results), firstReview.docEdits)
        const summary = [formatActionResultsForUser(resultsOrPending(out)), firstReview.extra]
          .filter(Boolean)
          .join('\n')
        const midiPreview = (() => {
          const hit = results.find(
            (r) =>
              r.success &&
              r.type === 'daw.generateMidiSong' &&
              (r.data as { kind?: string } | undefined)?.kind === 'midiPreview',
          )
          const data = hit?.data as MidiPreviewData | undefined
          return data
            ? { ...data, status: (data.applied ? 'applied' : 'pending') as 'applied' | 'pending' }
            : undefined
        })()
        const projectPlan = (() => {
          const hit = results.find(
            (r) => r.type === 'daw.composeProject' && (r.data as { kind?: string } | undefined)?.kind === 'projectPlan',
          )
          return hit?.data as ProjectPlanData | undefined
        })()
        const musicBuild = pickMusicBuild(results)
        updateMessageContent(
          conversation.id,
          assistantMsgId,
          musicBuild
            ? musicBuild.applied
              ? `Listo: **${musicBuild.spec.nombre}** ya está en el arrange.`
              : `Te preparé el plan de **${musicBuild.spec.nombre}** (${musicBuild.spec.tracks.length} pistas). Revisa la tarjeta y pulsa **Crear en el proyecto**.`
            : projectPlan
            ? projectPlan.applied
              ? `Proyecto aplicado: ${projectPlan.nombre}.`
              : `Plan listo: ${projectPlan.tracks.length} pistas. Revisa y aplica cuando quieras.`
            : out.pendingActions
              ? 'Propuesta lista — pulsa Construir para aplicar.'
            : midiPreview
              ? midiPreview.status === 'applied'
                ? `Clip aplicado: ${midiPreview.keyLabel}.`
                : 'Vista previa lista en el chat. Escucha y aplica cuando quieras.'
              : ['He creado el material en el arrange de JasWave.', summary].join('\n\n'),
          musicBuild ? undefined : summary,
          midiPreview,
          projectPlan,
          musicBuild,
          out.pendingActions,
          out.confirmActions,
          undefined,
          quickDocEdits.length ? quickDocEdits : undefined,
        )
      } else {
        const reply =
          answerLocalReadQuery(state, userText) ??
          'No tengo una respuesta local. Escribe con más detalle o configura el modelo.'
        updateMessageContent(conversation.id, assistantMsgId, reply)
      }
      const after = getConversation(conversation.id)
      if (after) setConversation(after)
      refreshHistoryList()
  return { status: 'completed', summary: 'Turno rápido' }
}

/** Aplicar la propuesta pendiente (tarjeta) dentro del motor. */
async function runApplyTurn(ctx: TurnContext, tienda: TiendaDAW, a: ApplyPendingAnswer): Promise<TurnProgramOutcome> {
  hydrateLegacyRun(ctx)
  const { runApplyPendingFlow } = await import('./pending-apply-flow')
  const budget = createBudgetGuard(ctx.budget)
  const cfg = loadAiSettings()
  const provider = getActiveProvider(cfg)
  const chat = async (body: string): Promise<string | AgentLoopChatReply> => {
    const res = await ctx.chat({
      purpose: 'agent',
      messages: [{ role: 'user', content: body }],
      tools: nativeLoopTools(ctx),
      temperature: cfg.temperature,
      maxTokens: Math.min(cfg.maxTokens, 8192),
    })
    return toLoopReply(res)
  }
  const out = await runApplyPendingFlow({
    tienda,
    conversationId: a.conversationId,
    messageId: a.messageId,
    agentMode: a.agentMode,
    actions: a.actions as DawAction[],
    indices: a.indices,
    chat,
    userTextHint: a.userTextHint,
    councilChat: async (msgs) => {
      const r = await ctx.chat({
        purpose: 'council',
        messages: msgs as EngineChatMessage[],
        temperature: Math.min(0.9, Math.max(cfg.temperature, 0.55)),
        maxTokens: Math.max(cfg.maxTokens, 16384),
        skipPlan: true,
      })
      return { success: r.success, content: r.content }
    },
    paceBetweenPhasesMs: providerReasoningPaceMs(provider.kind),
    abort: ctx.signal,
    budget,
    onCouncilPhase: (label) => ctx.phase(label, 'council'),
    onCouncilStep: (steps) => ctx.emit({ type: 'agent.message', role: ctx.run.role, text: '', data: { kind: 'council-steps', steps } }),
  })
  if (out.nextPending.length) {
    ctx.setData(legacyRunData())
    return {
      status: 'needs-user',
      summary: out.loopSummary || 'Siguiente paso listo — pulsa Aplicar.',
      need: { id: ctx.newId('need'), kind: 'apply', message: 'Siguiente paso listo — pulsa Aplicar.', data: { messageId: a.messageId } },
      data: out,
    }
  }
  return { status: 'completed', summary: [out.line, out.loopSummary].filter(Boolean).join('\n'), data: out }
}

/** Herramientas nativas para el agent loop (A2), filtradas por modo y recortadas por prioridad. */
function nativeLoopTools(ctx: TurnContext) {
  return listAgentToolSchemas({ mode: ctx.run.mode, role: ctx.run.role })
}

/**
 * Respuesta del motor → decisión del agent loop: tool calls nativas mandan; si no hay,
 * el texto se parsea con marcadores (el loop repara si falta DECISION).
 */
function toLoopReply(res: Awaited<ReturnType<TurnContext['chat']>>): string | AgentLoopChatReply {
  if (!res.success) return ''
  const text = res.content ?? ''
  const native = res.toolCalls?.length ? agentDecisionFromToolCalls(res.toolCalls, text) : null
  return { text, decision: native ?? parseAgentDecisionFromText(text) }
}

export function createLegacyTurnProgram(deps: { tienda: TiendaDAW }): TurnProgram {
  return {
    id: LEGACY_PROGRAM_ID,
    run(ctx) {
      if (ctx.input.kind === 'quick') return runQuickTurn(ctx, deps.tienda)
      if (ctx.input.kind === 'apply') {
        const a = (ctx.input.context as { apply?: ApplyPendingAnswer } | undefined)?.apply
        if (!a) return Promise.resolve({ status: 'failed', error: 'Turno apply sin datos' })
        return runApplyTurn(ctx, deps.tienda, a)
      }
      return runCoproducerTurn(ctx, deps.tienda)
    },
    answer(ctx, need: EngineNeed, answer: EngineAnswer) {
      if (need.kind === 'apply' && answer.data) return runApplyTurn(ctx, deps.tienda, answer.data as ApplyPendingAnswer)
      return Promise.resolve({ status: 'failed', error: `Respuesta no soportada: ${need.kind}` })
    },
    async resume(ctx) {
      // Recarga a mitad de turno: se repite el turno desde el principio sobre el mismo mensaje.
      const lc = (ctx.input.context ?? {}) as Partial<LegacyTurnContext>
      if (lc.assistantMsgId) {
        updateMessageContent(ctx.run.conversationId, lc.assistantMsgId, '')
      }
      return ctx.input.kind === 'quick' ? runQuickTurn(ctx, deps.tienda) : runCoproducerTurn(ctx, deps.tienda)
    },
  }
}

