import {
  ArrowUp,
  Loader2,
  User,
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
  PROVIDER_PRESETS,
} from '@/src/lib/ai-settings'
import {
  buildAgentSystemPrompt,
  stripActionsBlock,
  parseActionsFromText,
  fallbackActionsFromUserIntent,
  executeDawActions,
  formatActionResultsForUser,
} from '@/src/lib/ai-daw-agent'
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

function newMsgId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function CoProducerPanel() {
  const [inputMessage, setInputMessage] = useState('')
  const [conversation, setConversation] = useState<ChatConversation>(() => ensureActiveConversation())
  const [historyOpen, setHistoryOpen] = useState(false)
  const [conversations, setConversations] = useState<ChatConversation[]>(() => listConversations())
  const [isGenerating, setIsGenerating] = useState(false)
  const [aiStatus, setAiStatus] = useState<'unknown' | 'online' | 'offline' | 'misconfigured'>('unknown')
  const [statusDetail, setStatusDetail] = useState('')
  const [modelLabel, setModelLabel] = useState(() => {
    const s = loadAiSettings()
    const p = getActiveProvider(s)
    return `${PROVIDER_PRESETS[p.kind].label} · ${p.selectedModel}`
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const dawStore = useDAW()
  const projectName = useDAWState((state) => state.project?.nombre || 'Nuevo Proyecto')
  const trackCount = useDAWState((state) => state.project?.tracks?.length ?? 0)

  const messages = conversation.messages.filter((m) => m.role === 'user' || m.role === 'assistant')

  const refreshHistoryList = useCallback(() => {
    setConversations(listConversations())
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isGenerating])

  useEffect(() => {
    const refresh = () => {
      const cfg = loadAiSettings()
      const provider = getActiveProvider(cfg)
      setModelLabel(`${PROVIDER_PRESETS[provider.kind].label} · ${provider.selectedModel}`)

      if (!window.electron?.aiHealth) {
        setAiStatus('misconfigured')
        setStatusDetail('Abre JasWave en Electron para usar proveedores de IA.')
        return
      }

      void window.electron
        .aiHealth({
          kind: provider.kind,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
        })
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

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isGenerating) return

    const userText = inputMessage.trim()
    setInputMessage('')

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
      // Consultas locales muy cortas solo si el proveedor no está online
      const preferLocal = aiStatus !== 'online' || !window.electron?.aiChat
      const local = preferLocal ? answerLocalReadQuery(state, userText) : null
      let accumulated = local ?? ''
      let actionsSummary = ''

      if (!local) {
        if (!window.electron?.aiChat) {
          // Sin Electron: si pide crear, ejecutamos igual en el DAW local
          const forced = fallbackActionsFromUserIntent(userText)
          if (forced.length) {
            const results = await executeDawActions(dawStore, forced)
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
          const systemContext = buildAgentSystemPrompt(state)
          const prior = (refreshed?.messages ?? messages)
            .filter((m) => m.content.trim().length > 0 && m.id !== assistantMsgId)
            .slice(-12)
            .map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            }))

          try {
            const result = await window.electron.aiChat({
              messages: [
                { role: 'system', content: systemContext },
                ...prior,
                { role: 'user', content: userText },
              ],
              kind: provider.kind,
              model: provider.selectedModel,
              baseUrl: provider.baseUrl,
              apiKey: provider.apiKey,
              temperature: cfg.temperature,
              maxTokens: cfg.maxTokens,
            })

            if (result.success && result.content?.trim()) {
              const raw = result.content
              let actions = parseActionsFromText(raw)
              if (actions.length === 0) {
                actions = fallbackActionsFromUserIntent(userText)
              }

              let text = stripActionsBlock(raw)
              if (actions.length > 0) {
                const results = await executeDawActions(dawStore, actions)
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
              // Si el modelo falla pero el usuario pidió crear, igual generamos
              const forced = fallbackActionsFromUserIntent(userText)
              if (forced.length) {
                const results = await executeDawActions(dawStore, forced)
                actionsSummary = formatActionResultsForUser(results)
                accumulated =
                  'El modelo no respondió bien; apliqué la generación directamente en el DAW.'
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
            const forced = fallbackActionsFromUserIntent(userText)
            if (forced.length) {
              const results = await executeDawActions(dawStore, forced)
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

      updateMessageContent(
        conversation.id,
        assistantMsgId,
        accumulated || '⚠️ Sin respuesta.',
        actionsSummary || undefined,
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
          if (/crea|midi|piano/i.test(userText)) {
            const forced = fallbackActionsFromUserIntent(userText)
            const results = await executeDawActions(dawStore, forced)
            const summary = formatActionResultsForUser(results)
            updateMessageContent(
              conversation.id,
              assistantMsgId,
              ['He creado el material en el arrange de JasWave.', summary].join('\n\n'),
              summary,
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
      <header className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
        <JasWaveLogo className="h-10 w-auto max-w-[120px] shrink-0" alt="Asistente Jas" />
        <div className="min-w-0 flex-1 truncate">
          <h2 className="truncate text-[13px] font-semibold text-foreground">Asistente Jas</h2>
          <p className="truncate text-[11px] text-muted-foreground" title={`${conversation.title} · ${modelLabel}`}>
            {projectName} • {trackCount} pistas · {modelLabel}
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

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center text-muted-foreground">
            <JasWaveLogo className="mb-3 h-28 w-auto max-w-[220px]" alt="JasWave" />
            <h3 className="mb-1 text-[14px] font-semibold text-foreground">Asistente Jas</h3>
            <p className="max-w-[280px] text-[12px]">
              Puedo crear pistas y clips MIDI en el proyecto. El historial se guarda entre sesiones.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {[
                'Resumen del proyecto',
                'Crea una pista MIDI de piano suave en C mayor de 3 minutos',
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
          messages.map((msg: StoredChatMessage) => (
            <div
              key={msg.id}
              className={`flex gap-2 text-[13px] ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel-raised ring-1 ring-border">
                  <JasWaveLogo className="size-7" alt="Asistente Jas" />
                </div>
              )}
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 leading-relaxed ${
                  msg.role === 'user'
                    ? 'rounded-br-none bg-accent text-accent-foreground'
                    : 'rounded-bl-none border border-border bg-panel-raised text-foreground'
                }`}
              >
                {msg.content ||
                  (isGenerating && msg.role === 'assistant' ? (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> Trabajando en el DAW…
                    </span>
                  ) : null)}
                {msg.actionsSummary ? (
                  <div className="mt-2 border-t border-border/60 pt-2 text-[11px] whitespace-pre-wrap text-emerald-400/90">
                    {msg.actionsSummary}
                  </div>
                ) : null}
              </div>
              {msg.role === 'user' && (
                <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <User className="size-3.5" />
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleSendMessage()
          }}
          className="flex items-center gap-2 rounded-lg bg-panel-raised px-3 py-2 ring-1 ring-border focus-within:ring-2 focus-within:ring-ring"
        >
          <input
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            disabled={isGenerating}
            placeholder="Pide crear MIDI, pistas, o pregunta por el proyecto…"
            className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!inputMessage.trim() || isGenerating}
            aria-label="Enviar mensaje"
            className="flex size-7 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {isGenerating ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </form>
      </div>
    </aside>
  )
}
