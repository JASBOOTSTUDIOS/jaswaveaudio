/**
 * Host del motor de turnos (A1) para la app: implementa `EngineHost` con la tienda del DAW,
 * el Tool Runner, docs (plan.md), `aiChatWithFallback` (con cada intento cargado al presupuesto),
 * tool-calling nativo (A2) y persistencia de runs en userData/agent-runs vía IPC.
 *
 * El panel de chat solo arranca turnos (`startCoproducerTurn`) y pinta eventos.
 */

import {
  agentActionClass,
  createAgentBudgetTracker,
  createBudgetGuard,
  createTurnEngine,
  engineChat,
  parseEngineRun,
  serializeEngineRun,
  type EngineAgentRole,
  type EngineChatOptions,
  type EngineChatResult,
  type EngineEvent,
  type EngineHost,
  type EngineHostChatResponse,
  type EngineMode,
  type EngineRun,
  type TurnEngine,
  type TurnHandle,
} from '@jaswave/ai-harness'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import {
  aiChatWithFallback,
  loadAiSettings,
  saveAiSettings,
  selectCatalogModel,
  type AiChatRequest,
  type AiChatResult,
} from './ai-settings'
import { buildAgentSystemPrompt, executeDawActions, formatActionResultsForUser, parseActionsFromText } from './ai-daw-agent'
import { registerAgentJobRunner } from './agent-job-queue'
import { runPostTurnCertifyPipeline } from './agent-certify-pipeline'
import { runHarnessUntilPlanComplete } from './agent-harness-job-runner'
import { buildAssembledAgentContext } from './agent-context-bridge'
import { formatMusicalSelectionForPrompt, getMusicalSelectionAnchor } from './ai-selection-context'
import { getAgentDoc, PLAN_SLUG, writeAgentDoc } from './agent-docs'
import { runRegisteredTools } from './agent-tool-runner'
import { listAgentToolSchemas } from './agent-tool-schemas'
import { computeFallbackActions, isFallbackTool } from './agent-fallback-tools'
import { appendMessage, getConversation, patchMessage } from './ai-chat-store'
import type { AgentMode } from './ai-modes'
import { createLegacyTurnProgram, finishAgentTurn, type LegacyTurnContext } from './agent-legacy-turn'

/** Runs en memoria cuando no hay Electron (vite web:dev, tests). */
const memoryRuns = new Map<string, string>()

function hasElectronRuns(): boolean {
  return typeof window !== 'undefined' && typeof window.electron?.agentRunSave === 'function'
}

/** Recuerda el modelo que respondió tras un fallback (antes vivía en el panel). */
function rememberWorkingModel(r: { usedProviderId?: string; usedModel?: string; fallbackUsed?: boolean }): void {
  if (!r.fallbackUsed || !r.usedProviderId || !r.usedModel) return
  saveAiSettings(selectCatalogModel(loadAiSettings(), r.usedProviderId, r.usedModel))
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('jaswave-ai-settings-changed'))
}

function toEngineResponse(r: AiChatResult & { usedProviderId?: string; usedModel?: string; fallbackUsed?: boolean; httpAttempts?: number }): EngineHostChatResponse {
  return {
    success: Boolean(r.success && (r.content?.trim() || r.toolCalls?.length)),
    content: r.content,
    toolCalls: r.toolCalls,
    toolsUnsupported: r.toolsUnsupported,
    error: r.error,
    errorCode: r.errorCode,
    hint: r.hint,
    provider: r.provider,
    model: r.model,
    usedProviderId: r.usedProviderId,
    usedModel: r.usedModel,
    fallbackUsed: r.fallbackUsed,
    httpAttempts: r.httpAttempts,
  }
}

export type JasWaveEngineHostDeps = {
  tienda: TiendaDAW
  /** Run vivo por id (para conversationId/messageId al ejecutar herramientas). */
  getRun?: (runId: string) => EngineRun | undefined
}

export function createJasWaveEngineHost(deps: JasWaveEngineHostDeps): EngineHost {
  const { tienda } = deps
  const projectId = () => tienda.obtenerEstado().project?.id || 'default'
  return {
    now: () => Date.now(),
    newId: (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,

    async chat(req, opts) {
      if (typeof window === 'undefined' || !window.electron?.aiChat) {
        return { success: false, error: 'No hay modelo remoto disponible.', errorCode: 'not_available' }
      }
      const cfg = loadAiSettings()
      const streamChat = window.electron.aiChatStream
        ? (r: AiChatRequest, onDelta: (t: string) => void) =>
            window.electron.aiChatStream!(r, (e) => {
              if (e.type === 'delta' && e.text) onDelta(e.text)
            })
        : undefined
      const r = await aiChatWithFallback((x) => window.electron!.aiChat!(x), req.messages, {
        temperature: req.temperature ?? cfg.temperature,
        maxTokens: req.maxTokens ?? cfg.maxTokens,
        settings: cfg,
        abort: opts.signal,
        beforeAttempt: (a) => opts.beforeAttempt(a),
        tools: req.tools,
        toolChoice: req.toolChoice,
        meta: { purpose: req.meta.purpose, role: req.meta.role, runId: req.meta.runId },
        onDelta: opts.onDelta,
        streamChat,
      })
      rememberWorkingModel(r)
      return toEngineResponse(r)
    },

    buildSystemPrompt({ mode, userText, purpose, runId }) {
      const state = tienda.obtenerEstado()
      const run = deps.getRun?.(runId)
      const conv = run ? getConversation(run.conversationId) : null
      const chatMessages = (conv?.messages ?? []).filter((m) => m.role === 'user' || m.role === 'assistant')
      const base = buildAgentSystemPrompt(state, userText, mode as AgentMode, chatMessages)
      if (purpose !== 'agent' && purpose !== 'final') return base
      const turns = chatMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      return [
        buildAssembledAgentContext(tienda, state, userText, turns, ''),
        formatMusicalSelectionForPrompt(getMusicalSelectionAnchor()),
        base,
      ]
        .filter(Boolean)
        .join('\n\n')
    },

    listTools: ({ mode, role }) => listAgentToolSchemas({ mode, role }),
    classifyTool: (call) => agentActionClass({ type: call.name, payload: call.arguments }),

    async executeTools(allCalls, ctx) {
      const run = deps.getRun?.(ctx.runId)
      // fallback.* solo calculan propuestas sobre el estado actual (clase read).
      const fallback = allCalls.filter((c) => isFallbackTool(c.name))
      const calls = allCalls.filter((c) => !isFallbackTool(c.name))
      const fbResults = fallback.map((c) => ({
        callId: c.id,
        name: c.name,
        status: 'success' as const,
        data: { actions: computeFallbackActions(c.name, tienda.obtenerEstado(), c.arguments) },
      }))
      if (!calls.length) return fbResults
      const results = await runRegisteredTools(
        tienda,
        calls.map((c) => ({ id: c.id, tool: c.name, arguments: c.arguments })),
        {
          agentMode: ctx.mode as AgentMode,
          forceApply: true,
          source: 'model_actions',
          conversationId: run?.conversationId,
          messageId: run?.messageId,
          userConfirmed: ctx.userConfirmed,
        },
      )
      return [
        ...fbResults,
        ...results.map((r) => ({
          callId: r.callId,
          name: r.tool,
          status: r.status,
          data: r.data,
          error: r.error,
        })),
      ]
    },

    readDoc: (slug) => getAgentDoc(projectId(), slug)?.content ?? null,
    // El motor solo escribe docs con contenido aprobado/editado por el usuario (plan aprobado).
    writeDoc: (slug, content) => {
      writeAgentDoc(projectId(), slug, content, { origin: 'user' })
    },

    log(level, message, data) {
      if (level === 'error' || level === 'warn') {
        window.electron?.logError?.('agent-engine', `${message} ${data ? JSON.stringify(data).slice(0, 400) : ''}`)
      }
    },

    async persistRun(run) {
      const json = serializeEngineRun(run)
      if (hasElectronRuns()) {
        const r = await window.electron.agentRunSave!(run.id, json)
        if (!r.ok) memoryRuns.set(run.id, json)
      } else {
        memoryRuns.set(run.id, json)
      }
    },

    async loadRun(runId) {
      const raw = hasElectronRuns() ? await window.electron.agentRunLoad!(runId) : null
      return parseEngineRun(raw ?? memoryRuns.get(runId) ?? '')
    },

    program: createLegacyTurnProgram({ tienda }),
  }
}

// ── Singleton por tienda ──────────────────────────────────────────────────────

let engineSingleton: { tienda: TiendaDAW; engine: TurnEngine } | null = null

export function getAgentEngine(tienda: TiendaDAW): TurnEngine {
  if (engineSingleton?.tienda === tienda) return engineSingleton.engine
  let engine: TurnEngine | null = null
  const host = createJasWaveEngineHost({ tienda, getRun: (id) => engine?.getRun(id) })
  engine = createTurnEngine(host)
  engineSingleton = { tienda, engine }
  return engine
}

function newMsgId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export type StartCoproducerTurnInput = {
  conversationId: string
  projectId: string
  text: string
  mode: EngineMode
  citedIds?: string[]
  citedMessageIds?: string[]
  /** El proveedor no está online: se prefieren respuestas locales. */
  preferLocal?: boolean
  /** Variante: 'quick' (chips de inicio sin modelo). */
  kind?: string
}

/**
 * Arranca un turno del coproductor: crea los mensajes del chat (usuario + asistente vacío),
 * lanza el motor y enlaza el mensaje con el run (engineRunId).
 */
export function startCoproducerTurn(
  tienda: TiendaDAW,
  input: StartCoproducerTurnInput,
): { handle: TurnHandle; userMsgId: string; assistantMsgId: string } {
  const engine = getAgentEngine(tienda)
  const userMsgId = newMsgId('user')
  const assistantMsgId = newMsgId('asst')
  appendMessage(input.conversationId, {
    id: userMsgId,
    role: 'user',
    content: input.text,
    citedMessageIds: input.citedMessageIds,
  }, input.projectId)
  appendMessage(input.conversationId, { id: assistantMsgId, role: 'assistant', content: '' }, input.projectId)
  const context: LegacyTurnContext = {
    userMsgId,
    assistantMsgId,
    citedIds: input.citedIds ?? [],
    preferLocal: input.preferLocal === true,
    projectId: input.projectId,
  }
  const handle = engine.runTurn({
    text: input.text,
    mode: input.mode,
    conversationId: input.conversationId,
    messageId: assistantMsgId,
    kind: input.kind,
    context,
  })
  patchMessage(input.conversationId, assistantMsgId, { engineRunId: handle.runId })
  return { handle, userMsgId, assistantMsgId }
}

export type ApplyPendingAnswer = {
  conversationId: string
  messageId: string
  agentMode: string
  actions: Array<{ type: string; payload?: Record<string, unknown> }>
  indices: number[]
  userTextHint?: string
}

/**
 * Tarjeta «Aplicar»: responde al run en espera (si existe, incluso tras recargar) o abre un turno
 * `apply` enlazado al mensaje. Siempre pasa por el motor (system prompt + fallback + presupuesto).
 */
export async function answerPendingActions(tienda: TiendaDAW, a: ApplyPendingAnswer): Promise<TurnHandle> {
  const engine = getAgentEngine(tienda)
  const msg = getConversation(a.conversationId)?.messages.find((m) => m.id === a.messageId)
  const runId = msg?.engineRunId
  if (runId && !engine.isActive(runId)) {
    const run = await engine.loadRun(runId)
    if (run?.status === 'waiting-user' && run.pending?.kind === 'apply') {
      return engine.answer(runId, { needId: run.pending.id, approved: true, indices: a.indices, data: a })
    }
  }
  return engine.runTurn({
    text: a.userTextHint || 'continúa con el trabajo pendiente',
    mode: (a.agentMode as EngineMode) || 'create',
    conversationId: a.conversationId,
    messageId: a.messageId,
    kind: 'apply',
    context: { apply: a },
  })
}

/**
 * Chat del motor fuera de un turno (jobs en segundo plano): mismo camino único
 * (system prompt + fallback + presupuesto propio del job).
 */
export function createStandaloneEngineChat(tienda: TiendaDAW, opts: { mode: EngineMode; role?: EngineAgentRole; userText: string }) {
  let engine: TurnEngine | null = null
  const host = createJasWaveEngineHost({ tienda, getRun: (id) => engine?.getRun(id) })
  engine = createTurnEngine(host)
  const budget = createAgentBudgetTracker()
  const controller = new AbortController()
  const runId = `job-${Date.now().toString(36)}`
  return {
    signal: controller.signal,
    budget,
    abort: () => controller.abort(),
    chat: (copts: EngineChatOptions): Promise<EngineChatResult> =>
      engineChat(
        {
          host,
          runId,
          mode: opts.mode,
          role: opts.role ?? 'coproductor',
          userText: opts.userText,
          budget,
          signal: controller.signal,
          emit: () => undefined,
          plan: () => host.readDoc?.(PLAN_SLUG) ?? null,
        },
        copts,
      ),
  }
}

/**
 * Jobs en segundo plano del coproductor (certify, harness hasta completar plan.md).
 * Antes se registraban en el panel con un chat sin fallback; ahora usan el chat del motor.
 */
export function registerCoproducerJobRunner(dawStore: TiendaDAW, opts: { onPhase?: (label: string) => void } = {}): void {
  registerAgentJobRunner(async (job, signal) => {
    if (signal.aborted) return
    if (job.kind === 'certify' || typeof window === 'undefined' || !window.electron?.aiChat) {
      await runPostTurnCertifyPipeline(dawStore, [], {})
      return
    }
    if (job.kind !== 'harness-until-plan') return
    const cfg = loadAiSettings()
    const sc = createStandaloneEngineChat(dawStore, { mode: 'create', userText: 'harness-until-plan' })
    signal.addEventListener('abort', () => sc.abort(), { once: true })
    await runHarnessUntilPlanComplete(
      {
        dawStore,
        budget: createBudgetGuard(sc.budget),
        chat: async (userContent) => {
          try {
            const r = await sc.chat({
              purpose: 'harness',
              system: buildAgentSystemPrompt(dawStore.obtenerEstado(), userContent, 'create', []),
              messages: [{ role: 'user', content: userContent }],
              temperature: Math.max(cfg.temperature, 0.35),
              maxTokens: Math.min(cfg.maxTokens, 8192),
            })
            return { success: r.success, content: r.content }
          } catch {
            return { success: false, content: '' }
          }
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
        onProgress: (phase) => opts.onPhase?.(phase),
        afterHarnessTurn: (turnResults, raw) => {
          const st = dawStore.obtenerEstado()
          return finishAgentTurn(st.project.id, st, turnResults, raw, { preferModelEval: true }).evaluation
        },
      },
      signal,
    )
  })
}

/** Runs del chat que quedaron «running» (recarga a mitad de turno) → interrumpidos. */
export async function findInterruptedRuns(tienda: TiendaDAW, conversationId: string): Promise<EngineRun[]> {
  if (!hasElectronRuns()) return []
  const engine = getAgentEngine(tienda)
  const metas = (await window.electron.agentRunList!(30)) ?? []
  const out: EngineRun[] = []
  for (const m of metas) {
    if (m.conversationId !== conversationId || m.status !== 'running' || engine.isActive(m.id)) continue
    const run = await engine.loadRun(m.id)
    if (!run) continue
    run.status = 'interrupted'
    run.updatedAt = Date.now()
    await window.electron.agentRunSave!(run.id, serializeEngineRun(run))
    out.push(run)
  }
  return out
}

export type { EngineEvent }
