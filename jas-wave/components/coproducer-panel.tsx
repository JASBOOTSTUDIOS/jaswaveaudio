import {
  ArrowUp,
  Check,
  Copy,
  Loader2,
  Quote,
  Square,
  X,
  Zap,
  WifiOff,
  History,
  Trash2,
  MessageSquarePlus,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useDAWState, useDAW } from '@/src/context/daw-context'
import {
  loadAiSettings,
  getActiveProvider,
  toAiHealthPayload,
} from '@/src/lib/ai-settings'
import { ensureTerminalAuditMirror } from '@/src/lib/daw-terminal-sessions'
import {
  ASK_AI_SELECTION_EVENT,
  clearMusicalSelectionAnchor,
  getMusicalSelectionAnchor,
  selectionChipInsertText,
  selectionHasContext,
  subscribeMusicalSelection,
  type AskAiSelectionDetail,
} from '@/src/lib/ai-selection-context'
import { formatClarificationAnswersForPrompt, type ClarificationQuestion } from '@/src/lib/ai-clarify'
import { agentModeLabel, loadAgentMode, nextAgentMode, resolveMode, saveAgentMode, type AgentMode } from '@/src/lib/ai-modes'
import { endCoproducerSession, startCoproducerSession } from '@/src/lib/agent-context-bridge'
import { ensureToolRegistryContext } from '@/src/lib/agent-tool-bridge'
import { cancelAgentJobs } from '@/src/lib/agent-job-queue'
import {
  findInterruptedRuns,
  getAgentEngine,
  registerCoproducerJobRunner,
  startCoproducerTurn,
  type EngineEvent,
} from '@/src/lib/agent-engine-host'
import type { AgentBudget, AgentBudgetUsage, EngineRun, TurnHandle } from '@jaswave/ai-harness'
import { PendingActionsCard } from '@/components/pending-actions-card'
import { AgentChecklistCard } from '@/components/agent-checklist-card'
import { ClarificationCard } from '@/components/clarification-card'
import { RevertTurnButton, TurnCertifyBadges } from '@/components/turn-verify-ui'
import { DestructiveConfirmCard } from '@/components/destructive-confirm-card'
import { AiAuditPanel } from '@/components/ai-audit-panel'
import { AgentMessageToolLog } from '@/components/agent-tool-log'
import { MidiGenerationPreview } from '@/components/midi-generation-preview'
import { MidiClipMdPreview } from '@/components/midi-clip-md-preview'
import { ProjectPlanPreview } from '@/components/project-plan-preview'
import { MusicBuildPreview } from '@/components/music-build-preview'
import { AiModelPicker } from '@/components/ai-model-picker'
import {
  collectCitedMessages,
  filterMentionables,
  groupMentionables,
  listMentionables,
  MAX_CITED_MESSAGES,
  mentionDraftAtCaret,
  messagePreview,
  type Mentionable,
} from '@/src/lib/ai-mentions'
import { copyTextToClipboard } from '@/src/lib/copy-text'
import {
  ensureActiveConversation,
  listConversations,
  openConversation,
  createConversation,
  deleteConversation,
  setActiveConversationId,
  setChatProjectScope,
  patchMessage,
  getConversation,
  type ChatConversation,
  type StoredChatMessage,
} from '@/src/lib/ai-chat-store'
import { AgentModePicker } from '@/components/agent-mode-picker'
import { ReasoningStepsPanel } from '@/components/reasoning-steps-panel'
import { JasWaveLogo } from '@/components/brand'
import { ChatMarkdown, sanitizeAssistantMarkdown } from '@/components/chat-markdown'
import {
  bumpChatTextZoom,
  getChatTextZoom,
  setChatPanelMounted,
  setChatTextZoom,
  subscribeChatTextZoom,
} from '@/src/lib/chat-ui-store'
import { DocEditCards } from '@/components/doc-edit-card'
import { requestOpenTool } from '@/src/workspace/types'
import { setAgentRuntimePhase } from '@/src/lib/agent-runtime-phase'

/** Texto en streaming sin bloques de protocolo (<<<ACTIONS …>>>, etc.). */
function stripProtocolForStream(text: string): string {
  return text.replace(/<<<[A-Z]+[\s\S]*?(?:[A-Z]+>>>|$)/g, '').trim()
}

function chatTitle(c: ChatConversation): string {
  if (c.title && c.title !== 'Nueva conversación' && c.title !== 'Chat') return c.title
  const user = c.messages.find((m) => m.role === 'user' && m.content.trim())
  const t = user?.content.trim() ?? ''
  if (!t) return 'Nueva conversación'
  return t.length > 48 ? `${t.slice(0, 48)}…` : t
}

function chatWhen(ts: number): string {
  const d = Date.now() - ts
  if (d < 60_000) return 'ahora'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h`
  return new Date(ts).toLocaleDateString()
}

/** Texto plano completo de un mensaje (razonamiento + respuesta + acciones). */
function formatMessageForCopy(msg: StoredChatMessage): string {
  const parts: string[] = []
  if (msg.reasoningSteps?.length) {
    parts.push('--- Razonamiento ---')
    for (const step of msg.reasoningSteps) {
      const body = sanitizeAssistantMarkdown(step.content ?? '').trim()
      if (!body) continue
      parts.push(`${step.title}\n${body}`.trim())
    }
  }
  if (msg.content?.trim()) parts.push(sanitizeAssistantMarkdown(msg.content).trim())
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
  /** A5: consumo del presupuesto del turno en curso (evento `budget` del motor). */
  const [turnBudget, setTurnBudget] = useState<{ usage: AgentBudgetUsage; budget: AgentBudget } | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [agentMode, setAgentMode] = useState<AgentMode>(() => loadAgentMode())
  /** Modo con el que corre (o corrió) el turno activo: indicador en el timeline. */
  const [activeTurnMode, setActiveTurnMode] = useState<AgentMode | null>(null)
  const [harnessPhase, setHarnessPhase] = useState('')
  const [copiedMsgId, setCopiedMsgId] = useState('')
  const [copiedAll, setCopiedAll] = useState(false)
  const [citedIds, setCitedIds] = useState<string[]>([])
  const [selectionLabel, setSelectionLabel] = useState(() => getMusicalSelectionAnchor()?.label ?? '')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRootRef = useRef<HTMLElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeRunRef = useRef<string | null>(null)
  const [streamText, setStreamText] = useState('')
  const [interruptedRun, setInterruptedRun] = useState<EngineRun | null>(null)
  /** Incrementa al detener para invalidar turnos en vuelo. */
  const genEpochRef = useRef(0)
  const liveAssistantMsgIdRef = useRef<string | null>(null)
  const handleSendRef = useRef<(override?: string) => void>(() => {})
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatTextZoom = useSyncExternalStore(subscribeChatTextZoom, getChatTextZoom, getChatTextZoom)
  const chatFontPx = Math.round(13 * chatTextZoom)

  useEffect(() => {
    setChatPanelMounted(true)
    ensureTerminalAuditMirror()
    return () => setChatPanelMounted(false)
  }, [])

  useEffect(() => {
    setAgentRuntimePhase(isGenerating ? harnessPhase : '')
  }, [isGenerating, harnessPhase])

  useEffect(() => () => setAgentRuntimePhase(''), [])

  /** Ctrl/Cmd + / - / 0: zoom tipográfico solo del chat (como Docs). */
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const root = panelRootRef.current
      if (!root) return
      const undockChat =
        new URLSearchParams(window.location.search).get('undock') === 'coproducer' ||
        new URLSearchParams(window.location.search).get('undock') === 'chat' ||
        window.location.hash.replace(/^#/, '').startsWith('undock/coproducer') ||
        window.location.hash.replace(/^#/, '').startsWith('undock/chat')
      const inPanel =
        undockChat ||
        root.contains(document.activeElement) ||
        root === document.activeElement
      if (!inPanel) return
      const key = e.key
      const code = e.code
      // Ctrl+Shift+M: alterna el modo del coproducer (A3).
      if (e.shiftKey && (key === 'M' || code === 'KeyM')) {
        e.preventDefault()
        e.stopPropagation()
        setAgentMode((m) => {
          const next = nextAgentMode(m)
          saveAgentMode(next)
          return next
        })
        return
      }
      const zoomIn =
        key === '=' || key === '+' || code === 'NumpadAdd' || code === 'Equal'
      const zoomOut = key === '-' || key === '_' || code === 'NumpadSubtract' || code === 'Minus'
      const zoomReset = key === '0' || code === 'Digit0' || code === 'Numpad0'
      if (!zoomIn && !zoomOut && !zoomReset) return
      e.preventDefault()
      e.stopPropagation()
      if (zoomIn) bumpChatTextZoom(0.1)
      else if (zoomOut) bumpChatTextZoom(-0.1)
      else setChatTextZoom(1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const onChatZoomKeyDown = (e: ReactKeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return
    if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
      e.preventDefault()
      e.stopPropagation()
      bumpChatTextZoom(0.1)
    } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
      e.preventDefault()
      e.stopPropagation()
      bumpChatTextZoom(-0.1)
    } else if (e.key === '0') {
      e.preventDefault()
      e.stopPropagation()
      setChatTextZoom(1)
    }
  }

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
    const onAsk = (e: Event) => {
      requestOpenTool('coproducer', { zone: 'left' })
      const autoSend = (e as CustomEvent<AskAiSelectionDetail>).detail?.autoSend
      const a = getMusicalSelectionAnchor()
      if (autoSend?.trim()) {
        if (a) setSelectionLabel(a.label)
        void handleSendRef.current(autoSend.trim())
        return
      }
      if (!selectionHasContext(a)) {
        inputRef.current?.focus()
        return
      }
      setSelectionLabel(a!.label)
      setInputMessage((prev) => {
        const chip = selectionChipInsertText(a!)
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
  const messages = useMemo(
    () =>
      conversation.projectId === projectId
        ? conversation.messages.filter((m) => m.role === 'user' || m.role === 'assistant')
        : [],
    [conversation.projectId, conversation.messages, projectId],
  )
  const pendingProposal = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!
      if (m.pendingActions?.status === 'pending' && m.pendingActions.actions.length) {
        const remaining = m.pendingActions.actions.filter((_, i) => {
          if (m.pendingActions?.applied?.includes(i)) return false
          if (m.pendingActions?.skipped?.includes(i)) return false
          const st = m.pendingActions?.actionStatuses?.[String(i)]
          return st !== 'applied' && st !== 'skipped'
        }).length
        if (!remaining) continue
        return {
          messageId: m.id,
          count: remaining,
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
    registerCoproducerJobRunner(dawStore, { onPhase: (phase) => setHarnessPhase(phase) })
    return () => endCoproducerSession(dawStore)
  }, [dawStore])

  /** Turno cortado por una recarga: se ofrece reanudarlo (el run está en userData/agent-runs). */
  useEffect(() => {
    let alive = true
    void findInterruptedRuns(dawStore, conversation.id).then((runs) => {
      if (!alive || !runs.length) return
      const run = runs[0]!
      if (run.messageId) {
        const msg = getConversation(run.conversationId)?.messages.find((m) => m.id === run.messageId)
        if (msg && !msg.content.trim()) {
          patchMessage(run.conversationId, run.messageId, { content: '⏸ Turno interrumpido (se recargó la ventana).' })
          const after = getConversation(run.conversationId)
          if (after) setConversation(after)
        }
      }
      setInterruptedRun(run)
    })
    return () => {
      alive = false
    }
  }, [dawStore, conversation.id])

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
    const c = openConversation(id, projectId)
    if (!c) return
    setConversation(c)
    refreshHistoryList()
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
    deleteConversation(id, projectId)
    if (conversation.id === id) {
      const next = ensureActiveConversation(projectId)
      setConversation(next)
    }
    refreshHistoryList()
  }

  const stopGeneration = () => {
    const msgId = liveAssistantMsgIdRef.current
    const convId = conversation.id
    if (activeRunRef.current) getAgentEngine(dawStore).cancel(activeRunRef.current)
    activeRunRef.current = null
    cancelAgentJobs()
    genEpochRef.current += 1
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

  useEffect(() => {
    const onStop = () => stopGeneration()
    window.addEventListener('jaswave-interrupt-agent', onStop)
    return () => window.removeEventListener('jaswave-interrupt-agent', onStop)
  })

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

  const copyEntireChat = async () => {
    if (!messages.length) return
    const blocks = messages
      .map((m) => {
        const body = formatMessageForCopy(m).trim()
        if (!body) return ''
        const who = m.role === 'user' ? 'Tú' : 'Asistente Jas'
        return `### ${who}\n${body}`
      })
      .filter(Boolean)
    if (!blocks.length) return
    const ok = await copyTextToClipboard(blocks.join('\n\n---\n\n'))
    if (!ok) return
    setCopiedAll(true)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => {
      setCopiedAll(false)
      copiedTimerRef.current = null
    }, 1600)
  }

  /** Pinta un evento del motor (la orquestación vive en agent-legacy-turn / ai-harness engine). */
  const applyEngineEvent = (e: EngineEvent, convId: string) => {
    switch (e.type) {
      case 'phase':
        if (e.label) setHarnessPhase(e.label)
        break
      case 'provider':
        setAiStatus(e.status)
        setStatusDetail(e.status === 'online' ? '' : e.detail ?? '')
        break
      case 'agent.delta':
        setStreamText((prev) => (prev + e.text).slice(-12_000))
        return
      case 'budget':
        setTurnBudget({ usage: e.usage, budget: e.budget })
        return
      default:
        break
    }
    const after = getConversation(convId)
    if (after) setConversation(after)
  }

  /** Consume un turno del motor y mantiene el estado de la vista (generando, fase, stream). */
  const followTurn = async (handle: TurnHandle, convId: string, assistantMsgId?: string) => {
    const myEpoch = genEpochRef.current
    activeRunRef.current = handle.runId
    liveAssistantMsgIdRef.current = assistantMsgId ?? null
    setStreamText('')
    setIsGenerating(true)
    try {
      for await (const e of handle) {
        if (myEpoch !== genEpochRef.current) continue
        applyEngineEvent(e, convId)
      }
    } finally {
      if (myEpoch === genEpochRef.current) {
        activeRunRef.current = null
        setHarnessPhase('')
        setIsGenerating(false)
        setStreamText('')
        liveAssistantMsgIdRef.current = null
        setTurnBudget(null)
        // A5: un turno pausado queda ofertado para reanudar (banner de pausa).
        const finalRun = getAgentEngine(dawStore).getRun(handle.runId)
        if (finalRun?.status === 'paused') setInterruptedRun(finalRun)
      }
      const after = getConversation(convId)
      if (after) setConversation(after)
      refreshHistoryList()
    }
  }

  const runEngineTurn = async (opts: { text: string; citedIds?: string[]; citedMessageIds?: string[]; kind?: string }) => {
    setHarnessPhase('Trabajando en el DAW…')
    setActiveTurnMode(agentMode)
    const { handle, assistantMsgId } = startCoproducerTurn(dawStore, {
      conversationId: conversation.id,
      projectId,
      text: opts.text,
      mode: agentMode,
      citedIds: opts.citedIds,
      citedMessageIds: opts.citedMessageIds,
      preferLocal: aiStatus !== 'online',
      kind: opts.kind,
    })
    const refreshed = getConversation(conversation.id)
    if (refreshed) setConversation(refreshed)
    refreshHistoryList()
    await followTurn(handle, conversation.id, assistantMsgId)
  }

  const handleSendMessage = async (overrideText?: string) => {
    const rawInput = (overrideText ?? inputMessage).trim()
    if (!rawInput || isGenerating) return
    const cited = collectCitedMessages(rawInput, citedIds, dawStore.obtenerEstado(), messages)
    const turnCitedIds = citedIds
    setInputMessage('')
    setCitedIds([])
    await runEngineTurn({ text: rawInput, citedIds: turnCitedIds, citedMessageIds: cited.map((m) => m.id) })
  }

  const runQuick = (label: string) => {
    if (isGenerating) return
    setInputMessage('')
    // Chips de inicio: turno «quick» del motor (respuesta local, sin modelo remoto).
    void runEngineTurn({ text: label, kind: 'quick' })
  }

  const resumeInterrupted = () => {
    const run = interruptedRun
    if (!run || isGenerating) return
    setInterruptedRun(null)
    void followTurn(getAgentEngine(dawStore).resume(run.id), run.conversationId, run.messageId)
  }

  /** A5: pausar/cancelar el turno activo (el motor ya lo soporta; la UI solo lo expone). */
  const pauseActiveTurn = () => {
    const runId = activeRunRef.current
    if (!runId) return
    if (getAgentEngine(dawStore).pause(runId)) setHarnessPhase('Turno en pausa…')
  }

  const cancelActiveTurn = () => {
    const runId = activeRunRef.current
    if (!runId) return
    getAgentEngine(dawStore).cancel(runId)
  }

  handleSendRef.current = (t?: string) => {
    void handleSendMessage(t)
  }

  /** A3: si el texto suena a otro modo, la UI sugiere cambiar (el selector sigue mandando). */
  const modeSuggestion = inputMessage.trim() ? resolveMode(agentMode, inputMessage).suggestion : undefined

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
      ref={panelRootRef}
      data-shortcut-scope="ignore"
      data-chat-panel
      data-coproducer-chat
      tabIndex={-1}
      onKeyDown={onChatZoomKeyDown}
      onPointerDown={() => {
        panelRootRef.current?.focus({ preventScroll: true })
      }}
      className="relative flex h-full w-full min-w-0 flex-col bg-panel outline-none"
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
            <button
              type="button"
              title="Alejar texto del chat (Ctrl+-)"
              onClick={() => bumpChatTextZoom(-0.1)}
              className="rounded p-1 text-muted-foreground hover:bg-panel-raised hover:text-foreground"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="min-w-[2.4rem] text-center text-[10px] tabular-nums text-muted-foreground">
              {Math.round(chatTextZoom * 100)}%
            </span>
            <button
              type="button"
              title="Acercar texto del chat (Ctrl+=)"
              onClick={() => bumpChatTextZoom(0.1)}
              className="rounded p-1 text-muted-foreground hover:bg-panel-raised hover:text-foreground"
            >
              <ZoomIn className="size-3.5" />
            </button>
            <button
              type="button"
              title="Copiar todo el chat"
              disabled={!messages.length}
              onClick={() => void copyEntireChat()}
              className="rounded p-1.5 text-muted-foreground hover:bg-panel-raised hover:text-foreground disabled:opacity-40"
            >
              {copiedAll ? <Check className="size-4 text-accent-amber" /> : <Copy className="size-4" />}
            </button>
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

      {historyOpen ? (
        <div className="relative z-20 max-h-[45%] shrink-0 overflow-y-auto border-b border-border bg-panel">
          <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-muted-foreground">
            <span>Historial · {projectName}</span>
            <button type="button" className="text-accent-amber hover:underline" onClick={startNewChat}>
              + Nuevo
            </button>
          </div>
          {conversations.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
              Sin conversaciones en este proyecto
            </div>
          ) : (
            conversations.map((c) => {
              const active = c.id === conversation.id
              return (
                <div
                  key={c.id}
                  className={`flex items-stretch gap-0.5 border-b border-border/40 ${
                    active ? 'bg-accent-amber/10' : 'hover:bg-panel-raised/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => switchConversation(c.id)}
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                  >
                    <div className="truncate text-[12px] text-foreground">{chatTitle(c)}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {chatWhen(c.updatedAt)}
                      {' · '}
                      {c.messages.filter((m) => m.role === 'user' || m.role === 'assistant').length} msgs
                    </div>
                  </button>
                  <button
                    type="button"
                    title="Eliminar"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeChat(c.id)
                    }}
                    className="shrink-0 self-center rounded p-2 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              )
            })
          )}
          <AiAuditPanel />
        </div>
      ) : null}

      {statusDetail && aiStatus !== 'online' ? (
        <div className="border-b border-border bg-destructive/10 px-3 py-2 text-[11px] text-destructive" role="alert">
          {statusDetail}
        </div>
      ) : null}
      {interruptedRun && !isGenerating ? (
        <div className="flex items-center gap-2 border-b border-border bg-accent-amber/10 px-3 py-1.5 text-[11px] text-foreground" data-testid="engine-interrupted">
          <span className="min-w-0 flex-1 truncate">
            {interruptedRun.status === 'paused' ? 'Turno en pausa' : 'Turno interrumpido'}: «{messagePreview(interruptedRun.userText, 40)}»
          </span>
          <button type="button" className="shrink-0 text-accent-amber hover:underline" onClick={resumeInterrupted} data-testid="turn-resume">
            Reanudar
          </button>
          <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setInterruptedRun(null)}>
            Descartar
          </button>
        </div>
      ) : null}
      {isGenerating && harnessPhase ? (
        <div className="flex items-center gap-2 border-b border-border bg-accent-amber/10 px-3 py-1.5 text-[11px] text-accent-amber">
          <Loader2 className="size-3 shrink-0 animate-spin" />
          <span
            className="shrink-0 rounded bg-accent-amber/20 px-1.5 py-0.5 text-[10px] font-medium"
            title="Modo del turno en curso"
            data-testid="turn-mode-chip"
          >
            {agentModeLabel(activeTurnMode ?? agentMode)}
          </span>
          <span className="min-w-0 flex-1 truncate">{harnessPhase}</span>
          {turnBudget ? (
            <span
              className="shrink-0 font-mono text-[10px] text-muted-foreground"
              title="Consumo del presupuesto del turno (llamadas al modelo / minutos)"
              data-testid="turn-budget"
            >
              {turnBudget.usage.modelCalls}/{turnBudget.budget.maxModelCalls} llamadas ·{' '}
              {Math.round(turnBudget.usage.elapsedMs / 60_000)} min
            </span>
          ) : null}
          <button
            type="button"
            className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={pauseActiveTurn}
            data-testid="turn-pause"
            title="Pausar el turno (sigue desde donde va)"
          >
            Pausar
          </button>
          <button
            type="button"
            className="shrink-0 text-[10px] text-muted-foreground hover:text-destructive"
            onClick={cancelActiveTurn}
            data-testid="turn-cancel"
            title="Cancelar el turno"
          >
            Cancelar
          </button>
          <button
            type="button"
            className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              requestOpenTool('terminal', { zone: 'bottom' })
              window.dispatchEvent(new Event('jaswave-focus-terminal'))
            }}
          >
            Terminal
          </button>
        </div>
      ) : null}

      <div
        data-coproducer-chat
        data-chat-selectable
        className="flex-1 space-y-5 overflow-x-hidden overflow-y-auto p-4 select-text"
        style={{ fontSize: `${chatFontPx}px` }}
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
              className={`group flex w-full min-w-0 gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} ${
                citedIds.includes(msg.id) ? 'rounded-md ring-1 ring-accent-amber/40' : ''
              }`}
            >
              <div
                className={`flex min-w-0 flex-col gap-0.5 ${
                  msg.role === 'user' ? 'max-w-[85%] items-end' : 'w-full items-stretch'
                }`}
              >
              <div
                data-chat-selectable
                className={`min-w-0 select-text leading-relaxed ${
                  msg.role === 'user'
                    ? 'cursor-text rounded-lg bg-muted/45 px-3 py-2 text-foreground'
                    : 'w-full cursor-text overflow-x-hidden break-words px-0 py-0.5 text-foreground'
                }`}
              >
                {msg.reasoningSteps?.length ? (
                  <ReasoningStepsPanel
                    steps={msg.reasoningSteps}
                    live={isGenerating && msg.id === messages.at(-1)?.id}
                  />
                ) : null}
                {msg.content ? (
                  <ChatMarkdown text={msg.content} />
                ) : isGenerating && msg.role === 'assistant' && streamText && msg.id === liveAssistantMsgIdRef.current ? (
                  <ChatMarkdown text={stripProtocolForStream(streamText)} />
                ) : isGenerating && msg.role === 'assistant' ? (
                  <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground/70">
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
                          className="rounded px-1.5 py-0.5 text-[10px] bg-muted/60 text-muted-foreground"
                        >
                          {src ? messagePreview(src.content, 28) : 'mensaje citado'}
                        </span>
                      )
                    })}
                  </div>
                ) : null}
                {msg.actionsSummary && !msg.musicBuild ? (
                  <div className="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
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
                      const qs = msg.clarifications!.questions as ClarificationQuestion[]
                      const isKael = qs.some((q) => q.id === 'kael_feedback')
                      patchMessage(conversation.id, msg.id, {
                        clarifications: {
                          ...msg.clarifications!,
                          status: 'skipped',
                        },
                      })
                      void handleSendMessage(
                        isKael
                          ? formatClarificationAnswersForPrompt(
                              qs,
                              [{ id: 'kael_feedback', optionIndexes: [0], value: 'Sí, quedó bien' }],
                            )
                          : 'Usa defaults razonables según el plan y mi pedido. Emite <<<ACTIONS>>> ahora (propuesta para Aplicar). No preguntes más.',
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
                    applied={msg.pendingActions.applied}
                    skipped={msg.pendingActions.skipped}
                    checklistStepId={msg.pendingActions.checklistStepId}
                    onDone={() => {
                      const after = getConversation(conversation.id)
                      if (after) setConversation(after)
                    }}
                  />
                ) : null}
                {msg.appliedDiffSummary && !msg.pendingActions ? (
                  <div className="mt-2 text-[12px] text-emerald-400/80">
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
                {msg.role === 'assistant' ? <AgentMessageToolLog messageId={msg.id} /> : null}
                {msg.midiPreview ? (
                  <MidiGenerationPreview
                    preview={msg.midiPreview}
                    status={msg.midiPreview.status ?? 'pending'}
                  />
                ) : null}
                {msg.midiClipMdPreview ? (
                  <MidiClipMdPreview
                    preview={msg.midiClipMdPreview}
                    status={msg.midiClipMdPreview.status ?? 'pending'}
                    onStatusChange={(s) => {
                      patchMessage(conversation.id, msg.id, {
                        midiClipMdPreview: { ...msg.midiClipMdPreview!, status: s, applied: s === 'applied' },
                      })
                      const after = getConversation(conversation.id)
                      if (after) setConversation(after)
                    }}
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
                    conversationId={conversation.id}
                    messageId={msg.id}
                    onApplied={() => {
                      const after = getConversation(conversation.id)
                      if (after) setConversation(after)
                    }}
                  />
                ) : null}
              </div>
              {canCopy ? (
                <div
                  className={`flex items-center gap-0.5 ${
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                <button
                  type="button"
                  title={copied ? 'Copiado' : 'Copiar mensaje completo (incluye razonamiento)'}
                  aria-label={copied ? 'Mensaje copiado' : 'Copiar mensaje completo'}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => void copyChatMessage(msg)}
                  className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground/70 hover:text-foreground"
                >
                  {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
                <button
                  type="button"
                  title="Citar este mensaje (el hilo actual se conserva)"
                  aria-label="Citar mensaje"
                  onClick={() => citeMessage(msg)}
                  className={`flex items-center gap-1 rounded px-1 py-0.5 text-[10px] hover:text-foreground ${
                    citedIds.includes(msg.id) ? 'text-accent-amber' : 'text-muted-foreground/70'
                  }`}
                >
                  <Quote className="size-3" />
                  Citar
                </button>
                </div>
              ) : null}
              </div>
            </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {pendingProposal ? (
        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {pendingProposal.count} cambio{pendingProposal.count === 1 ? '' : 's'} por aplicar
          </span>
          <button
            type="button"
            className="shrink-0 hover:text-foreground"
            onClick={() => {
              const el = document.getElementById(pendingProposal.cardId)
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }}
          >
            Ver
          </button>
          <button
            type="button"
            className="shrink-0 text-foreground/80 hover:text-foreground"
            onClick={() => {
              const el = document.getElementById(pendingProposal.cardId)
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              requestAnimationFrame(() => {
                const applyBtn = el?.querySelector('[data-apply-remaining]') as HTMLButtonElement | undefined
                applyBtn?.click()
              })
            }}
          >
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
          {modeSuggestion && !isGenerating ? (
            <div
              className="flex items-center gap-2 rounded-md bg-panel-raised px-2 py-1 text-[11px] text-muted-foreground ring-1 ring-border"
              data-testid="mode-suggestion"
            >
              <span className="min-w-0 flex-1 truncate">
                Este pedido suena a modo «{agentModeLabel(modeSuggestion)}».
              </span>
              <button
                type="button"
                className="shrink-0 text-accent-amber hover:underline"
                onClick={() => {
                  setAgentMode(modeSuggestion)
                  saveAgentMode(modeSuggestion)
                }}
              >
                Cambiar a {agentModeLabel(modeSuggestion)}
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
