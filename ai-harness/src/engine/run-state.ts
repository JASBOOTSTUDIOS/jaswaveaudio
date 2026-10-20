/**
 * Estado serializable de un turno (AgentRun del motor).
 *
 * Se persiste en cada transición (userData/agent-runs/<id>.json en la app) para que un turno
 * sobreviva a recargar la ventana: pasos, bitácora (A9 `run.log`), presupuesto, pendientes,
 * hilo del bucle nativo y datos del programa del host.
 */

import type { AgentBudget } from '../agent/budget'
import type {
  EngineAgentRole,
  EngineChatMessage,
  EngineMode,
  EngineNeed,
  EngineToolCall,
  TurnInput,
} from './engine-types'

export const ENGINE_RUN_VERSION = 1

/** Tope de entradas de bitácora por run (las más antiguas se descartan). */
export const ENGINE_RUN_LOG_MAX = 600

/** Tope de mensajes del hilo guardados (el resto se compacta). */
export const ENGINE_RUN_MESSAGES_MAX = 120

export type EngineRunStatus =
  | 'running'
  | 'waiting-user'
  | 'paused'
  | 'interrupted'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type EngineRunLogKind = 'phase' | 'chat' | 'tool' | 'need' | 'answer' | 'note' | 'error'

export type EngineRunLogEntry = {
  at: number
  kind: EngineRunLogKind
  role?: EngineAgentRole
  tool?: string
  callId?: string
  /** Argumentos resumidos (nunca el payload completo: notas MIDI, markdown…). */
  args?: string
  status?: string
  message?: string
  durationMs?: number
  undoId?: string
  stepId?: string
}

export type EngineRunStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'blocked'

export type EngineRunStep = {
  id: string
  title: string
  role?: EngineAgentRole
  status: EngineRunStepStatus
  evidence?: string[]
}

export type EngineRunBudgetSnapshot = {
  budget: AgentBudget
  modelCalls: number
  inputChars: number
  elapsedMs: number
}

export type EngineRun = {
  version: typeof ENGINE_RUN_VERSION
  id: string
  conversationId: string
  messageId?: string
  mode: EngineMode
  role: EngineAgentRole
  kind?: string
  userText: string
  /** Entrada original (sin historial) para reanudar. */
  input: Omit<TurnInput, 'history'>
  status: EngineRunStatus
  createdAt: number
  updatedAt: number
  /** Programa que ejecutó el turno (para enrutar answer/resume). */
  programId: string
  steps: EngineRunStep[]
  log: EngineRunLogEntry[]
  /** Hilo del bucle nativo (system excluido: se reconstruye en cada chat). */
  messages: EngineChatMessage[]
  pending?: EngineNeed
  /** Llamadas aprobadas pendientes de ejecutar (persistidas con el need). */
  pendingCalls?: EngineToolCall[]
  iterations: number
  /** Claves de llamada ya ejecutadas (idempotencia por turno). */
  executedCallKeys: string[]
  budget: EngineRunBudgetSnapshot
  /** Protocolo efectivo del último chat: tools nativas o marcadores. */
  protocol?: 'native' | 'markers'
  planApproved?: boolean
  summary?: string
  error?: string
  /** Datos propios del programa del host (p. ej. estado del flujo legacy). */
  data?: Record<string, unknown>
}

export function createEngineRun(opts: {
  id: string
  input: TurnInput
  programId: string
  budget: AgentBudget
  now: number
}): EngineRun {
  const { history: _history, ...input } = opts.input
  void _history
  return {
    version: ENGINE_RUN_VERSION,
    id: opts.id,
    conversationId: opts.input.conversationId,
    messageId: opts.input.messageId,
    mode: opts.input.mode,
    role: opts.input.role ?? 'coproductor',
    kind: opts.input.kind,
    userText: opts.input.text,
    input,
    status: 'running',
    createdAt: opts.now,
    updatedAt: opts.now,
    programId: opts.programId,
    steps: [],
    log: [],
    messages: [],
    iterations: 0,
    executedCallKeys: [],
    budget: { budget: opts.budget, modelCalls: 0, inputChars: 0, elapsedMs: 0 },
    planApproved: opts.input.planApproved === true || opts.input.mode === 'auto' ? true : undefined,
  }
}

/** Resumen corto de argumentos para la bitácora (≤ 160 caracteres, sin arrays grandes). */
export function summarizeToolArgs(args: Record<string, unknown> | undefined, max = 160): string {
  if (!args || typeof args !== 'object') return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(args)) {
    if (k.startsWith('__')) continue
    let s: string
    if (Array.isArray(v)) s = `[${v.length}]`
    else if (v && typeof v === 'object') s = '{…}'
    else if (typeof v === 'string') s = v.length > 40 ? `${JSON.stringify(v.slice(0, 40))}…` : JSON.stringify(v)
    else s = String(v)
    parts.push(`${k}=${s}`)
  }
  const out = parts.join(' ')
  return out.length > max ? `${out.slice(0, max - 1)}…` : out
}

export function appendRunLog(run: EngineRun, entry: EngineRunLogEntry): void {
  run.log.push(entry)
  if (run.log.length > ENGINE_RUN_LOG_MAX) run.log.splice(0, run.log.length - ENGINE_RUN_LOG_MAX)
}

/** Recorta el hilo guardado conservando el primer mensaje de usuario y los más recientes. */
export function compactRunMessages(messages: EngineChatMessage[], max = ENGINE_RUN_MESSAGES_MAX): EngineChatMessage[] {
  if (messages.length <= max) return messages
  const first = messages.find((m) => m.role === 'user')
  let tail = messages.slice(-(max - 1))
  // Un hilo no puede empezar con resultados de herramienta huérfanos.
  while (tail.length && tail[0]!.role === 'tool') tail = tail.slice(1)
  return first && !tail.includes(first) ? [first, ...tail] : tail
}

export function serializeEngineRun(run: EngineRun): string {
  return JSON.stringify({ ...run, messages: compactRunMessages(run.messages) })
}

const RUN_STATUSES: ReadonlySet<string> = new Set([
  'running',
  'waiting-user',
  'paused',
  'interrupted',
  'completed',
  'failed',
  'cancelled',
])

/** Parsea un run persistido; null si no es válido (archivo corrupto o de otra versión). */
export function parseEngineRun(raw: string | unknown): EngineRun | null {
  let o: unknown = raw
  if (typeof raw === 'string') {
    try {
      o = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!o || typeof o !== 'object') return null
  const r = o as Partial<EngineRun>
  if (r.version !== ENGINE_RUN_VERSION) return null
  if (typeof r.id !== 'string' || !r.id) return null
  if (typeof r.conversationId !== 'string') return null
  if (typeof r.status !== 'string' || !RUN_STATUSES.has(r.status)) return null
  if (typeof r.mode !== 'string' || typeof r.userText !== 'string') return null
  if (!r.budget || typeof r.budget !== 'object') return null
  return {
    ...(r as EngineRun),
    steps: Array.isArray(r.steps) ? r.steps : [],
    log: Array.isArray(r.log) ? r.log : [],
    messages: Array.isArray(r.messages) ? r.messages : [],
    executedCallKeys: Array.isArray(r.executedCallKeys) ? r.executedCallKeys : [],
    iterations: Number.isFinite(r.iterations) ? Number(r.iterations) : 0,
    programId: typeof r.programId === 'string' ? r.programId : 'tool-loop',
    input: r.input ?? { text: r.userText, mode: r.mode, conversationId: r.conversationId },
    role: r.role ?? 'coproductor',
  }
}

/** Estados en los que el run ya no avanza solo. */
export function isTerminalRunStatus(status: EngineRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

/** Id de run seguro para nombre de archivo. */
export const ENGINE_RUN_ID_RE = /^[A-Za-z0-9_-]{1,80}$/

export function isValidEngineRunId(id: unknown): id is string {
  return typeof id === 'string' && ENGINE_RUN_ID_RE.test(id)
}
