/**
 * Contexto que el motor entrega a un programa de turno: chat único, ejecución de herramientas
 * con bitácora y eventos, persistencia y datos del run.
 */

import type { AgentBudgetTracker } from '../agent/budget'
import { agentActionClass, type AgentActionClass } from '../agent/action-policy'
import { engineChat, type EngineChatOptions, type EngineChatResult } from './chat'
import type {
  EngineAgentRole,
  EngineEventPayload,
  EngineHost,
  EngineToolCall,
  EngineToolResult,
  TurnInput,
} from './engine-types'
import type { ModeCapabilities } from './mode-capabilities'
import { appendRunLog, summarizeToolArgs, type EngineRun, type EngineRunLogEntry } from './run-state'

export type TurnContext = {
  readonly run: EngineRun
  readonly input: TurnInput
  readonly host: EngineHost
  readonly signal: AbortSignal
  readonly budget: AgentBudgetTracker
  readonly capabilities: ModeCapabilities
  readonly protocol: { current: 'native' | 'markers' }
  emit(e: EngineEventPayload): void
  phase(label: string, phase?: string): void
  message(text: string, opts?: { final?: boolean; data?: unknown; role?: EngineAgentRole }): void
  /** Chat único (system prompt + fallback + presupuesto + tools/markers). */
  chat(opts: EngineChatOptions): Promise<EngineChatResult>
  /**
   * Ejecuta herramientas vía host con bitácora y eventos. Defensa en profundidad:
   * sin clase → rechazada; destructiva/sistema sin `userConfirmed` → rechazada.
   */
  executeTools(calls: EngineToolCall[], opts?: { userConfirmed?: boolean; role?: EngineAgentRole }): Promise<EngineToolResult[]>
  classify(call: EngineToolCall): AgentActionClass | undefined
  log(entry: Omit<EngineRunLogEntry, 'at'>): void
  readPlan(): Promise<string | null>
  /** Guarda un snapshot del host (A5) para `engine.undoTurn`/`engine.undoStep`. */
  captureSnapshot(kind: 'turn' | 'step', stepId?: string): Promise<void>
  persist(): Promise<void>
  setData(patch: Record<string, unknown>): void
  newId(prefix: string): string
  throwIfAborted(): void
}

export function createTurnContext(opts: {
  run: EngineRun
  host: EngineHost
  signal: AbortSignal
  budget: AgentBudgetTracker
  capabilities: ModeCapabilities
  emit: (e: EngineEventPayload) => void
  persist: () => Promise<void>
  newId: (prefix: string) => string
  history?: TurnInput['history']
  /** A5: el motor guarda aquí el snapshot del host (undo por turno/paso). */
  rememberSnapshot?: (kind: 'turn' | 'step', snapshot: unknown, stepId?: string) => void
}): TurnContext {
  const { run, host, signal, budget } = opts
  const protocol: { current: 'native' | 'markers' } = { current: run.protocol ?? 'native' }
  const input: TurnInput = { ...run.input, history: opts.history }

  const readPlan = async (): Promise<string | null> => {
    if (run.input.planOverride?.trim()) return run.input.planOverride
    try {
      return (await host.readDoc?.('plan.md')) ?? null
    } catch {
      return null
    }
  }

  const classify = (call: EngineToolCall): AgentActionClass | undefined =>
    host.classifyTool ? host.classifyTool(call) : agentActionClass({ type: call.name, payload: call.arguments })

  const log = (entry: Omit<EngineRunLogEntry, 'at'>) => {
    appendRunLog(run, { ...entry, at: host.now() })
    run.updatedAt = host.now()
  }

  const throwIfAborted = () => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  }

  const ctx: TurnContext = {
    run,
    input,
    host,
    signal,
    budget,
    capabilities: opts.capabilities,
    protocol,
    emit: opts.emit,
    phase(label, phase = 'phase') {
      opts.emit({ type: 'phase', phase, label })
      log({ kind: 'phase', message: label })
    },
    message(text, mopts) {
      opts.emit({ type: 'agent.message', role: mopts?.role ?? run.role, text, final: mopts?.final, data: mopts?.data })
    },
    async chat(copts) {
      const res = await engineChat(
        {
          host,
          runId: run.id,
          mode: run.mode,
          role: copts.role ?? run.role,
          userText: run.userText,
          budget,
          signal,
          emit: opts.emit,
          plan: readPlan,
          protocol,
        },
        copts,
      )
      if (copts.tools?.length) run.protocol = protocol.current
      log({
        kind: 'chat',
        role: copts.role ?? run.role,
        status: res.success ? 'ok' : res.budgetStop ? 'budget' : 'error',
        message: [copts.purpose, res.usedModel, res.protocol, res.success ? '' : res.error].filter(Boolean).join(' · '),
      })
      return res
    },
    async executeTools(calls, eopts) {
      throwIfAborted()
      const role = eopts?.role ?? run.role
      const userConfirmed = eopts?.userConfirmed === true
      const allowed: EngineToolCall[] = []
      const out = new Map<string, EngineToolResult>()
      for (const c of calls) {
        opts.emit({ type: 'tool.call', role, call: c })
        const cls = classify(c)
        if (cls === undefined || ((cls === 'destructive' || cls === 'system') && !userConfirmed)) {
          const r: EngineToolResult = {
            callId: c.id,
            name: c.name,
            status: 'rejected',
            error: {
              code: cls === undefined ? 'UNCLASSIFIED' : 'CONFIRMATION_REQUIRED',
              message:
                cls === undefined
                  ? `Bloqueada: ${c.name} no tiene clase de riesgo conocida (fail closed).`
                  : c.name === 'midi.notes.set'
                    ? 'midi.notes.set con notas vacías borraría todas las notas del clip y eso lo tiene que confirmar el usuario: manda la lista completa de notas nuevas, o cambia solo algunas con midi.notes.patch.'
                    : `Requiere confirmación del usuario: ${c.name}.`,
            },
          }
          out.set(c.id, r)
        } else {
          allowed.push(c)
        }
      }
      if (allowed.length) {
        const t0 = host.now()
        let results: EngineToolResult[]
        try {
          results = await host.executeTools(allowed, { runId: run.id, mode: run.mode, role, userConfirmed, signal })
        } catch (e) {
          results = allowed.map((c) => ({
            callId: c.id,
            name: c.name,
            status: 'error' as const,
            error: { code: 'HOST_THROW', message: e instanceof Error ? e.message : String(e) },
          }))
        }
        const dt = Math.max(0, host.now() - t0)
        for (const c of allowed) {
          const r = results.find((x) => x.callId === c.id) ?? {
            callId: c.id,
            name: c.name,
            status: 'error' as const,
            error: { code: 'NO_RESULT', message: 'El host no devolvió resultado' },
          }
          out.set(c.id, { ...r, durationMs: r.durationMs ?? Math.round(dt / allowed.length) })
        }
      }
      const ordered = calls.map((c) => out.get(c.id)!)
      for (const [i, r] of ordered.entries()) {
        const c = calls[i]!
        if (r.status === 'success') run.executedCallKeys.push(c.id)
        opts.emit({ type: 'tool.result', role, result: r })
        log({
          kind: 'tool',
          role,
          tool: c.name,
          callId: c.id,
          args: summarizeToolArgs(c.arguments),
          status: r.status,
          message: r.error?.message,
          durationMs: r.durationMs,
          undoId: r.undoId,
        })
      }
      return ordered
    },
    classify,
    log,
    readPlan,
    async captureSnapshot(kind, stepId) {
      if (!host.captureSnapshot) return
      try {
        const snap = await host.captureSnapshot({ runId: run.id, kind, stepId })
        opts.rememberSnapshot?.(kind, snap, stepId)
      } catch (e) {
        log({ kind: 'note', message: `snapshot ${kind} no disponible: ${e instanceof Error ? e.message : String(e)}` })
      }
    },
    persist: opts.persist,
    setData(patch) {
      run.data = { ...(run.data ?? {}), ...patch }
    },
    newId: opts.newId,
    throwIfAborted,
  }
  return ctx
}
