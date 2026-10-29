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
  Users,
  Sparkles,
} from 'lucide-react'
import { useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import {
  loadAiSettings,
  getActiveProvider,
  toAiHealthPayload,
} from '../motor/ai-settings'
import { transporteIA } from '../ia/transporte-ia'
import { useCatalogoIA } from '../ia/use-catalogo-ia'

import { formatClarificationAnswersForPrompt, ID_PREGUNTA_AGENTE, RESPUESTA_DECIDE_AGENTE, type ClarificationQuestion } from '../motor/ai-clarify'

import { endCoproducerSession, startCoproducerSession } from '../motor/agent-context-bridge'
import { ensureToolRegistryContext } from '../motor/agent-tool-bridge'
import { cancelAgentJobs } from '../motor/agent-job-queue'
import {
  findInterruptedRuns,
  getAgentEngine,
  registerCoproducerJobRunner,
  startCoproducerTurn,
  type EngineEvent,
} from '../motor/agent-engine-host'
import type { ComandoTurno } from '../motor/turno/turno-agente'
import { KIND_BANDA } from '../motor/turno/turno-banda'

import { PendingActionsCard } from './pending-actions-card'
import { AgentChecklistCard } from './agent-checklist-card'
import { ClarificationCard } from './clarification-card'
import { RevertTurnButton, TurnCertifyBadges } from './turn-verify-ui'
import { DestructiveConfirmCard } from './destructive-confirm-card'
import { AiAuditPanel } from './ai-audit-panel'
import { AgentMessageToolLog } from './agent-tool-log'
import { MidiGenerationPreview } from './midi-generation-preview'
import { MidiClipMdPreview } from './midi-clip-md-preview'
import { ProjectPlanPreview } from './project-plan-preview'
import { MusicBuildPreview } from './music-build-preview'
import { AiModelPicker } from './ai-model-picker'
import { SpeechToTextButton } from './speech-to-text-button'
import { AudioSampleRecorder, type AttachedAudioSample } from './audio-sample-recorder'
import { BandaLineaCompacta } from './banda-live-orchestrator'
import { abrirPanelBanda, bandaEnChat, useVistaBanda, vistaBanda } from './banda-vista-store'
import { orquestadorBandaSingleton } from '../motor/banda-orchestrator'

import { copyTextToClipboard } from '../motor/copy-text'
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
  appendMessage,
  type ChatConversation,
  type StoredChatMessage,
} from '../motor/ai-chat-store'
import { AgentModePicker } from './agent-mode-picker'
import { CHIPS_COMANDO, ChipComando, MensajeConComando, separarComando, type TipoChip } from './chip-comando'
import { ReasoningStepsPanel } from './reasoning-steps-panel'
import { AgenteProgreso } from './agente-progreso'
import { limpiarTextoUsuario } from '@jaswave/host-sdk'

import { ChatMarkdown, sanitizeAssistantMarkdown } from '@jaswave/ui-markdown'
import {
  bumpChatTextZoom,
  getChatTextZoom,
  setChatPanelMounted,
  setChatTextZoom,
  subscribeChatTextZoom,
} from '../motor/chat-ui-store'
import { DocEditCards } from './doc-edit-card'

import { setAgentRuntimePhase } from '../motor/agent-runtime-phase'
import { ASK_AI_SELECTION_EVENT, JasWaveLogo, MAX_CITED_MESSAGES, agentModeLabel, clearMusicalSelectionAnchor, collectCitedMessages, ensureTerminalAuditMirror, filterMentionables, getMusicalSelectionAnchor, groupMentionables, listMentionables, loadAgentMode, mentionDraftAtCaret, messagePreview, orderedMentionables, type MentionTrigger, nextAgentMode, requestOpenTool, resolveMode, saveAgentMode, selectionChipInsertText, selectionHasContext, subscribeMusicalSelection, useDAW, useDAWState, aprenderReglaOConocimiento, ayudaComando, describirCuando, deshacerUltimaReglaAprendida, parsearComandoChat, planificadorTareas } from '@jaswave/host-sdk'
import type { AgentBudget, AgentBudgetUsage, AgentMode, AskAiSelectionDetail, EngineRun, Mentionable, TurnHandle } from '@jaswave/host-sdk'

/** Texto en streaming sin bloques de protocolo (<<<ACTIONS …>>>, etc.). */
function stripProtocolForStream(text: string): string {
  return limpiarTextoUsuario(text.replace(/<<<[A-Z]+[\s\S]*?(?:[A-Z]+>>>|$)/g, ''))
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
  /** Modo elegido («/configurar», «/plan»…): se ve como etiqueta y se antepone al enviar. */
  const [comandoChip, setComandoChip] = useState<{ tipo: TipoChip; token: string } | null>(null)
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
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger>('@')
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionOptionRefs = useRef(new Map<string, HTMLButtonElement>())
  const [agentMode, setAgentMode] = useState<AgentMode>(() => loadAgentMode())
  /** Modo con el que corre (o corrió) el turno activo: indicador en el timeline. */
  const [activeTurnMode, setActiveTurnMode] = useState<AgentMode | null>(null)
  const [harnessPhase, setHarnessPhase] = useState('')
  const [copiedMsgId, setCopiedMsgId] = useState('')
  const [copiedAll, setCopiedAll] = useState(false)
  const [citedIds, setCitedIds] = useState<string[]>([])
  const [selectionLabel, setSelectionLabel] = useState(() => getMusicalSelectionAnchor()?.label ?? '')
  const [attachedSample, setAttachedSample] = useState<AttachedAudioSample | null>(null)
  const [mostrarBandaLive, setMostrarBandaLive] = useState(false)
  /** Con la banda trabajando, el chat sigue abierto: lo que se escribe va al agente en turno. */
  const [bandaActiva, setBandaActiva] = useState(() => orquestadorBandaSingleton.getState().activo)
  const vistaBandaActual = useVistaBanda()

  useEffect(() => {
    let estabaActiva = orquestadorBandaSingleton.getState().activo
    return orquestadorBandaSingleton.subscribe((state) => {
      setBandaActiva(state.activo)
      if (state.activo && !estabaActiva) {
        // Al arrancar una producción: en el chat o en su panel, según lo que eligió el usuario.
        if (vistaBanda().ubicacion === 'panel') abrirPanelBanda('empieza una producción', (id) => requestOpenTool(id as never, { zone: 'right' }))
        else setMostrarBandaLive(true)
      }
      estabaActiva = state.activo
    })
  }, [])
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
  const mentionFiltered =
    mentionQuery != null
      ? filterMentionables(listMentionables(dawStore.obtenerEstado(), messages), mentionQuery, mentionTrigger)
      : []
  const mentionGroups = groupMentionables(mentionFiltered)
  // Lista plana en el orden en que se pintan los grupos: es la que recorren las flechas.
  const mentionHits = orderedMentionables(mentionFiltered)
  const mentionActive = mentionHits[Math.min(mentionIndex, Math.max(0, mentionHits.length - 1))]

  useEffect(() => {
    if (mentionQuery == null || !mentionActive) return
    mentionOptionRefs.current.get(mentionActive.id)?.scrollIntoView({ block: 'nearest' })
  }, [mentionActive?.id, mentionQuery])

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
    setMentionQuery(null)
    if (!comandoChip && !before.trim()) {
      const chip = separarComando(next.replace(/^\s+/, ''), true)
      if (chip) {
        setComandoChip({ tipo: chip.tipo, token: chip.token })
        setInputMessage(chip.resto)
        requestAnimationFrame(() => el?.focus())
        return
      }
    }
    setInputMessage(next)
    requestAnimationFrame(() => {
      const pos = (before + token + ' ').length
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  const onInputChange = (value: string, caret: number) => {
    // «/configurar » escrito a mano (o pegado) se convierte en la etiqueta del modo.
    const chip = comandoChip ? null : separarComando(value, true)
    if (chip) {
      setComandoChip({ tipo: chip.tipo, token: chip.token })
      setMentionQuery(null)
      setInputMessage(chip.resto)
      const pos = Math.max(0, caret - (value.length - chip.resto.length))
      requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos))
      return
    }
    setInputMessage(value)
    const draft = mentionDraftAtCaret(value, caret)
    if (draft) {
      // onKeyUp también llama aquí: solo se vuelve a la primera opción si cambió la búsqueda,
      // si no, soltar la flecha devolvería la selección arriba.
      if (draft.query !== mentionQuery || draft.trigger !== mentionTrigger || draft.start !== mentionStart) {
        setMentionIndex(0)
      }
      setMentionQuery(draft.query)
      setMentionStart(draft.start)
      setMentionTrigger(draft.trigger)
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

  // Catálogo de modelos de la cuenta (backend): se recarga al iniciar o cerrar sesión.
  useCatalogoIA()

  useEffect(() => {
    const refresh = () => {
      const cfg = loadAiSettings()
      const provider = getActiveProvider(cfg)

      const transporte = transporteIA()
      if (!transporte) {
        setAiStatus('misconfigured')
        setStatusDetail('Inicia sesión en tu cuenta JasWave (o abre JasWave Desktop) para usar el asistente.')
        return
      }
      if (!provider.id) {
        setAiStatus('misconfigured')
        setStatusDetail('Tu cuenta no tiene modelos de IA disponibles. Inicia sesión o pide acceso a tu administrador.')
        return
      }

      void transporte
        .salud(toAiHealthPayload(provider))
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
        content: 'Detenido.',
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
      case 'agent.message':
        // El agente empieza un paso nuevo: el texto en vivo del paso anterior ya no aplica.
        if ((e.data as { kind?: string } | undefined)?.kind === 'stream-reset') {
          setStreamText('')
          return
        }
        break
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

  const runEngineTurn = async (opts: { text: string; citedIds?: string[]; citedMessageIds?: string[]; kind?: string; comando?: ComandoTurno }) => {
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
      comando: opts.comando,
    })
    const refreshed = getConversation(conversation.id)
    if (refreshed) setConversation(refreshed)
    refreshHistoryList()
    await followTurn(handle, conversation.id, assistantMsgId)
  }

  /** Respuesta local (sin modelo): deja constancia del comando y su resultado en la conversación. */
  const responderLocal = (textoUsuario: string, respuesta: string) => {
    appendMessage(conversation.id, { role: 'user', content: textoUsuario })
    appendMessage(conversation.id, { role: 'assistant', content: respuesta })
    const refreshed = getConversation(conversation.id)
    if (refreshed) setConversation(refreshed)
  }

  /** `/programar …`: crea, lista o cancela tareas del planificador. */
  const gestionarProgramar = (textoUsuario: string, args: string) => {
    const ahora = Date.now()
    if (/^(lista|list|ls)$/i.test(args)) {
      const tareas = planificadorTareas.lista(projectId)
      responderLocal(
        textoUsuario,
        tareas.length
          ? `**Tareas programadas** (${tareas.length}):\n${tareas.map((t, i) => `${i + 1}. ${t.prompt} — ${describirCuando(t, ahora)}`).join('\n')}\n\nPara cancelar una escribe, por ejemplo, «/programar cancelar 1».`
          : 'No hay tareas programadas. Por ejemplo: «/programar en 10 minutos revisar la mezcla».',
      )
      return
    }
    const cancelar = /^(?:cancelar|cancel|borrar)\s+(\S+)$/i.exec(args)
    if (cancelar) {
      const lista = planificadorTareas.lista(projectId)
      const n = Number(cancelar[1])
      const objetivo = Number.isInteger(n) && n >= 1 ? lista[n - 1] : lista.find((t) => t.id === cancelar[1])
      const ok = objetivo ? planificadorTareas.cancelar(projectId, objetivo.id) : false
      responderLocal(textoUsuario, ok ? `Cancelada: «${objetivo!.prompt}».` : 'No encontré esa tarea. Escribe «/programar lista» para ver las que hay.')
      return
    }
    if (!args) {
      responderLocal(textoUsuario, ayudaComando('programar'))
      return
    }
    const t = planificadorTareas.programar(projectId, args)
    responderLocal(
      textoUsuario,
      `**Tarea programada** ${describirCuando(t, Date.now())}:\n> ${t.prompt}\n\nLa haré yo mismo mientras este proyecto esté abierto.`,
    )
  }

  /** El texto tal como lo recibe el motor: la etiqueta de modo vuelve a ser «/comando …». */
  const componerEntrada = (texto: string) => (comandoChip ? `${comandoChip.token} ${texto}` : texto)

  const limpiarEntrada = () => {
    setInputMessage('')
    setComandoChip(null)
  }

  const handleSendMessage = async (overrideText?: string) => {
    const textoUsuario = (overrideText ?? componerEntrada(inputMessage)).trim()
    const cmd = parsearComandoChat(textoUsuario)

    // Comandos locales (no llaman al modelo): se resuelven aunque haya un turno en curso
    if (cmd && (cmd.tipo === 'aprender' || cmd.tipo === 'aprender-deshacer' || cmd.tipo === 'programar')) {
      try {
        if (cmd.tipo === 'aprender-deshacer') {
          responderLocal(
            textoUsuario,
            deshacerUltimaReglaAprendida(projectId) ? 'Listo, olvidé la última preferencia que me enseñaste.' : 'No hay ninguna preferencia que olvidar.',
          )
        } else if (cmd.tipo === 'aprender') {
          if (!cmd.texto) {
            responderLocal(textoUsuario, ayudaComando('aprender'))
          } else {
            const r = await aprenderReglaOConocimiento(projectId, cmd.texto)
            responderLocal(
              textoUsuario,
              r.duplicada
                ? `Eso ya lo tenía en cuenta:\n> ${r.regla}`
                : `**Aprendido.** Lo tendré en cuenta en este proyecto:\n> ${r.regla}\n\nSi me equivoqué, escribe «/aprender deshacer».`,
            )
          }
        } else {
          gestionarProgramar(textoUsuario, cmd.texto)
        }
        limpiarEntrada()
      } catch (err) {
        // El texto se conserva en el input para corregirlo
        responderLocal(textoUsuario, `No pude hacerlo: ${err instanceof Error ? err.message : String(err)}`)
      }
      return
    }

    // Mientras la banda trabaja, el chat habla con el agente en turno: lo que el usuario ve y oye y los
    // agentes no. «@Bajista …» o «Bajista: …» se lo dice a uno en particular.
    if (!cmd && textoUsuario && orquestadorBandaSingleton.getState().activo) {
      const d = orquestadorBandaSingleton.destinatarioDeTexto(textoUsuario)
      if (orquestadorBandaSingleton.enviarNota(d.texto, d.para)) {
        const nombre = d.para ? orquestadorBandaSingleton.getState().participantes.find((p) => p.id === d.para)?.nombre : undefined
        responderLocal(textoUsuario, nombre ? `Se lo paso a ${nombre}; en la banda verás cuándo lo tiene en cuenta.` : 'Se lo paso al agente en turno; en la banda verás cuándo lo tiene en cuenta.')
        limpiarEntrada()
        return
      }
    }

    let rawInput = textoUsuario
    if (!rawInput && attachedSample) {
      rawInput = `He grabado esta nota de voz: "${attachedSample.name}". Por favor analiza su melodía o ritmo con las herramientas DSP (analysis.voiceToMelody o analysis.voiceToDrums con audioRef "${attachedSample.id}") y crea el clip MIDI en el DAW.`
    }
    if (!rawInput || isGenerating) return

    // /meta sin objetivo no debe inventarse uno (antes disparaba «producción completa»)
    if (cmd?.tipo === 'meta' && !cmd.texto) {
      limpiarEntrada()
      responderLocal(textoUsuario, ayudaComando('meta'))
      return
    }

    const lower = rawInput.toLowerCase()
    const esPedidoBanda =
      cmd?.tipo === 'banda' ||
      lower.startsWith('banda:') ||
      lower.includes('producir tema completo') ||
      lower.includes('orquesta virtual') ||
      lower.includes('producción completa con banda')

    if (esPedidoBanda) {
      // La producción la hace el equipo de agentes (turno «banda»); el panel en vivo sigue sus etapas.
      setMostrarBandaLive(true)
      limpiarEntrada()
      await runEngineTurn({ text: rawInput, kind: KIND_BANDA })
      return
    }

    // /meta, /plan, /entrevista y /configurar viajan como modo del turno; después, el prefijo del audio adjunto
    const comando: ComandoTurno | undefined =
      cmd && (cmd.tipo === 'meta' || cmd.tipo === 'plan' || cmd.tipo === 'entrevista' || cmd.tipo === 'configurar')
        ? { tipo: cmd.tipo, texto: cmd.texto }
        : undefined
    if (attachedSample && !rawInput.includes(`"${attachedSample.name}"`)) {
      rawInput = `[Audio adjunto: "${attachedSample.name}" · audioRef: "${attachedSample.id}" (${attachedSample.durationSec.toFixed(1)}s)]\n${rawInput}`
    }

    const cited = collectCitedMessages(rawInput, citedIds, dawStore.obtenerEstado(), messages)
    const turnCitedIds = citedIds
    limpiarEntrada()
    setCitedIds([])
    await runEngineTurn({ text: rawInput, citedIds: turnCitedIds, citedMessageIds: cited.map((m) => m.id), comando })
  }

  const runQuick = (label: string) => {
    if (isGenerating) return
    limpiarEntrada()
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

  // /programar: las tareas vencidas de este proyecto se lanzan como un turno normal; si hay un turno en
  // curso devuelve false y el planificador las reintenta en su siguiente ciclo (no se pierden).
  const isGeneratingRef = useRef(false)
  isGeneratingRef.current = isGenerating
  useEffect(() => {
    const quitar = planificadorTareas.registrarEjecutor((t) => {
      if (isGeneratingRef.current) return false
      handleSendRef.current(`Tarea programada: ${t.prompt}`)
      return true
    }, projectId)
    planificadorTareas.iniciar()
    return () => {
      quitar()
      planificadorTareas.detener()
    }
  }, [projectId])

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
      {/*
        La cabecera se adapta al ancho del PANEL (consultas de contenedor, no de la ventana): lo que no cabe baja a
        otra línea o se queda en icono con su título; nunca se sale ni obliga a hacer scroll horizontal.
      */}
      <header className="@container flex min-w-0 flex-col gap-1.5 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <JasWaveLogo className="hidden h-10 w-auto max-w-[120px] shrink-0 @[340px]:block" alt="Asistente Jas" />
          {/* Base ancha: si título y botones no caben juntos, los botones bajan de fila en vez de cortar el título. */}
          <div className="min-w-0 shrink grow basis-[11rem] truncate">
            <h2 className="truncate text-[13px] font-semibold text-foreground">Asistente Jas</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {projectName} • {trackCount} pistas
            </p>
          </div>
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
            <button
              type="button"
              title="Alejar texto del chat (Ctrl+-)"
              onClick={() => bumpChatTextZoom(-0.1)}
              className="rounded p-1 text-muted-foreground hover:bg-panel-raised hover:text-foreground"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="hidden min-w-[2.4rem] text-center text-[10px] tabular-nums text-muted-foreground @[380px]:inline">
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
            <button
              type="button"
              aria-label="Banda Virtual"
              title={mostrarBandaLive ? 'Ocultar Orquesta Virtual' : 'Ver Orquesta Virtual Multi-Agente'}
              onClick={() =>
                vistaBandaActual.ubicacion === 'panel'
                  ? abrirPanelBanda('botón Banda Virtual del chat', (id) => requestOpenTool(id as never, { zone: 'right' }))
                  : setMostrarBandaLive((prev) => !prev)
              }
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                mostrarBandaLive
                  ? 'bg-purple-600/25 text-purple-300 ring-1 ring-purple-500/50'
                  : 'bg-panel-raised text-muted-foreground hover:text-foreground'
              }`}
            >
              <Users className="size-3.5 text-purple-400" />
              <span className="hidden @[440px]:inline">Banda Virtual</span>
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
          <span className="min-w-0 flex-1 break-words">
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
          <span className="min-w-0 flex-1 break-words">{harnessPhase}</span>
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

      {/* En el chat la banda es una línea; el detalle sale al pasar el ratón y la vista completa, en su panel. */}
      {mostrarBandaLive && bandaEnChat(vistaBandaActual) && (
        <div className="relative z-20 shrink-0 border-b border-border bg-panel-base/70 px-3 py-1.5">
          <BandaLineaCompacta />
        </div>
      )}

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
                '/banda Componer y producir un tema Pop Rock',
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
                {msg.agente ? (
                  <AgenteProgreso
                    progreso={msg.agente}
                    vivo={isGenerating && msg.id === liveAssistantMsgIdRef.current && msg.agente.estado === 'trabajando'}
                  />
                ) : null}
                {msg.content ? (
                  <MensajeConComando texto={msg.content} usuario={msg.role === 'user'} />
                ) : isGenerating && msg.role === 'assistant' && streamText && msg.id === liveAssistantMsgIdRef.current ? (
                  <ChatMarkdown text={stripProtocolForStream(streamText)} />
                ) : isGenerating && msg.role === 'assistant' && !msg.agente ? (
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
                      const delAgente = qs.some((q) => q.id === ID_PREGUNTA_AGENTE)
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
                          : delAgente
                            ? RESPUESTA_DECIDE_AGENTE
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
          <span className="min-w-0 flex-1 break-words">
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
          <div
            id="jw-mention-list"
            role="listbox"
            aria-label={mentionTrigger === '/' ? 'Comandos' : 'Referencias'}
            className="absolute inset-x-3 bottom-full z-20 mb-1 max-h-64 overflow-y-auto overscroll-contain rounded-md border border-border bg-panel-raised shadow-lg"
          >
            <div className="border-b border-border px-3 py-1 text-[10px] text-muted-foreground">
              {mentionTrigger === '/'
                ? '¿Qué quieres hacer?'
                : 'Menciona algo de tu proyecto'}
            </div>
            {mentionHits.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">Sin coincidencias</div>
            ) : (
              mentionGroups.map((g) => (
                <div key={g.kind}>
                  <div className="sticky top-0 z-10 bg-panel-raised px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.label}
                  </div>
                  {g.items.map((item) => {
                    const active = item.id === mentionActive?.id
                    return (
                      <button
                        key={item.id}
                        id={`jw-mention-${item.id}`}
                        ref={(el) => {
                          if (el) mentionOptionRefs.current.set(item.id, el)
                          else mentionOptionRefs.current.delete(item.id)
                        }}
                        role="option"
                        aria-selected={active}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          insertMention(item)
                        }}
                        onMouseMove={() => {
                          const idx = mentionHits.findIndex((h) => h.id === item.id)
                          if (idx >= 0 && idx !== mentionIndex) setMentionIndex(idx)
                        }}
                        className={`flex w-full scroll-my-7 items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] ${
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
              <span className="min-w-0 flex-1 break-words" title={selectionLabel}>
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
              <span className="min-w-0 flex-1 break-words">
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
          {/* Grabador / Cargador de Audio de Muestra */}
          <AudioSampleRecorder
            attachedSample={attachedSample}
            onSampleAttached={setAttachedSample}
            onInsertPromptText={(text) => {
              setInputMessage((prev) => (prev ? `${prev}\n${text}` : text))
              inputRef.current?.focus()
            }}
            disabled={isGenerating}
          />
          {comandoChip ? (
            <div className="flex items-center gap-1.5 px-0.5">
              <ChipComando
                tipo={comandoChip.tipo}
                onQuitar={() => {
                  setComandoChip(null)
                  inputRef.current?.focus()
                }}
              />
            </div>
          ) : null}
          {/* Texto a todo el ancho y, debajo, la barra (modo, dictado, enviar): en paneles estrechos nada se aprieta. */}
          <div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-panel-raised px-2 py-2 ring-1 ring-border focus-within:ring-2 focus-within:ring-ring">
          <textarea
            ref={inputRef}
            rows={1}
            value={inputMessage}
            onChange={(e) => onInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyUp={(e) => {
              // Escape, Enter, Tab y las flechas verticales las gestiona onKeyDown; reevaluar aquí reabriría la lista.
              if (['Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) return
              onInputChange(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
            }}
            onKeyDown={(e) => {
              if (
                e.key === 'Backspace' &&
                comandoChip &&
                e.currentTarget.selectionStart === 0 &&
                e.currentTarget.selectionEnd === 0
              ) {
                e.preventDefault()
                setComandoChip(null)
                return
              }
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
                const total = mentionHits.length
                const mover = (siguiente: number) => {
                  e.preventDefault()
                  setMentionIndex(((siguiente % total) + total) % total)
                }
                if (e.key === 'ArrowDown') mover(mentionIndex + 1)
                else if (e.key === 'ArrowUp') mover(mentionIndex - 1)
                else if (e.key === 'PageDown') mover(Math.min(total - 1, mentionIndex + 8))
                else if (e.key === 'PageUp') mover(Math.max(0, mentionIndex - 8))
                else if (e.key === 'Home' && e.ctrlKey) mover(0)
                else if (e.key === 'End' && e.ctrlKey) mover(total - 1)
                else if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  if (mentionActive) insertMention(mentionActive)
                }
              }
            }}
            aria-controls={mentionQuery != null ? 'jw-mention-list' : undefined}
            aria-activedescendant={mentionQuery != null && mentionActive ? `jw-mention-${mentionActive.id}` : undefined}
            disabled={isGenerating && !bandaActiva}
            placeholder={
              comandoChip
                ? CHIPS_COMANDO[comandoChip.tipo].pista
                : bandaActiva
                  ? 'Dile a la banda lo que ves y ellos no («@Bajista …» para uno en concreto)'
                  : 'Pide lo que quieras o escribe /'
            }
            // field-sizing: crece con el texto y con la pista (placeholder) al estrecharse, sin scroll interno.
            className="max-h-40 min-h-8 w-full [field-sizing:content] min-w-0 resize-none bg-transparent px-1 py-1 text-[13px] leading-snug text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <div className="flex min-w-0 items-center gap-2">
            <AgentModePicker value={agentMode} onChange={setAgentMode} />
            {/* G7: el host compone ancla + dictado (sin duplicar); en «enviar al pausar» manda el mensaje. */}
            <SpeechToTextButton
              disabled={isGenerating && !bandaActiva}
              value={inputMessage}
              inputRef={inputRef}
              onChange={(text) => setInputMessage(text)}
              onAutoSubmit={(text) => {
                setMentionQuery(null)
                void handleSendMessage(componerEntrada(text))
                requestAnimationFrame(() => inputRef.current?.focus())
              }}
            />
            <div className="flex-1" />
          {/* Con la banda trabajando se ven los dos: detener la producción y enviar una indicación. */}
          {isGenerating ? (
            <button
              type="button"
              onClick={stopGeneration}
              aria-label="Detener agente"
              title={bandaActiva ? 'Detener la banda' : 'Detener'}
              className="flex size-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-opacity hover:opacity-90"
            >
              <Square className="size-3 fill-current" />
            </button>
          ) : null}
          {isGenerating && !bandaActiva ? null : (
            <button
              type="submit"
              disabled={!inputMessage.trim() && !attachedSample && !comandoChip}
              aria-label={bandaActiva ? 'Enviar indicación a la banda' : 'Enviar mensaje'}
              className="flex size-7 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
          </div>
          </div>
        </form>
      </div>
    </aside>
  )
}
