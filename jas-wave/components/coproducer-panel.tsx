import {
  ArrowUp,
  Check,
  Copy,
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
import { useState, useRef, useEffect, useCallback } from 'react'
import { useDAWState, useDAW } from '@/src/context/daw-context'
import { answerLocalReadQuery } from '@/src/lib/ai-read-context'
import {
  loadAiSettings,
  getActiveProvider,
  formatAiUserError,
  toAiChatPayload,
  toAiHealthPayload,
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
} from '@/src/lib/ai-daw-agent'
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
import {
  AGENT_MODE_META,
  detectAgentMode,
  loadAgentMode,
  saveAgentMode,
  wantsFullProject,
  type AgentMode,
} from '@/src/lib/ai-modes'
import { specToProjectPlan } from '@/src/lib/music-build'
import type { MusicBuildResult } from '@/src/lib/music-build/types'
import {
  ensureActiveConversation,
  listConversations,
  createConversation,
  deleteConversation,
  setActiveConversationId,
  appendMessage,
  updateMessageContent,
  getConversation,
  type ChatConversation,
  type StoredChatMessage,
} from '@/src/lib/ai-chat-store'
import { JasWaveLogo } from '@/components/brand'
import { ChatMarkdown } from '@/components/chat-markdown'
import type { DAWState } from '../../shared/src/types/state'
import { applyMarkdownDocsFromModel, bindAgentDocsDisk } from '@/src/lib/agent-docs'
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

function finishAgentTurn(
  projectId: string,
  state: DAWState,
  results: ActionResult[],
  modelText?: string,
  opts?: { preferModelEval?: boolean },
): { extra: string; evaluation: PlanEvaluation | null; mutated: boolean } {
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
      ensurePlanFromCompose(projectId, specToProjectPlan(build.spec, build.applied))
    } else {
      ensurePlanFromCompose(projectId, planHit.data as import('@/src/lib/project-plan').ProjectPlanData)
    }
  }
  const skipSync = new Set(['doc.list', 'doc.read', 'doc.evaluate'])
  const mutated = results.some((r) => r.success && !skipSync.has(r.type))
  let extra = ''
  let evaluation: PlanEvaluation | null = null
  const applyDocs = () => {
    const written = modelText ? applyMarkdownDocsFromModel(projectId, modelText) : []
    if (written.length) extra = [extra, `Docs: ${written.join(', ')}`].filter(Boolean).join('\n')
    return written
  }
  if (opts?.preferModelEval) {
    if (mutated) {
      evaluation = syncPlanAfterDawChange(projectId, state)
      if (evaluation?.summary) extra = [extra, evaluation.summary].filter(Boolean).join('\n')
    }
    applyDocs()
  } else {
    applyDocs()
    if (mutated) {
      evaluation = syncPlanAfterDawChange(projectId, state)
      if (evaluation?.summary) extra = [extra, evaluation.summary].filter(Boolean).join('\n')
    }
  }
  if (extra || planHit || evaluation) requestOpenTool('docs', { zone: 'left' })
  return { extra, evaluation, mutated }
}

function pickMusicBuild(results: ActionResult[]): MusicBuildResult | undefined {
  const hit = results.find(
    (r) => r.type === 'daw.musicBuild' && (r.data as { kind?: string } | undefined)?.kind === 'musicBuild',
  )
  return hit?.data as MusicBuildResult | undefined
}

export function CoProducerPanel() {
  const [inputMessage, setInputMessage] = useState('')
  const [conversation, setConversation] = useState<ChatConversation>(() => ensureActiveConversation())
  const [historyOpen, setHistoryOpen] = useState(false)
  const [conversations, setConversations] = useState<ChatConversation[]>(() => listConversations())
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
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dawStore = useDAW()
  const projectName = useDAWState((state) => state.project?.nombre || 'Nuevo Proyecto')
  const trackCount = useDAWState((state) => state.project?.tracks?.length ?? 0)
  const messages = conversation.messages.filter((m) => m.role === 'user' || m.role === 'assistant')
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
    setConversations(listConversations())
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isGenerating])

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
    if (!c) return
    setActiveConversationId(id)
    setConversation(c)
    setHistoryOpen(false)
  }

  const startNewChat = () => {
    const c = createConversation()
    setActiveConversationId(c.id)
    setConversation(c)
    refreshHistoryList()
    setHistoryOpen(false)
  }

  const removeChat = (id: string) => {
    deleteConversation(id)
    if (conversation.id === id) {
      const next = ensureActiveConversation()
      setConversation(next)
    }
    refreshHistoryList()
  }

  const stopGeneration = () => {
    abortRef.current?.abort()
  }

  const copyChatMessage = async (msg: StoredChatMessage) => {
    const text = [msg.content, msg.actionsSummary].filter((p) => p?.trim()).join('\n\n')
    if (!text.trim()) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    setCopiedMsgId(msg.id)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => {
      setCopiedMsgId((id) => (id === msg.id ? '' : id))
      copiedTimerRef.current = null
    }, 1600)
  }

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isGenerating) return

    const userText = inputMessage.trim()
    const stateForCite = dawStore.obtenerEstado()
    const cited = collectCitedMessages(userText, citedIds, stateForCite, messages)
    setInputMessage('')
    setCitedIds([])
    const ac = new AbortController()
    abortRef.current = ac
    setHarnessPhase('Trabajando en el DAW…')

    const userMsgId = newMsgId('user')
    const assistantMsgId = newMsgId('asst')

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

      if (!local) {
        if (!window.electron?.aiChat) {
          // Sin Electron: si pide crear, ejecutamos igual en el DAW local
          const forced = fallbackActionsFromUserIntent(userText, state, agentMode)
          if (forced.length) {
            const results = await executeDawActions(dawStore, forced)
            lastResults = results
            actionsSummary = formatActionResultsForUser(results)
            accumulated = [
              'He aplicado los cambios directamente en JasWave (sin modelo remoto).',
              actionsSummary,
            ].join('\n\n')
          } else {
            accumulated =
              answerLocalReadQuery(state, userText) ??
              formatAiUserError({
                error: 'No hay modelo remoto disponible.',
                errorCode: 'not_available',
                hint: 'Abre Electron o configura un proveedor en Ajustes → IA.',
                provider: getActiveProvider().kind,
              })
          }
        } else {
          const cfg = loadAiSettings()
          const provider = getActiveProvider(cfg)
          const systemContext = buildAgentSystemPrompt(state, userText, agentMode, messages)
          const resolvedMode = detectAgentMode(userText, agentMode)
          const think = resolvedMode === 'think'
          const modelUser = formatUserTurnWithCitations(userText, cited)
          const prior = historyWithCitedPins(refreshed?.messages ?? messages, cited, [
            assistantMsgId,
            userMsgId,
          ])

          try {
            const result = await window.electron.aiChat(
              toAiChatPayload(
                provider,
                [
                  { role: 'system', content: systemContext },
                  ...prior,
                  { role: 'user', content: modelUser },
                ],
                { temperature: think ? Math.max(cfg.temperature, 0.55) : cfg.temperature, maxTokens: Math.max(cfg.maxTokens, think ? 16384 : 8192) },
              ),
            )

            if (result.success && result.content?.trim()) {
              const raw = result.content
              modelRaw = raw
              let actions = parseActionsFromText(raw)
              const parsedPlan = parsePlanFromText(raw)
              if (parsedPlan && !actions.some((a) => a.type === 'daw.composeProject' || a.type === 'daw.musicBuild')) {
                if (wantsFullProject(userText)) {
                  actions = [
                    {
                      type: 'daw.musicBuild',
                      payload: {
                        aplicar: resolvedMode === 'create',
                        prompt: userText,
                        nombre: parsedPlan.nombre,
                        bpm: parsedPlan.bpm,
                        minutos: parsedPlan.minutes,
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
              if (actions.length === 0) {
                actions = fallbackActionsFromUserIntent(userText, state, agentMode)
              }

              let text = stripActionsBlock(raw)
              if (actions.length > 0) {
                const results = await executeDawActions(dawStore, actions)
                lastResults = results
                actionsSummary = formatActionResultsForUser(results)
                if (!text.trim() || /ableton|logic pro|no puedo generar|<<<ACTIONS/i.test(text)) {
                  text = 'Listo — cambios aplicados en JasWave.'
                }
                // Texto limpio; el resumen de acciones va aparte (actionsSummary), no duplicado
                accumulated = text
              } else {
                accumulated = text || 'Hecho.'
              }
              setAiStatus('online')
              setStatusDetail('')
            } else {
              // Si el modelo falla pero el usuario pidió crear, igual generamos desde el brief
              const forced = fallbackActionsFromUserIntent(userText, state, agentMode)
              if (forced.length) {
                const results = await executeDawActions(dawStore, forced)
                lastResults = results
                actionsSummary = formatActionResultsForUser(results)
                accumulated = `El modelo no devolvió texto usable; apliqué tu brief en el DAW.\n\n${actionsSummary}`
              } else {
                accumulated = formatAiUserError({
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
              const results = await executeDawActions(dawStore, forced)
              lastResults = results
              actionsSummary = formatActionResultsForUser(results)
              accumulated = 'Hubo un error de red con el modelo; apliqué la generación en el DAW.'
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

      const firstReview = finishAgentTurn(
        dawStore.obtenerEstado().project.id,
        dawStore.obtenerEstado(),
        lastResults,
        modelRaw,
      )
      if (firstReview.extra) {
        actionsSummary = [actionsSummary, firstReview.extra].filter(Boolean).join('\n')
      }

      const canReview =
        Boolean(window.electron?.aiChat) &&
        !local &&
        !ac.signal.aborted &&
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
          const follow = await runHarnessFollowups({
            userText,
            initialResults: lastResults,
            evaluation: firstReview.evaluation,
            actionsSummary,
            projectId: dawStore.obtenerEstado().project.id,
            abort: ac.signal,
            chat: chatOnce,
            parseActions: parseActionsFromText,
            execute: (actions) => executeDawActions(dawStore, actions),
            getState: () => dawStore.obtenerEstado(),
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
          })
          lastResults = follow.results
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
              reviewResults = await executeDawActions(dawStore, reviewActions)
              lastResults = [...lastResults, ...reviewResults]
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
          }
          }
        } catch {
          /* la revisión es best-effort; el primer turno ya aplicó cambios */
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
      )
      const after = getConversation(conversation.id)
      if (after) setConversation(after)
      refreshHistoryList()
    } catch (err: unknown) {
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
    } finally {
      abortRef.current = null
      setHarnessPhase('')
      setIsGenerating(false)
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
            const results = await executeDawActions(dawStore, forced)
            const firstReview = finishAgentTurn(
              dawStore.obtenerEstado().project.id,
              dawStore.obtenerEstado(),
              results,
            )
            const summary = [formatActionResultsForUser(results), firstReview.extra].filter(Boolean).join('\n')
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
                : midiPreview
                  ? midiPreview.status === 'applied'
                    ? `Clip aplicado: ${midiPreview.keyLabel}.`
                    : 'Vista previa lista en el chat. Escucha y aplica cuando quieras.'
                  : ['He creado el material en el arrange de JasWave.', summary].join('\n\n'),
              summary,
              midiPreview,
              projectPlan,
              musicBuild,
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
    <aside className="relative flex h-full w-full min-w-0 flex-col bg-panel">
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
        <div className="flex flex-wrap gap-1">
          {(['auto', 'plan', 'create', 'think'] as AgentMode[]).map((m) => {
            const label = m === 'auto' ? 'Auto' : AGENT_MODE_META[m].label
            const title = m === 'auto' ? 'Elige plan, crear o pensar según el mensaje' : AGENT_MODE_META[m].hint
            return (
              <button
                key={m}
                type="button"
                title={title}
                onClick={() => {
                  setAgentMode(m)
                  saveAgentMode(m)
                }}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  agentMode === m
                    ? 'bg-accent-amber/20 text-accent-amber'
                    : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
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

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
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
            const canCopy = Boolean(msg.content?.trim() || msg.actionsSummary?.trim())
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
                className={`rounded-lg px-3 py-2 leading-relaxed ${
                  msg.role === 'user'
                    ? 'rounded-br-none bg-accent text-accent-foreground'
                    : 'rounded-bl-none border border-border bg-panel-raised text-foreground'
                }`}
              >
                {msg.content ? (
                  <ChatMarkdown text={msg.content} />
                ) : isGenerating && msg.role === 'assistant' ? (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> {harnessPhase || 'Trabajando en el DAW…'}
                  </span>
                ) : null}
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
                  title={copied ? 'Copiado' : 'Copiar mensaje'}
                  aria-label={copied ? 'Mensaje copiado' : 'Copiar mensaje'}
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
          className="flex items-center gap-2 rounded-lg bg-panel-raised px-3 py-2 ring-1 ring-border focus-within:ring-2 focus-within:ring-ring"
        >
          <input
            ref={inputRef}
            value={inputMessage}
            onChange={(e) => onInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyUp={(e) => onInputChange(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setMentionQuery(null)
                if (isGenerating) stopGeneration()
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
            placeholder="Pide un clip, o @ para pista / plugin / mensaje…"
            className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
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
        </form>
      </div>
    </aside>
  )
}
