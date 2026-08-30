import {
  ArrowUp,
  Check,
  Copy,
  GitCompare,
  Hammer,
  Loader2,
  Quote,
  Square,
  User,
  X,
  Zap,
  WifiOff,
  History,
  Trash2,
  MessageSquarePlus,
} from 'lucide-react'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useDAWState, useDAW } from '@/src/context/daw-context'
import {
  answerLocalReadQuery,
  buildMidiAuditReport,
  buildMidiAuditFixActions,
  buildMidiAuditClarifications,
  isGarbageAssistantReply,
} from '@/src/lib/ai-read-context'
import {
  loadAiSettings,
  getActiveProvider,
  formatAiUserError,
  toAiChatPayload,
  toAiHealthPayload,
  providerReasoningPaceMs,
  aiChatWithFallback,
  selectCatalogModel,
  saveAiSettings,
} from '@/src/lib/ai-settings'
import {
  buildAgentSystemPrompt,
  stripActionsBlock,
  parseActionsFromText,
  parsePlanFromText,
  fallbackActionsFromUserIntent,
  executeDawActions,
  formatActionResultsForUser,
  type ActionResult,
  type DawAction,
} from '@/src/lib/ai-daw-agent'
import {
  forcePreviewAplicar,
  ensureMusicBuildForFullProject,
  isMutatingAction,
  modeBlocksMutation,
  autonomyBlocksMutation,
  logPermissionForAction,
  partitionActions,
} from '@/src/lib/ai-action-policy'
import { buildHarnessHealthContext } from '@/src/lib/agent-audit-bridge'
import {
  ASK_AI_SELECTION_EVENT,
  clearMusicalSelectionAnchor,
  formatMusicalSelectionForPrompt,
  getMusicalSelectionAnchor,
  selectionChipInsertText,
  subscribeMusicalSelection,
} from '@/src/lib/ai-selection-context'
import {
  assistantAskedUserToWriteOptions,
  extractGenreFromClarifyText,
  extractMinutesFromClarifyText,
  formatClarificationAnswersForPrompt,
  isAffirmativeBuildIntent,
  isClarificationReply,
  isMidiAuditFixReply,
  isMidiAuditSkipFixReply,
  mustForceMusicBuild,
  resolveClarificationsFromAssistant,
  stripProseClarifyLists,
  type ClarificationQuestion,
} from '@/src/lib/ai-clarify'
import {
  AGENT_MODE_META,
  detectAgentMode,
  inferBpmFromTempoIntent,
  isProjectAuditIntent,
  isSongRefineIntent,
  isTempoOnlyRefine,
  loadAgentMode,
  saveAgentMode,
  wantsFullProject,
  type AgentMode,
} from '@/src/lib/ai-modes'
import {
  buildAssembledAgentContext,
  endCoproducerSession,
  startCoproducerSession,
} from '@/src/lib/agent-context-bridge'
import {
  dryRunDawActions,
  ensureToolRegistryContext,
  getToolRegistryPromptFragment,
  planDawActions,
} from '@/src/lib/agent-tool-bridge'
import { runPostTurnCertifyPipeline } from '@/src/lib/agent-certify-pipeline'
import {
  enqueueAgentJob,
  planHasPendingTasks,
  registerAgentJobRunner,
  cancelAgentJobs,
} from '@/src/lib/agent-job-queue'
import {
  buildChecklistFromActions,
  parseChecklistFromText,
  stripChecklistBlock,
  type AgentChecklist,
} from '@/src/lib/ai-agent-checklist'
import {
  runHarnessUntilPlanComplete,
  stashHarnessJobContext,
  type HarnessJobContext,
} from '@/src/lib/agent-harness-job-runner'
import { appendAiDawAudit } from '@/src/lib/ai-daw-audit-store'
import { PendingActionsCard } from '@/components/pending-actions-card'
import { AgentChecklistCard } from '@/components/agent-checklist-card'
import { ClarificationCard } from '@/components/clarification-card'
import { RevertTurnButton, TurnCertifyBadges } from '@/components/turn-verify-ui'
import { DestructiveConfirmCard } from '@/components/destructive-confirm-card'
import { AiAuditPanel } from '@/components/ai-audit-panel'
import { MidiGenerationPreview, type MidiPreviewData } from '@/components/midi-generation-preview'
import { ProjectPlanPreview } from '@/components/project-plan-preview'
import { MusicBuildPreview } from '@/components/music-build-preview'
import { AiModelPicker } from '@/components/ai-model-picker'
import {
  collectCitedMessages,
  filterMentionables,
  formatUserTurnWithCitations,
  groupMentionables,
  historyWithCitedPins,
  listMentionables,
  MAX_CITED_MESSAGES,
  mentionDraftAtCaret,
  messagePreview,
  type Mentionable,
} from '@/src/lib/ai-mentions'
import type { ProjectPlanData } from '@/src/lib/project-plan'
import { specToProjectPlan } from '@/src/lib/music-build'
import type { MusicBuildResult } from '@/src/lib/music-build/types'
import { copyTextToClipboard } from '@/src/lib/copy-text'
import {
  ensureActiveConversation,
  listConversations,
  createConversation,
  deleteConversation,
  setActiveConversationId,
  setChatProjectScope,
  appendMessage,
  updateMessageContent,
  patchMessage,
  getConversation,
  type ChatConversation,
  type StoredChatMessage,
} from '@/src/lib/ai-chat-store'
import { AgentModePicker } from '@/components/agent-mode-picker'
import { ReasoningStepsPanel } from '@/components/reasoning-steps-panel'
import { JasWaveLogo } from '@/components/brand'
import { ChatMarkdown } from '@/components/chat-markdown'
import type { TiendaDAW } from '../../shared/src/state/tienda'
import type { DAWState } from '../../shared/src/types/state'
import { applyMarkdownDocsFromModel, bindAgentDocsDisk, parseDocBlocksFromText } from '@/src/lib/agent-docs'
import {
  extractDocEditsFromResults,
  mergeDocEdits,
  type ChatDocEdit,
} from '@/src/lib/chat-doc-edits'
import { DocEditCards } from '@/components/doc-edit-card'
import { ensurePlanFromCompose, syncPlanAfterDawChange, type PlanEvaluation } from '@/src/lib/agent-plan-eval'
import {
  buildHarnessReviewMessage,
  formatHarnessProgress,
  formatHarnessStopLine,
  harnessReviewNeeded,
  runHarnessFollowups,
} from '@/src/lib/agent-harness'
import { requestOpenTool } from '@/src/workspace/types'

function newMsgId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

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

/** Texto plano completo de un mensaje (razonamiento + respuesta + acciones). */
function formatMessageForCopy(msg: StoredChatMessage): string {
  const parts: string[] = []
  if (msg.reasoningSteps?.length) {
    parts.push('--- Razonamiento ---')
    for (const step of msg.reasoningSteps) {
      parts.push(`${step.title}\n${step.content}`.trim())
    }
  }
  if (msg.content?.trim()) parts.push(msg.content.trim())
  if (msg.docEdits?.length) {
    parts.push(
      '--- Documentos ---',
      ...msg.docEdits.map((d) => `${d.slug} (${d.action})`),
    )
  }
  if (msg.actionsSummary?.trim()) {
    parts.push('--- Acciones ---', msg.actionsSummary.trim())
  }
  return parts.join('\n\n')
}

function finishAgentTurn(
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
      ensurePlanFromCompose(projectId, planHit.data as import('@/src/lib/project-plan').ProjectPlanData, {
        force: opts?.forcePlanMd,
      })
    }
  } else if (opts?.planFromModel) {
    ensurePlanFromCompose(projectId, opts.planFromModel, { force: true })
  }

  const skipSync = new Set(['doc.list', 'doc.read', 'doc.evaluate', 'doc.write', 'doc.create', 'doc.append'])
  const mutated = results.some((r) => r.success && !skipSync.has(r.type))
  let extra = ''
  let evaluation: PlanEvaluation | null = null
  let docsWritten: string[] = []
  let docEdits: ChatDocEdit[] = []
  const applyDocs = () => {
    const applied = modelText ? applyMarkdownDocsFromModel(projectId, modelText) : { slugs: [], edits: [] }
    docsWritten = applied.slugs
    docEdits = applied.edits
    if (docsWritten.length) extra = [extra, `Docs actualizados: ${docsWritten.join(', ')}`].filter(Boolean).join('\n')
    return docsWritten
  }
  if (opts?.preferModelEval) {
    if (mutated) {
      evaluation = opts?.planEval ?? syncPlanAfterDawChange(projectId, state)
      if (evaluation?.summary) extra = [extra, evaluation.summary].filter(Boolean).join('\n')
    }
    applyDocs()
  } else {
    applyDocs()
    if (mutated) {
      evaluation = opts?.planEval ?? syncPlanAfterDawChange(projectId, state)
      if (evaluation?.summary) extra = [extra, evaluation.summary].filter(Boolean).join('\n')
    }
  }

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

  if (extra || planHit || evaluation || docsWritten.length || opts?.planFromModel) {
    requestOpenTool('docs', { zone: 'left' })
  }
  return { extra, evaluation, mutated, docsWritten, docEdits }
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
async function processActionsForMode(opts: {
  tienda: TiendaDAW
  actions: DawAction[]
  resolvedMode: AgentMode
  userText: string
  conversationId: string
  messageId: string
  source: 'model_actions' | 'fallback'
}): Promise<ProcessActionsOutcome> {
  const { tienda, resolvedMode, userText, conversationId, messageId, source } = opts
  const actions = forcePreviewAplicar(opts.actions, resolvedMode)
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

  if (proposeFirst) {
    const readonly = actions.filter((a) => !isMutatingAction(a))
    const pending = actions.filter(isMutatingAction)
    let results: ActionResult[] = []
    if (readonly.length) {
      results = await executeDawActions(tienda, readonly, {
        agentMode: resolvedMode,
        forceApply: false,
        source,
        conversationId,
        messageId,
      })
    }
    let previewDiff: import('../../shared/src/state/diff-estado').SemanticStateDiff | undefined
    let previewSummary = ''
    if (pending.length) {
      ensureToolRegistryContext(tienda)
      const preview = await dryRunDawActions(tienda, pending)
      previewDiff = preview.diff
      previewSummary = preview.summary
      appendAiDawAudit({
        ...ctx,
        tool: 'planner.preview',
        params: { summary: previewSummary, pending: pending.length },
        status: preview.ok ? 'executed' : 'failed',
        result: { success: preview.ok, message: previewSummary || 'preview' },
      })
      const { publishMidiProposalFromActions } = await import('@/src/lib/ai-midi-proposal-store')
      publishMidiProposalFromActions(pending, { messageId })
    }
    for (const a of pending) {
      appendAiDawAudit({
        ...ctx,
        tool: a.type,
        params: { ...(a.payload ?? {}) },
        status: 'skipped_by_mode',
        result: { success: false, message: 'Pendiente de Aplicar' },
      })
    }
    const actionStatuses: Record<string, 'pending' | 'accepted' | 'rejected'> = {}
    pending.forEach((_, i) => {
      actionStatuses[String(i)] = 'accepted'
    })
    return {
      results,
      pendingActions:
        pending.length > 0
          ? {
              status: 'pending',
              actions: pending,
              agentMode: resolvedMode,
              previewDiff,
              previewSummary: previewSummary || undefined,
              actionStatuses,
            }
          : undefined,
      ranMutations: false,
    }
  }

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
  let results: ActionResult[] = []
  if (toRun.length) {
    const { snapshotUndoDepth } = await import('@/src/lib/agent-turn-undo')
    undoDepthAtStart = snapshotUndoDepth(tienda)
    results = await executeDawActions(tienda, toRun, {
      agentMode: resolvedMode,
      forceApply: false,
      source,
      conversationId,
      messageId,
    })
  }
  if (destructive.length) {
    for (const a of destructive) {
      appendAiDawAudit({
        ...ctx,
        tool: a.type,
        params: { ...(a.payload ?? {}) },
        status: 'pending_confirm',
        result: { success: false, message: 'Esperando confirmación del usuario' },
      })
    }
  }
  return {
    results,
    confirmActions:
      destructive.length > 0
        ? {
            status: 'pending',
            actions: destructive,
            reason: 'Esta acción borra o altera contenido de forma irreversible. ¿Confirmas?',
          }
        : undefined,
    ranMutations: results.some((r) => r.success && isMutatingAction({ type: r.type })),
    undoDepthAtStart,
    appliedDiffSummary,
  }
}


export function CoProducerPanel() {
  const [inputMessage, setInputMessage] = useState('')
  const [conversation, setConversation] = useState<ChatConversation>(() =>
    ensureActiveConversation('default'),
  )
  const [historyOpen, setHistoryOpen] = useState(false)
  const [conversations, setConversations] = useState<ChatConversation[]>(() =>
    listConversations('default'),
  )
  const [isGenerating, setIsGenerating] = useState(false)
  const [aiStatus, setAiStatus] = useState<'unknown' | 'online' | 'offline' | 'misconfigured'>('unknown')
  const [statusDetail, setStatusDetail] = useState('')
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [agentMode, setAgentMode] = useState<AgentMode>(() => loadAgentMode())
  const [harnessPhase, setHarnessPhase] = useState('')
  const [copiedMsgId, setCopiedMsgId] = useState('')
  const [citedIds, setCitedIds] = useState<string[]>([])
  const [selectionLabel, setSelectionLabel] = useState(() => getMusicalSelectionAnchor()?.label ?? '')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** Incrementa al detener para invalidar turnos en vuelo. */
  const genEpochRef = useRef(0)
  const liveAssistantMsgIdRef = useRef<string | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [inputMessage])

  useEffect(() => subscribeMusicalSelection(() => {
    setSelectionLabel(getMusicalSelectionAnchor()?.label ?? '')
  }), [])

  useEffect(() => {
    const onAsk = () => {
      requestOpenTool('coproducer', { zone: 'left' })
      const a = getMusicalSelectionAnchor()
      if (!a || a.notes.length === 0) {
        inputRef.current?.focus()
        return
      }
      setSelectionLabel(a.label)
      setInputMessage((prev) => {
        const chip = selectionChipInsertText(a)
        if (prev.includes('[selección:')) return prev
        return `${chip}${prev}`
      })
      window.setTimeout(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        const pos = el.value.length
        el.setSelectionRange(pos, pos)
      }, 50)
    }
    window.addEventListener(ASK_AI_SELECTION_EVENT, onAsk)
    return () => window.removeEventListener(ASK_AI_SELECTION_EVENT, onAsk)
  }, [])

  const dawStore = useDAW()
  const projectId = useDAWState((state) => state.project?.id || 'default')
  const projectName = useDAWState((state) => state.project?.nombre || 'Nuevo Proyecto')
  const trackCount = useDAWState((state) => state.project?.tracks?.length ?? 0)
  const messages =
    conversation.projectId === projectId
      ? conversation.messages.filter((m) => m.role === 'user' || m.role === 'assistant')
      : []
  const pendingProposal = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!
      if (m.pendingActions?.status === 'pending' && m.pendingActions.actions.length) {
        return {
          messageId: m.id,
          count: m.pendingActions.actions.length,
          cardId: `pending-actions-${m.id}`,
        }
      }
    }
    return null
  }, [messages])
  const citedMessages = citedIds
    .map((id) => messages.find((m) => m.id === id))
    .filter((m): m is StoredChatMessage => Boolean(m))
  const mentionHits =
    mentionQuery != null
      ? filterMentionables(listMentionables(dawStore.obtenerEstado(), messages), mentionQuery)
      : []
  const mentionGroups = groupMentionables(mentionHits)

  const citeMessage = (msg: StoredChatMessage) => {
    if (!msg.content?.trim() && !msg.actionsSummary?.trim()) return
    setCitedIds((ids) => {
      if (ids.includes(msg.id)) return ids
      return [...ids, msg.id].slice(-MAX_CITED_MESSAGES)
    })
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const insertMention = (item: Mentionable) => {
    if (item.kind === 'message' && item.messageId) {
      const target = messages.find((m) => m.id === item.messageId)
      if (target) citeMessage(target)
      const el = inputRef.current
      const caret = el?.selectionStart ?? inputMessage.length
      const draft = mentionDraftAtCaret(inputMessage, caret)
      if (draft) {
        const next = `${inputMessage.slice(0, draft.start)}${inputMessage.slice(caret)}`
        setInputMessage(next)
      }
      setMentionQuery(null)
      requestAnimationFrame(() => el?.focus())
      return
    }
    if (item.kind === 'mode' && item.mode) {
      setAgentMode(item.mode)
      saveAgentMode(item.mode)
    }
    const el = inputRef.current
    const caret = el?.selectionStart ?? inputMessage.length
    const draft = mentionDraftAtCaret(inputMessage, caret)
    const start = draft?.start ?? mentionStart
    const before = inputMessage.slice(0, start)
    const after = inputMessage.slice(caret)
    const token =
      item.insertText ??
      (item.label.includes(' ') ? `@"${item.label}"` : `@${item.label}`)
    const next = `${before}${token} ${after}`
    setInputMessage(next)
    setMentionQuery(null)
    requestAnimationFrame(() => {
      const pos = (before + token + ' ').length
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  const onInputChange = (value: string, caret: number) => {
    setInputMessage(value)
    const draft = mentionDraftAtCaret(value, caret)
    if (draft) {
      setMentionQuery(draft.query)
      setMentionStart(draft.start)
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
    }
  }

  const refreshHistoryList = useCallback(() => {
    setConversations(listConversations(projectId))
  }, [projectId])

  useEffect(() => {
    setChatProjectScope(projectId)
    const next = ensureActiveConversation(projectId)
    setConversation(next)
    setConversations(listConversations(projectId))
  }, [projectId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isGenerating])

  useEffect(() => {
    startCoproducerSession(dawStore)
    ensureToolRegistryContext(dawStore)
    registerAgentJobRunner(async (job, signal) => {
      if (signal.aborted) return
      if (job.kind === 'certify') {
        await runPostTurnCertifyPipeline(dawStore, [], {})
        return
      }
      if (job.kind === 'harness-until-plan') {
        const cfg = loadAiSettings()
        const provider = getActiveProvider(cfg)
        if (!window.electron?.aiChat) {
          await runPostTurnCertifyPipeline(dawStore, [], {})
          return
        }
        await runHarnessUntilPlanComplete(
          {
            dawStore,
            chat: async (userContent) => {
              const r = await window.electron!.aiChat!(
                toAiChatPayload(
                  provider,
                  [
                    {
                      role: 'system',
                      content: buildAgentSystemPrompt(dawStore.obtenerEstado(), userContent, 'create', []),
                    },
                    { role: 'user', content: userContent },
                  ],
                  { temperature: Math.max(cfg.temperature, 0.35), maxTokens: Math.min(cfg.maxTokens, 8192) },
                ),
              )
              return { success: !!r.success, content: r.content }
            },
            parseActions: parseActionsFromText,
            execute: (actions) =>
              executeDawActions(dawStore, actions, {
                agentMode: 'create',
                forceApply: true,
                source: 'harness',
                respectModeGate: false,
              }),
            formatResults: formatActionResultsForUser,
            buildSystemPrompt: (state, userText) => buildAgentSystemPrompt(state, userText, 'create', []),
            onProgress: (phase) => setHarnessPhase(phase),
            afterHarnessTurn: (turnResults, raw) => {
              const step = finishAgentTurn(
                dawStore.obtenerEstado().project.id,
                dawStore.obtenerEstado(),
                turnResults,
                raw,
                { preferModelEval: true },
              )
              return step.evaluation
            },
          },
          signal,
        )
      }
    })
    return () => endCoproducerSession(dawStore)
  }, [dawStore])

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const refresh = () => {
      const cfg = loadAiSettings()
      const provider = getActiveProvider(cfg)

      if (!window.electron?.aiHealth) {
        setAiStatus('misconfigured')
        setStatusDetail('Abre JasWave en Electron para usar proveedores de IA.')
        return
      }

      void window.electron
        .aiHealth(toAiHealthPayload(provider))
        .then((result) => {
          if (result.status === 'healthy') {
            setAiStatus('online')
            setStatusDetail('')
          } else if (result.status === 'misconfigured') {
            setAiStatus('misconfigured')
            setStatusDetail(
              [result.error, result.hint].filter(Boolean).join(' — ') ||
                'Configuración incompleta en Ajustes → IA.',
            )
          } else {
            setAiStatus('offline')
            setStatusDetail(
              [result.error, result.hint].filter(Boolean).join(' — ') ||
                'Proveedor no disponible. Revisa Ajustes → IA.',
            )
          }
        })
        .catch((err: unknown) => {
          setAiStatus('offline')
          setStatusDetail(err instanceof Error ? err.message : 'Error al comprobar el proveedor')
        })
    }
    refresh()
    window.addEventListener('jaswave-ai-settings-changed', refresh)
    return () => window.removeEventListener('jaswave-ai-settings-changed', refresh)
  }, [])

  const switchConversation = (id: string) => {
    const c = getConversation(id)
    if (!c || c.projectId !== projectId) return
    setActiveConversationId(id, projectId)
    setConversation(c)
    setHistoryOpen(false)
  }

  const startNewChat = () => {
    const c = createConversation('Nueva conversación', projectId)
    setActiveConversationId(c.id, projectId)
    setConversation(c)
    refreshHistoryList()
    setHistoryOpen(false)
  }

  const removeChat = (id: string) => {
    deleteConversation(id)
    if (conversation.id === id) {
      const next = ensureActiveConversation(projectId)
      setConversation(next)
    }
    refreshHistoryList()
  }

  const stopGeneration = () => {
    const msgId = liveAssistantMsgIdRef.current
    const convId = conversation.id
    abortRef.current?.abort()
    cancelAgentJobs()
    genEpochRef.current += 1
    abortRef.current = null
    setIsGenerating(false)
    setHarnessPhase('')
    if (msgId) {
      const before = getConversation(convId)
      const msg = before?.messages.find((m) => m.id === msgId)
      const checklist =
        msg?.agentChecklist?.status === 'active'
          ? { ...msg.agentChecklist, status: 'stopped' as const }
          : msg?.agentChecklist
      patchMessage(convId, msgId, {
        content: '⏹ Ejecución detenida.',
        ...(checklist ? { agentChecklist: checklist } : {}),
      })
      const refreshed = getConversation(convId)
      if (refreshed) setConversation(refreshed)
    }
    liveAssistantMsgIdRef.current = null
  }

  const copyChatMessage = async (msg: StoredChatMessage) => {
    const text = formatMessageForCopy(msg)
    if (!text.trim()) return
    const ok = await copyTextToClipboard(text)
    if (!ok) return
    setCopiedMsgId(msg.id)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => {
      setCopiedMsgId((id) => (id === msg.id ? '' : id))
      copiedTimerRef.current = null
    }, 1600)
  }

  const handleSendMessage = async (overrideText?: string) => {
    const rawInput = (overrideText ?? inputMessage).trim()
    if (!rawInput || isGenerating) return

    const userText = rawInput
    const stateForCite = dawStore.obtenerEstado()
    const cited = collectCitedMessages(userText, citedIds, stateForCite, messages)
    if (!overrideText) setInputMessage('')
    else setInputMessage('')
    setCitedIds([])
    const ac = new AbortController()
    abortRef.current = ac
    const myEpoch = genEpochRef.current
    const stillMine = () => myEpoch === genEpochRef.current && !ac.signal.aborted
    setHarnessPhase('Trabajando en el DAW…')

    const userMsgId = newMsgId('user')
    const assistantMsgId = newMsgId('asst')
    liveAssistantMsgIdRef.current = assistantMsgId

    appendMessage(conversation.id, {
      id: userMsgId,
      role: 'user',
      content: userText,
      citedMessageIds: cited.map((m) => m.id),
    })
    appendMessage(conversation.id, { id: assistantMsgId, role: 'assistant', content: '' })
    const refreshed = getConversation(conversation.id)
    if (refreshed) setConversation(refreshed)
    refreshHistoryList()
    setIsGenerating(true)

    try {
      const state = dawStore.obtenerEstado()
      // Consultas locales muy cortas solo si el proveedor no está online
      const preferLocal = aiStatus !== 'online' || !window.electron?.aiChat
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
      let turnUndoDepthAtStart: number | undefined
      let turnAppliedDiffSummary: string | undefined
      let turnCertify: StoredChatMessage['certify']
      const turnMeta: { undo?: number; diff?: string } = {}
      const resolvedMode = detectAgentMode(userText, agentMode)
      const auditIntent = isProjectAuditIntent(userText)
      const midiAuditReport = auditIntent ? buildMidiAuditReport(state) : ''
      const wantsAuditFix =
        isMidiAuditFixReply(userText) ||
        (/^arr[eé]glalo\b/i.test(userText.trim()) && !auditIntent)

      // Respuesta al formulario de auditoría / «arréglalo» → propuesta Aplicar (sin musicBuild)
      if (wantsAuditFix && !isMidiAuditSkipFixReply(userText)) {
        const fixes = buildMidiAuditFixActions(state)
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
            'Revisa la tarjeta abajo y pulsa **Aplicar seleccionadas**.',
          ].join('\n')
        } else {
          accumulated = 'No hay clips con duplicados detectados para arreglar ahora.'
        }
      } else if (isMidiAuditSkipFixReply(userText)) {
        accumulated = 'De acuerdo — dejo el proyecto como está. El informe anterior sigue válido.'
      } else if (!local) {
        if (!window.electron?.aiChat) {
          // Sin Electron: si pide crear, ejecutamos igual en el DAW local
          const forced = fallbackActionsFromUserIntent(userText, state, agentMode)
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
          const { formatLibraryPresetsForContext } = await import('@/src/lib/library/ops')
          const presetsBlock = await formatLibraryPresetsForContext(dawStore, 12)
          const chatTurns = messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

          setHarnessPhase('Razonamiento 1/7…')
          const { runAgentReasoningForTurn } = await import('@/src/lib/agent-reasoning-bridge')
          let cfg = loadAiSettings()
          let provider = getActiveProvider(cfg)

          const rememberWorkingModel = (usedProviderId?: string, usedModel?: string, fallbackUsed?: boolean) => {
            if (!fallbackUsed || !usedProviderId || !usedModel) return
            const next = selectCatalogModel(loadAiSettings(), usedProviderId, usedModel)
            saveAiSettings(next)
            window.dispatchEvent(new CustomEvent('jaswave-ai-settings-changed'))
            cfg = next
            provider = getActiveProvider(cfg)
          }

          const reasoning = await runAgentReasoningForTurn({
            tienda: dawStore,
            state,
            userText,
            resolvedMode,
            chatTurns,
            libraryPresetsBlock: presetsBlock,
            projectContextExtra: midiAuditReport
              ? [
                  '## Informe técnico local (datos reales del DAW — ancla obligatoria)',
                  midiAuditReport,
                  'Razona como productor sobre ESTOS hallazgos. No inventes clips ni ignores duplicados/largos.',
                  'En el turno final: explica en prosa + prioriza; no respondas solo con ¡¡¡.',
                ].join('\n')
              : undefined,
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
              const fallbackPromise = aiChatWithFallback(
                (req) => window.electron!.aiChat!(req),
                reasonMessages,
                {
                  temperature: Math.min(0.85, Math.max(cfg.temperature, 0.55)),
                  maxTokens: 1024,
                  settings: cfg,
                  abort: ac.signal,
                  onAttempt: ({ label, index, total }) => {
                    if (total > 1 && index > 0) {
                      setHarnessPhase(`Reintentando ${index + 1}/${total}: ${label}`)
                    }
                  },
                },
              )
              const abortPromise = new Promise<{ success: false }>((resolve) => {
                if (ac.signal.aborted) {
                  resolve({ success: false })
                  return
                }
                ac.signal.addEventListener('abort', () => resolve({ success: false }), { once: true })
              })
              const r = await Promise.race([fallbackPromise, abortPromise])
              if (!stillMine()) return { success: false }
              if ('fallbackUsed' in r) {
                rememberWorkingModel(r.usedProviderId, r.usedModel, r.fallbackUsed)
              }
              return {
                success: Boolean(r.success),
                content: 'content' in r ? r.content : undefined,
              }
            },
          })
          if (!stillMine()) throw new DOMException('Aborted', 'AbortError')
          finalReasoningSteps = reasoning.steps.map((s) => ({ ...s, collapsed: true }))

          const systemContext = [
            buildAssembledAgentContext(dawStore, state, userText, chatTurns, presetsBlock),
            formatMusicalSelectionForPrompt(getMusicalSelectionAnchor()),
            getToolRegistryPromptFragment(dawStore),
            buildAgentSystemPrompt(state, userText, agentMode, messages),
            midiAuditReport
              ? [
                  '## Informe técnico local (datos reales)',
                  midiAuditReport,
                  'Responde al usuario como productor usando estos datos. Si propones ACTIONS, que sean propuestas para Aplicar.',
                ].join('\n')
              : '',
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
            const finalAbort = new Promise<{ success: false; content?: string }>((resolve) => {
              if (ac.signal.aborted) {
                resolve({ success: false })
                return
              }
              ac.signal.addEventListener('abort', () => resolve({ success: false }), { once: true })
            })
            const finalChatPromise = aiChatWithFallback(
              (req) => window.electron!.aiChat!(req),
              [
                { role: 'system', content: systemContext },
                ...prior,
                { role: 'user', content: modelUser },
              ],
              {
                temperature: think ? Math.max(cfg.temperature, 0.55) : cfg.temperature,
                maxTokens: Math.max(cfg.maxTokens, think ? 16384 : 8192),
                settings: cfg,
                abort: ac.signal,
                onAttempt: ({ label, index, total }) => {
                  if (index === 0) setHarnessPhase(`Consultando ${label}…`)
                  else setHarnessPhase(`Modelo sin respuesta → ${label} (${index + 1}/${total})`)
                },
              },
            )
            const result = await Promise.race([finalChatPromise, finalAbort])
            if (!stillMine()) throw new DOMException('Aborted', 'AbortError')
            if ('fallbackUsed' in result) {
              rememberWorkingModel(result.usedProviderId, result.usedModel, result.fallbackUsed)
              if (result.fallbackUsed && result.usedModel) {
                setHarnessPhase(`Respondió con ${result.usedModel}`)
              }
            }

            if (result.success && result.content?.trim()) {
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
              const forceBuild =
                mustForceMusicBuild(userText) ||
                (isSongRefineIntent(userText) && !isTempoOnlyRefine(userText)) ||
                assistantAskedUserToWriteOptions(raw) ||
                messages.some(
                  (m) =>
                    m.clarifications?.status === 'answered' ||
                    m.clarifications?.status === 'skipped',
                )
              // Tras respuestas / créalo / refinar / ya aclarado: NUNCA otra ronda de preguntas
              if (forceBuild) clarifyQs = []

              const parsedPlan = parsePlanFromText(raw)
              if (parsedPlan) parsedPlanForDocs = parsedPlan
              if (parsedPlan && !actions.some((a) => a.type === 'daw.composeProject' || a.type === 'daw.musicBuild')) {
                if (wantsFullProject(userText) || forceBuild) {
                  const bpmHint =
                    inferBpmFromTempoIntent(userText, state.project?.bpm?.valor ?? 120) ??
                    parsedPlan.bpm
                  actions = [
                    {
                      type: 'daw.musicBuild',
                      payload: {
                        aplicar: true,
                        prompt: userText,
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
                actions = fallbackActionsFromUserIntent(userText, state, forceBuild ? 'create' : agentMode)
              }
              if (actions.length === 0 && forceBuild) {
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
                (wantsFullProject(userText) || resolvedMode === 'create') &&
                !forceBuild
              ) {
                // Una sola ronda de tarjeta; esperar Enviar respuestas
              } else if (actions.length === 0 && clarifyQs.length === 0 && wantsFullProject(userText)) {
                actions = fallbackActionsFromUserIntent(userText, state, 'create')
              }
              // Si el modelo inventó ACTIONS inválidas pero hay forceBuild, garantizar musicBuild
              if (forceBuild && !actions.some((a) => a.type === 'daw.musicBuild' || a.type === 'project.setBpm')) {
                const mins = extractMinutesFromClarifyText(userText)
                const genero = extractGenreFromClarifyText(userText)
                const bpm =
                  inferBpmFromTempoIntent(userText, state.project?.bpm?.valor ?? 120) ?? 72
                actions = [
                  { type: 'project.setBpm', payload: { bpm } },
                  {
                    type: 'daw.musicBuild',
                    payload: {
                      aplicar: true,
                      prompt: userText.slice(0, 1500),
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

              let text = stripProseClarifyLists(
                stripChecklistBlock(
                  raw
                    .replace(/<<<ACTIONS[\s\S]*?ACTIONS>>>/gi, '')
                    .replace(/<<<PLAN[\s\S]*?PLAN>>>/gi, '')
                    .replace(/<<<DOC[\s\S]*?DOC>>>/gi, ''),
                ),
              )
              if (
                isGarbageAssistantReply(text) &&
                (auditIntent || resolvedMode === 'ask' || isProjectAuditIntent(userText))
              ) {
                text = midiAuditReport || buildMidiAuditReport(state)
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
                const wantStepChecklist =
                  !modeBlocksMutation(modeForApply) &&
                  (modeForApply === 'create' || modeForApply === 'auto' || forceBuild)

                if (wantStepChecklist) {
                  const checklist =
                    parseChecklistFromText(raw) ?? buildChecklistFromActions(actions)
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
                  if (checklist) {
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
                      source: 'model_actions',
                    })
                    lastResults = out.results
                    docEdits = appendDocEdits(docEdits, out.results)
                    pendingActions = out.pendingActions
                    confirmActions = out.confirmActions
                    ranMutations = out.ranMutations
                    absorbTurnMeta(out, turnMeta)
                    actionsSummary = formatActionResultsForUser(resultsOrPending(out))
                    accumulated = text.trim() || 'Listo.'
                  }
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
                      ? 'Listo: propuesta de Music Build. Revisa el diff y pulsa Aplicar.'
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
              const forced = fallbackActionsFromUserIntent(userText, state, agentMode)
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
                  ? `El modelo no devolvió texto usable; dejé una propuesta lista para Construir.\n\n${actionsSummary}`
                  : `El modelo no devolvió texto usable; apliqué tu brief en el DAW.\n\n${actionsSummary}`
              } else {
                accumulated =
                  (auditIntent && midiAuditReport) ||
                  formatAiUserError({
                  error: result.error || 'No se pudo obtener respuesta del modelo.',
                  errorCode: result.errorCode as import('@/src/lib/ai-settings').AiErrorCode | undefined,
                  hint: result.hint,
                  provider: result.provider || provider.kind,
                })
              }
              setAiStatus(result.errorCode === 'missing_api_key' ? 'misconfigured' : 'offline')
              setStatusDetail([result.error, result.hint].filter(Boolean).join(' — '))
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Error de comunicación con el motor de IA'
            const forced = fallbackActionsFromUserIntent(userText, state, agentMode)
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

      // Tras auditoría: formulario + tarjeta Aplicar (dedupe) aunque el modelo solo haya razonado
      const auditRemediationEligible =
        (auditIntent || /Auditoría MIDI/i.test(accumulated) || Boolean(midiAuditReport)) &&
        !wantsAuditFix &&
        !isMidiAuditSkipFixReply(userText) &&
        !pendingActions &&
        !clarifications
      if (auditRemediationEligible) {
        const snap = dawStore.obtenerEstado()
        const qs = buildMidiAuditClarifications(snap)
        const fixes = buildMidiAuditFixActions(snap)
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
        if (auditIntent && midiAuditReport && !/Auditoría MIDI/i.test(accumulated)) {
          accumulated = [accumulated, midiAuditReport].filter(Boolean).join('\n\n')
        }
      }

      const sidechainAppliedPre = lastResults.some((r) => r.type === 'sidechain.connect' && r.success)
      if (!stillMine()) throw new DOMException('Aborted', 'AbortError')
      const certifyPre = ranMutations
        ? await runPostTurnCertifyPipeline(dawStore, lastResults, { sidechainApplied: sidechainAppliedPre })
        : null
      if (certifyPre) {
        const { toStoredCertify } = await import('@/src/lib/agent-turn-undo')
        turnCertify = toStoredCertify(certifyPre)
      }
      if (certifyPre && certifyPre.issues.length) {
        actionsSummary = [actionsSummary, `Certify: ${certifyPre.issues.slice(0, 3).join('; ')}`]
          .filter(Boolean)
          .join('\n')
      }
      turnUndoDepthAtStart = turnMeta.undo
      turnAppliedDiffSummary = turnMeta.diff
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
        Boolean(window.electron?.aiChat) &&
        !local &&
        !ac.signal.aborted &&
        ranMutations &&
        !modeBlocksMutation(resolvedMode) &&
        harnessReviewNeeded(lastResults) &&
        (firstReview.mutated || Boolean(firstReview.evaluation))
      if (canReview) {
        try {
          const cfg = loadAiSettings()
          const provider = getActiveProvider(cfg)
          const chatOnce = async (userContent: string) => {
            if (ac.signal.aborted) return { success: false as const, content: '' }
            const r = await window.electron!.aiChat!(
              toAiChatPayload(
                provider,
                [
                  { role: 'system', content: buildAgentSystemPrompt(dawStore.obtenerEstado(), userText, 'think', messages) },
                  { role: 'user', content: userContent },
                ],
                { temperature: Math.max(cfg.temperature, 0.35), maxTokens: Math.min(cfg.maxTokens, 8192) },
              ),
            )
            return { success: !!r.success, content: r.content }
          }

          setHarnessPhase('Inspeccionando el DAW…')
          const sidechainApplied = lastResults.some(
            (r) => r.type === 'sidechain.connect' && r.success,
          )
          const follow = await runHarnessFollowups({
            userText,
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
                const { formatLibraryPresetsForContext } = await import('@/src/lib/library/ops')
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

          if (!ac.signal.aborted && follow.stoppedReason !== 'aborted') {
          const afterState = dawStore.obtenerEstado()
          setHarnessPhase('Revisión vs plan.md…')
          const reviewUser = buildHarnessReviewMessage({
            userText,
            evalSummary: follow.evaluation?.summary || firstReview.evaluation?.summary || firstReview.extra,
            actionsSummary,
            projectId: afterState.project.id,
            evaluation: follow.evaluation ?? firstReview.evaluation,
          })
          const reviewResult = await window.electron.aiChat(
            toAiChatPayload(
              provider,
              [
                { role: 'system', content: buildAgentSystemPrompt(afterState, userText, 'think', messages) },
                { role: 'user', content: reviewUser },
              ],
              { temperature: Math.max(cfg.temperature, 0.4), maxTokens: Math.min(cfg.maxTokens, 8192) },
            ),
          )
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
      updateMessageContent(
        conversation.id,
        assistantMsgId,
        accumulated || '⚠️ Sin respuesta.',
        actionsSummary || undefined,
        midiPreview,
        projectPlan,
        musicBuild,
        pendingActions,
        confirmActions,
        finalReasoningSteps,
        docEdits.length ? docEdits : undefined,
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
    } catch (err: unknown) {
      const aborted =
        (err instanceof DOMException && err.name === 'AbortError') ||
        ac.signal.aborted ||
        myEpoch !== genEpochRef.current
      if (aborted) {
        updateMessageContent(conversation.id, assistantMsgId, '⏹ Ejecución detenida.')
        const after = getConversation(conversation.id)
        if (after) setConversation(after)
      } else {
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
        const after = getConversation(conversation.id)
        if (after) setConversation(after)
        setStatusDetail(message)
      }
    } finally {
      if (myEpoch === genEpochRef.current) {
        abortRef.current = null
        setHarnessPhase('')
        setIsGenerating(false)
        liveAssistantMsgIdRef.current = null
      }
    }
  }

  const runQuick = (label: string) => {
    setInputMessage(label)
    // Disparar envío en el siguiente tick con el texto ya en el input
    requestAnimationFrame(() => {
      const fake = label
      setInputMessage(fake)
      // Llamada directa reutilizando la lógica de envío
      void (async () => {
        if (isGenerating) return
        setInputMessage('')
        const userText = fake
        const userMsgId = newMsgId('user')
        const assistantMsgId = newMsgId('asst')
        appendMessage(conversation.id, { id: userMsgId, role: 'user', content: userText })
        appendMessage(conversation.id, { id: assistantMsgId, role: 'assistant', content: '' })
        const refreshed = getConversation(conversation.id)
        if (refreshed) setConversation(refreshed)
        refreshHistoryList()
        setIsGenerating(true)
        try {
          const state = dawStore.obtenerEstado()
          if (/crea|midi|piano|proyecto|plan/i.test(userText)) {
            const forced = fallbackActionsFromUserIntent(userText, state, agentMode)
            const resolvedMode = detectAgentMode(userText, agentMode)
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
                  ? `Music Build completado: ${musicBuild.spec.nombre}.`
                  : `Music Build listo: ${musicBuild.spec.tracks.length} pistas. Revisa las fases y ejecuta cuando quieras.`
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
              summary,
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
        } finally {
          setIsGenerating(false)
        }
      })()
    })
  }

  const statusBadge =
    aiStatus === 'online' ? (
      <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
        <Zap className="size-3" /> Online
      </span>
    ) : aiStatus === 'misconfigured' ? (
      <span
        className="flex max-w-[140px] items-center gap-1 truncate rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400"
        title={statusDetail}
      >
        <WifiOff className="size-3 shrink-0" /> Config
      </span>
    ) : (
      <span
        className="flex max-w-[140px] items-center gap-1 truncate rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
        title={statusDetail || 'Proveedor offline'}
      >
        <WifiOff className="size-3 shrink-0" /> Off
      </span>
    )

  return (
    <aside
      data-shortcut-scope="ignore"
      className="relative flex h-full w-full min-w-0 flex-col bg-panel"
    >
      <header className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2.5">
          <JasWaveLogo className="h-10 w-auto max-w-[120px] shrink-0" alt="Asistente Jas" />
          <div className="min-w-0 flex-1 truncate">
            <h2 className="truncate text-[13px] font-semibold text-foreground">Asistente Jas</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {projectName} • {trackCount} pistas
            </p>
          </div>
          <div className="flex items-center gap-1">
            {statusBadge}
            <button
              type="button"
              title="Historial de chats"
              onClick={() => {
                refreshHistoryList()
                setHistoryOpen((v) => !v)
              }}
              className={`rounded p-1.5 ${historyOpen ? 'bg-panel-raised text-foreground' : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'}`}
            >
              <History className="size-4" />
            </button>
            <button
              type="button"
              title="Nueva conversación"
              onClick={startNewChat}
              className="rounded p-1.5 text-muted-foreground hover:bg-panel-raised hover:text-foreground"
            >
              <MessageSquarePlus className="size-4" />
            </button>
          </div>
        </div>
        <AiModelPicker compact />
      </header>

      {historyOpen && (
        <div className="absolute inset-x-0 top-[52px] z-30 max-h-[50%] overflow-y-auto border-b border-border bg-panel shadow-xl">
          <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-muted-foreground">
            <span>Historial</span>
            <button type="button" className="text-accent-amber hover:underline" onClick={startNewChat}>
              + Nuevo
            </button>
          </div>
          {conversations.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">Sin conversaciones aún</div>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={`flex items-center gap-1 border-b border-border/40 px-2 py-1.5 ${
                  c.id === conversation.id ? 'bg-accent-amber/10' : 'hover:bg-panel-raised/60'
                }`}
              >
                <button
                  type="button"
                  onClick={() => switchConversation(c.id)}
                  className="min-w-0 flex-1 truncate text-left text-[12px] text-foreground"
                >
                  {c.title}
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    {c.messages.length} msgs
                  </span>
                </button>
                <button
                  type="button"
                  title="Eliminar"
                  onClick={() => removeChat(c.id)}
                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
          <AiAuditPanel />
        </div>
      )}

      {statusDetail && aiStatus !== 'online' ? (
        <div className="border-b border-border bg-destructive/10 px-3 py-2 text-[11px] text-destructive" role="alert">
          {statusDetail}
        </div>
      ) : null}
      {isGenerating && harnessPhase ? (
        <div className="flex items-center gap-2 border-b border-border bg-accent-amber/10 px-3 py-1.5 text-[11px] text-accent-amber">
          <Loader2 className="size-3 shrink-0 animate-spin" />
          <span className="min-w-0 truncate">{harnessPhase}</span>
        </div>
      ) : null}

      <div
        data-coproducer-chat
        data-chat-selectable
        className="flex-1 space-y-4 overflow-y-auto p-4 select-text"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center text-muted-foreground">
            <JasWaveLogo className="mb-3 h-28 w-auto max-w-[220px]" alt="JasWave" />
            <h3 className="mb-1 text-[14px] font-semibold text-foreground">Asistente Jas</h3>
            <p className="max-w-[280px] text-[12px]">
              Puedo planear o crear el proyecto: pistas, VSTs y MIDI. Escribe @ para ver pistas, clips, plugins y acciones.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {[
                'Resumen del proyecto',
                'Haz un plan de un tema pop desde cero',
                'Crea un clip MIDI en la pista seleccionada',
              ].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void runQuick(s)}
                  className="rounded-full border border-border bg-panel-raised px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-accent-amber hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg: StoredChatMessage) => {
            const canCopy = Boolean(formatMessageForCopy(msg).trim())
            const copied = copiedMsgId === msg.id
            return (
            <div
              key={msg.id}
              className={`group flex gap-2 text-[13px] ${msg.role === 'user' ? 'justify-end' : 'justify-start'} ${
                citedIds.includes(msg.id) ? 'rounded-md ring-1 ring-accent-amber/60' : ''
              }`}
            >
              {msg.role === 'assistant' && (
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel-raised ring-1 ring-border">
                  <JasWaveLogo className="size-7" alt="Asistente Jas" />
                </div>
              )}
              <div
                className={`flex max-w-[85%] min-w-0 flex-col gap-0.5 ${
                  msg.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
              <div
                data-chat-selectable
                className={`select-text rounded-lg px-3 py-2 leading-relaxed ${
                  msg.role === 'user'
                    ? 'cursor-text rounded-br-none bg-accent text-accent-foreground'
                    : 'cursor-text rounded-bl-none border border-border bg-panel-raised text-foreground'
                }`}
              >
                {msg.reasoningSteps?.length ? (
                  <ReasoningStepsPanel
                    steps={msg.reasoningSteps}
                    defaultOpen={isGenerating && msg.id === messages.at(-1)?.id}
                  />
                ) : null}
                {msg.content ? (
                  <ChatMarkdown text={msg.content} />
                ) : isGenerating && msg.role === 'assistant' ? (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> {harnessPhase || 'Trabajando en el DAW…'}
                  </span>
                ) : null}
                {msg.docEdits?.length ? <DocEditCards edits={msg.docEdits} /> : null}
                {msg.citedMessageIds?.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {msg.citedMessageIds.map((id) => {
                      const src = messages.find((m) => m.id === id)
                      return (
                        <span
                          key={id}
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            msg.role === 'user'
                              ? 'bg-background/15 text-accent-foreground/80'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {src ? messagePreview(src.content, 28) : 'mensaje citado'}
                        </span>
                      )
                    })}
                  </div>
                ) : null}
                {msg.actionsSummary ? (
                  <div className="mt-2 border-t border-border/60 pt-2 text-[11px] text-emerald-400/90">
                    <ChatMarkdown text={msg.actionsSummary} />
                  </div>
                ) : null}
                {msg.clarifications?.questions?.length ? (
                  <ClarificationCard
                    questions={msg.clarifications.questions as ClarificationQuestion[]}
                    status={msg.clarifications.status}
                    onSubmit={(answers, formCustom) => {
                      patchMessage(conversation.id, msg.id, {
                        clarifications: {
                          ...msg.clarifications!,
                          status: 'answered',
                        },
                      })
                      void handleSendMessage(
                        formatClarificationAnswersForPrompt(
                          msg.clarifications!.questions as ClarificationQuestion[],
                          answers,
                          formCustom,
                        ),
                      )
                    }}
                    onSkip={() => {
                      patchMessage(conversation.id, msg.id, {
                        clarifications: {
                          ...msg.clarifications!,
                          status: 'skipped',
                        },
                      })
                      void handleSendMessage(
                        'Usa defaults razonables según el plan y mi pedido. Emite <<<ACTIONS>>> ahora (propuesta para Aplicar). No preguntes más.',
                      )
                    }}
                  />
                ) : null}
                {msg.agentChecklist?.items?.length ? (
                  <AgentChecklistCard
                    conversationId={conversation.id}
                    messageId={msg.id}
                    checklist={msg.agentChecklist}
                    agentMode={agentMode}
                    onChange={() => {
                      const after = getConversation(conversation.id)
                      if (after) setConversation(after)
                    }}
                  />
                ) : null}
                {msg.pendingActions ? (
                  <PendingActionsCard
                    conversationId={conversation.id}
                    messageId={msg.id}
                    cardId={`pending-actions-${msg.id}`}
                    actions={msg.pendingActions.actions}
                    agentMode={msg.pendingActions.agentMode}
                    status={msg.pendingActions.status}
                    previewDiff={msg.pendingActions.previewDiff}
                    previewSummary={msg.pendingActions.previewSummary}
                    actionStatuses={msg.pendingActions.actionStatuses}
                    checklistStepId={msg.pendingActions.checklistStepId}
                    onDone={() => {
                      const after = getConversation(conversation.id)
                      if (after) setConversation(after)
                    }}
                  />
                ) : null}
                {msg.appliedDiffSummary && !msg.pendingActions ? (
                  <div className="mt-2 rounded-md border border-emerald-900/40 bg-emerald-950/20 px-2.5 py-1.5 text-[11px] text-emerald-300/90">
                    {msg.appliedDiffSummary}
                  </div>
                ) : null}
                {msg.certify ? <TurnCertifyBadges certify={msg.certify} /> : null}
                {msg.role === 'assistant' && (msg.undoDepthAtStart != null || msg.reverted) ? (
                  <RevertTurnButton
                    conversationId={conversation.id}
                    messageId={msg.id}
                    undoDepthAtStart={msg.undoDepthAtStart}
                    reverted={msg.reverted}
                    onDone={() => {
                      const after = getConversation(conversation.id)
                      if (after) setConversation(after)
                    }}
                  />
                ) : null}
                {msg.confirmActions ? (
                  <DestructiveConfirmCard
                    conversationId={conversation.id}
                    messageId={msg.id}
                    actions={msg.confirmActions.actions}
                    reason={msg.confirmActions.reason}
                    status={msg.confirmActions.status}
                    onDone={() => {
                      const after = getConversation(conversation.id)
                      if (after) setConversation(after)
                    }}
                  />
                ) : null}
                {msg.role === 'assistant' ? <AiAuditPanel messageId={msg.id} compact /> : null}
                {msg.midiPreview ? (
                  <MidiGenerationPreview
                    preview={msg.midiPreview}
                    status={msg.midiPreview.status ?? 'pending'}
                  />
                ) : null}
                {msg.projectPlan ? (
                  <ProjectPlanPreview
                    plan={msg.projectPlan}
                    status={msg.projectPlan.status ?? 'pending'}
                  />
                ) : null}
                {msg.musicBuild ? (
                  <MusicBuildPreview
                    build={msg.musicBuild}
                    status={msg.musicBuild.applied ? 'applied' : 'pending'}
                  />
                ) : null}
              </div>
              {canCopy ? (
                <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  title={copied ? 'Copiado' : 'Copiar mensaje completo (incluye razonamiento)'}
                  aria-label={copied ? 'Mensaje copiado' : 'Copiar mensaje completo'}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => void copyChatMessage(msg)}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-panel-raised hover:text-foreground"
                >
                  {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
                <button
                  type="button"
                  title="Citar este mensaje (el hilo actual se conserva)"
                  aria-label="Citar mensaje"
                  onClick={() => citeMessage(msg)}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] hover:bg-panel-raised hover:text-foreground ${
                    citedIds.includes(msg.id) ? 'text-accent-amber' : 'text-muted-foreground'
                  }`}
                >
                  <Quote className="size-3" />
                  Citar
                </button>
                </div>
              ) : null}
              </div>
              {msg.role === 'user' && (
                <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <User className="size-3.5" />
                </div>
              )}
            </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {pendingProposal ? (
        <div className="flex items-center gap-2 border-t border-accent-amber/40 bg-accent-amber/10 px-3 py-2">
          <GitCompare className="size-3.5 shrink-0 text-accent-amber" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
            Hay {pendingProposal.count} cambio{pendingProposal.count === 1 ? '' : 's'} por aprobar
          </span>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent-amber/50 px-2 py-1 text-[10px] font-medium text-accent-amber hover:bg-accent-amber/15"
            onClick={() => {
              const el = document.getElementById(pendingProposal.cardId)
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }}
          >
            Ver propuesta
          </button>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-amber px-2 py-1 text-[10px] font-semibold text-background"
            onClick={() => {
              const el = document.getElementById(pendingProposal.cardId)
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              requestAnimationFrame(() => {
                const applyBtn = Array.from(el?.querySelectorAll('button') ?? []).find((b) =>
                  /Aplicar seleccionadas/i.test(b.textContent ?? ''),
                )
                applyBtn?.click()
              })
            }}
          >
            <Hammer className="size-3" />
            Aplicar
          </button>
        </div>
      ) : null}

      <div className="relative border-t border-border p-3">
        {citedMessages.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {citedMessages.map((m) => (
              <span
                key={m.id}
                className="flex max-w-full items-center gap-1 rounded-full border border-accent-amber/40 bg-accent-amber/10 px-2 py-0.5 text-[10px] text-accent-amber"
              >
                <Quote className="size-2.5 shrink-0" />
                <span className="truncate">
                  {m.role === 'user' ? 'Tú' : 'Jas'}: {messagePreview(m.content, 36)}
                </span>
                <button
                  type="button"
                  aria-label="Quitar cita"
                  title="Quitar cita"
                  onClick={() => setCitedIds((ids) => ids.filter((id) => id !== m.id))}
                  className="rounded-full p-0.5 hover:bg-accent-amber/20"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {mentionQuery != null ? (
          <div className="absolute inset-x-3 bottom-full z-20 mb-1 max-h-64 overflow-y-auto rounded-md border border-border bg-panel-raised shadow-lg">
            {mentionHits.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">Sin coincidencias</div>
            ) : (
              mentionGroups.map((g) => (
                <div key={g.kind}>
                  <div className="sticky top-0 bg-panel-raised px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.label}
                  </div>
                  {g.items.map((item) => {
                    const flatIndex = mentionHits.indexOf(item)
                    const active = flatIndex === mentionIndex
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          insertMention(item)
                        }}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] ${
                          active ? 'bg-accent-amber/20' : 'hover:bg-accent-amber/15'
                        }`}
                      >
                        <span className="truncate text-foreground">
                          {item.kind === 'action' || item.kind === 'mode' || item.kind === 'message'
                            ? item.label
                            : `@${item.label}`}
                        </span>
                        <span className="max-w-[45%] shrink-0 truncate text-[10px] text-muted-foreground">
                          {item.hint}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setMentionQuery(null)
            void handleSendMessage()
          }}
          className="flex flex-col gap-1.5"
        >
          {selectionLabel ? (
            <div className="flex items-center gap-2 rounded-md bg-accent-amber/10 px-2 py-1 text-[11px] text-foreground ring-1 ring-accent-amber/40">
              <Quote className="size-3 shrink-0 text-accent-amber" />
              <span className="min-w-0 flex-1 truncate" title={selectionLabel}>
                Contexto: {selectionLabel}
              </span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title="Quitar selección del contexto"
                onClick={() => {
                  clearMusicalSelectionAnchor()
                  setSelectionLabel('')
                  setInputMessage((prev) => prev.replace(/\[selección:[^\]]*\]\s*/g, ''))
                }}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}
          <div className="flex items-end gap-2 rounded-lg bg-panel-raised px-2 py-2 ring-1 ring-border focus-within:ring-2 focus-within:ring-ring">
          <AgentModePicker value={agentMode} onChange={setAgentMode} />
          <textarea
            ref={inputRef}
            rows={1}
            value={inputMessage}
            onChange={(e) => onInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyUp={(e) => onInputChange(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setMentionQuery(null)
                if (isGenerating) stopGeneration()
              }
              if (e.key === 'Enter' && !e.shiftKey && mentionQuery == null) {
                e.preventDefault()
                setMentionQuery(null)
                void handleSendMessage()
                return
              }
              if (mentionQuery != null && mentionHits.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setMentionIndex((i) => Math.min(mentionHits.length - 1, i + 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setMentionIndex((i) => Math.max(0, i - 1))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  insertMention(mentionHits[mentionIndex] ?? mentionHits[0]!)
                } else if (e.key === 'Tab') {
                  e.preventDefault()
                  insertMention(mentionHits[mentionIndex] ?? mentionHits[0]!)
                }
              }
            }}
            disabled={isGenerating}
            placeholder="Pide un clip, o @ / Ctrl+L selección… (Shift+Enter nueva línea)"
            className="max-h-40 min-h-[2rem] flex-1 resize-none bg-transparent py-1 text-[13px] leading-snug text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          {isGenerating ? (
            <button
              type="button"
              onClick={stopGeneration}
              aria-label="Detener agente"
              title="Detener"
              className="flex size-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-opacity hover:opacity-90"
            >
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputMessage.trim()}
              aria-label="Enviar mensaje"
              className="flex size-7 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
          </div>
        </form>
      </div>
    </aside>
  )
}
