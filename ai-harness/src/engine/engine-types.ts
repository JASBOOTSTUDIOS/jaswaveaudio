/**
 * Tipos del motor de turnos headless (A1).
 *
 * El motor no conoce React ni Electron: el cliente (jas-wave, CLI, tests) implementa
 * `EngineHost` y consume `EngineEvent`. Todo turno produce un `EngineRun` serializable
 * (ver run-state.ts) que sobrevive a recargar la ventana.
 */

import type { AgentMode } from '../agent/modes'
import type { AgentBudget, AgentBudgetStopReason, AgentBudgetUsage } from '../agent/budget'
import type { AgentActionClass } from '../agent/action-policy'
import type { EngineRun } from './run-state'

export type EngineMode = AgentMode

/**
 * Rol de agente que habla en un chat. `coproductor` = agente único actual;
 * el resto queda listo para el equipo multi-agente (A6).
 */
export type EngineAgentRole = 'coproductor' | 'director' | 'productor' | 'mezcla' | 'mastering' | 'qa'

/** Para qué se hace un chat (telemetría, mock por guion y tope de tokens). */
export type EngineChatPurpose =
  | 'reasoning'
  | 'agent'
  | 'final'
  | 'harness'
  | 'review'
  | 'council'
  | 'qa'
  | 'other'

/** Llamada a herramienta con nombre canónico (con puntos: `track.create`). */
export type EngineToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type EngineToolResultStatus = 'success' | 'error' | 'rejected' | 'cancelled'

export type EngineToolResult = {
  callId: string
  name: string
  status: EngineToolResultStatus
  data?: unknown
  error?: { code: string; message: string }
  durationMs?: number
  /** Id de undo (A5) si el host lo conoce. */
  undoId?: string
}

/** Mensajes del hilo del bucle nativo (incluye resultados de herramientas). */
export type EngineChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: EngineToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string }

/** Herramienta con JSON Schema (A2). */
export type EngineToolSchema = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type EngineToolChoice = 'auto' | 'none' | 'required'

/** Lo que el motor pide al host en cada chat. */
export type EngineHostChatRequest = {
  messages: EngineChatMessage[]
  tools?: EngineToolSchema[]
  toolChoice?: EngineToolChoice
  temperature?: number
  maxTokens?: number
  meta: {
    runId: string
    purpose: EngineChatPurpose
    role: EngineAgentRole
    mode: EngineMode
    iteration?: number
  }
}

export type EngineHostChatResponse = {
  success: boolean
  content?: string
  toolCalls?: EngineToolCall[]
  /**
   * El proveedor/modelo no soporta tools nativas (o las rechazó): el motor reintenta con el
   * protocolo de marcadores `<<<DECISION>>>`.
   */
  toolsUnsupported?: boolean
  error?: string
  errorCode?: string
  hint?: string
  provider?: string
  model?: string
  usedProviderId?: string
  usedModel?: string
  fallbackUsed?: boolean
  /** Intentos HTTP reales (incluye reintentos internos del gateway). */
  httpAttempts?: number
}

export type EngineChatAttempt = { index: number; total: number; label: string }

export type EngineHostChatOptions = {
  signal: AbortSignal
  /**
   * Se llama antes de CADA intento (modelo principal y fallbacks). Devuelve false si el
   * presupuesto no permite el intento: el host debe parar la cadena de fallback.
   */
  beforeAttempt: (attempt: EngineChatAttempt) => boolean
  /** Texto en streaming (si el host/proveedor lo soporta). */
  onDelta?: (text: string) => void
}

export type EngineToolExecContext = {
  runId: string
  mode: EngineMode
  role: EngineAgentRole
  /** El usuario aprobó explícitamente estas llamadas (tarjeta de confirmación). */
  userConfirmed: boolean
  signal: AbortSignal
}

export type EngineLogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Veredicto de QA de un paso del plan (A5). Sin `host.auditStep` el motor asume ok. */
export type EngineStepAudit = {
  ok: boolean
  issues?: string[]
  evidencia?: string[]
}

/** Petición de QA al terminar un paso (A5): el host puede inspeccionar el DAW. */
export type EngineAuditStepRequest = {
  runId: string
  step: {
    id: string
    fase: string
    agente: string
    titulo: string
    criterios: string[]
    estado: string
  }
}

/** Veredicto de QA del proyecto al cerrar un turno con plan (A5). */
export type EngineProjectAudit = { ok: boolean; issues?: string[] }

/** Snapshot para deshacer turno/paso (A5): el host serializa el estado que sabe restaurar. */
export type EngineSnapshotRequest = {
  runId: string
  kind: 'turn' | 'step'
  stepId?: string
}

export type EngineSystemPromptRequest = {
  mode: EngineMode
  role: EngineAgentRole
  purpose: EngineChatPurpose
  userText: string
  runId: string
}

/**
 * Lo que el cliente aporta al motor. Solo `chat`, `buildSystemPrompt` y `executeTools`
 * son obligatorios; el resto degrada con gracia (sin persistencia, sin docs…).
 */
export interface EngineHost {
  now(): number
  chat(req: EngineHostChatRequest, opts: EngineHostChatOptions): Promise<EngineHostChatResponse>
  /** Prompt de sistema del DAW: base + modo + contexto del proyecto + catálogo + docs. */
  buildSystemPrompt(req: EngineSystemPromptRequest): string | Promise<string>
  executeTools(calls: EngineToolCall[], ctx: EngineToolExecContext): Promise<EngineToolResult[]>
  /** Herramientas con JSON Schema para el rol y modo (A2/A3/A6). */
  listTools?(req: { mode: EngineMode; role: EngineAgentRole }): EngineToolSchema[]
  /** Clase de riesgo de una herramienta (por defecto, la política de ai-harness). */
  classifyTool?(call: EngineToolCall): AgentActionClass | undefined
  readDoc?(slug: string): string | null | undefined | Promise<string | null | undefined>
  writeDoc?(slug: string, content: string): void | Promise<void>
  log?(level: EngineLogLevel, message: string, data?: unknown): void
  persistRun?(run: EngineRun): Promise<void>
  loadRun?(runId: string): Promise<EngineRun | null>
  newId?(prefix: string): string
  /**
   * QA de un paso del plan antes de marcarlo hecho (A5). El host revisa el DAW real
   * contra los criterios; sin implementación el motor asume `ok: true`.
   */
  auditStep?(req: EngineAuditStepRequest): EngineStepAudit | Promise<EngineStepAudit>
  /** QA del proyecto al cerrar un turno con plan (A5). Sin implementación → sin avisos. */
  auditProject?(req: { runId: string }): EngineProjectAudit | Promise<EngineProjectAudit>
  /** Snapshot del estado que el host sabe restaurar (A5, undo por paso/turno). */
  captureSnapshot?(req: EngineSnapshotRequest): unknown | Promise<unknown>
  restoreSnapshot?(snapshot: unknown): void | Promise<void>
  /** Estrategia del turno. Sin programa → bucle nativo de herramientas (tool-loop). */
  program?: TurnProgram
  /** Presupuesto por defecto de cada turno. */
  budget?: Partial<AgentBudget>
}

/** Pedido del usuario que inicia un turno. */
export type TurnInput = {
  text: string
  mode: EngineMode
  conversationId: string
  messageId?: string
  role?: EngineAgentRole
  /** Plan editado por el usuario que sustituye a plan.md para este turno (A4). */
  planOverride?: string
  /**
   * Placeholder hasta A4: el plan del turno ya está aprobado (create ejecuta sin pedir
   * aprobación). En `auto` se considera aprobado siempre.
   */
  planApproved?: boolean
  /** Variante del turno (p. ej. 'apply' = aplicar una propuesta pendiente). */
  kind?: string
  /** Historial previo del chat (sin system). */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Datos propios del host (no se interpretan en el motor; se persisten con el run). */
  context?: Record<string, unknown>
  budget?: Partial<AgentBudget>
}

/** Algo que el motor necesita del usuario para seguir. */
export type EngineNeed =
  | {
      id: string
      kind: 'confirm'
      message: string
      calls: EngineToolCall[]
      reason: 'destructive' | 'system'
    }
  | { id: string; kind: 'approve-plan'; message: string; calls: EngineToolCall[]; plan?: string }
  | { id: string; kind: 'clarify'; message: string; questions?: unknown[] }
  /** Propuesta del flujo actual (tarjeta Aplicar): la decide el programa del host. */
  | { id: string; kind: 'apply'; message: string; data?: unknown }

export type EngineAnswer = {
  needId?: string
  approved?: boolean
  text?: string
  indices?: number[]
  plan?: string
  data?: unknown
}

export type EngineEventBase = { runId: string; at: number }

export type EngineEvent = EngineEventBase &
  (
    | { type: 'turn.started'; mode: EngineMode; conversationId: string; messageId?: string; text: string; kind?: string; resumed?: boolean }
    | { type: 'phase'; phase: string; label?: string }
    | { type: 'agent.message'; role: EngineAgentRole; text: string; final?: boolean; data?: unknown }
    | { type: 'agent.delta'; role: EngineAgentRole; text: string }
    | { type: 'tool.call'; role: EngineAgentRole; call: EngineToolCall }
    | { type: 'tool.result'; role: EngineAgentRole; result: EngineToolResult }
    | { type: 'plan.updated'; plan?: string; diff?: unknown }
    | { type: 'step.started'; stepId: string; title?: string; role?: EngineAgentRole }
    | { type: 'step.done'; stepId: string; status: 'done' | 'blocked' | 'skipped'; evidence?: string[] }
    | { type: 'needs-user'; need: EngineNeed }
    | { type: 'budget'; usage: AgentBudgetUsage; budget: AgentBudget; exceeded?: AgentBudgetStopReason | null }
    | {
        type: 'provider'
        status: 'online' | 'offline' | 'misconfigured'
        detail?: string
        usedModel?: string
        fallbackUsed?: boolean
        protocol?: 'native' | 'markers'
      }
    | { type: 'turn.done'; status: 'completed' | 'waiting-user' | 'paused'; summary: string; outcome?: unknown }
    | { type: 'turn.failed'; reason: 'cancelled' | 'budget' | 'error'; error: string; outcome?: unknown }
  )

/** Distribución sobre la unión (Omit normal no distribuye). */
export type EngineEventPayload = EngineEvent extends infer E
  ? E extends EngineEvent
    ? Omit<E, 'runId' | 'at'>
    : never
  : never

/** Resultado de un programa de turno. */
export type TurnProgramOutcome =
  | { status: 'completed'; summary: string; data?: unknown }
  | { status: 'needs-user'; need: EngineNeed; summary?: string; data?: unknown }
  | { status: 'failed'; error: string; reason?: 'budget' | 'error'; data?: unknown }

/** Estrategia de turno enchufable (bucle nativo por defecto o programa del host). */
export type TurnProgram = {
  id: string
  run(ctx: import('./turn-context').TurnContext): Promise<TurnProgramOutcome>
  /** Respuesta del usuario a un `needs-user` de este programa. */
  answer?(
    ctx: import('./turn-context').TurnContext,
    need: EngineNeed,
    answer: EngineAnswer,
  ): Promise<TurnProgramOutcome>
  /** Reanudar un run interrumpido (p. ej. tras recargar). Sin implementación → `run`. */
  resume?(ctx: import('./turn-context').TurnContext): Promise<TurnProgramOutcome>
}

export type EngineTurnResult = {
  runId: string
  status: EngineRun['status']
  summary: string
  outcome?: unknown
  run: EngineRun
}

/** Handle de un turno en curso: iterable de eventos + promesa del resultado. */
export type TurnHandle = AsyncIterable<EngineEvent> & {
  readonly runId: string
  readonly result: Promise<EngineTurnResult>
  cancel(): void
}
