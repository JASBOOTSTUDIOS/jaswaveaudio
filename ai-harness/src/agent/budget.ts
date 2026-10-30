/**
 * Presupuesto del agente: tope de llamadas al modelo, caracteres de entrada y tiempo de pared.
 *
 * Peor caso sin presupuesto: bucles externos (until-plan) × turnos de reparación (harness)
 * × capas de razonamiento, cada una reenviando el hilo completo. Un único tracker se comparte
 * entre razonamiento, harness, until-plan y agent-loop de un mismo turno del usuario, y cada
 * capa para con un mensaje claro en vez de seguir gastando.
 */

export type AgentBudget = {
  /** Llamadas al modelo (chat) permitidas en el turno. */
  maxModelCalls: number
  /** Suma de caracteres enviados al modelo (prompt completo de cada llamada). */
  maxInputChars: number
  /** Tiempo de pared máximo desde que arranca el turno (ms). */
  maxWallMs: number
}

/**
 * A5: turnos «hasta terminar» con pasos y QA: el tope pasa a ~200 llamadas / 2M de
 * caracteres / 60 min. Los tests y el CLI suelen pasar presupuestos explícitos.
 */
export const DEFAULT_AGENT_BUDGET: Readonly<AgentBudget> = Object.freeze({
  maxModelCalls: 200,
  maxInputChars: 2_000_000,
  maxWallMs: 60 * 60_000,
})

export type AgentBudgetStopReason = 'model-calls' | 'input-chars' | 'wall-time'

export type AgentBudgetUsage = {
  modelCalls: number
  inputChars: number
  startedAt: number
  elapsedMs: number
}

export type AgentBudgetTracker = {
  readonly budget: Readonly<AgentBudget>
  /** Motivo de parada si ya se agotó (o null). */
  exceeded(): AgentBudgetStopReason | null
  /**
   * Reserva una llamada al modelo con `inputChars` de entrada.
   * Devuelve el motivo si la llamada NO debe hacerse (presupuesto agotado); null si se cargó.
   */
  tryCharge(inputChars: number): AgentBudgetStopReason | null
  /** Igual que tryCharge pero lanza AgentBudgetExceededError. */
  charge(inputChars: number): void
  usage(): AgentBudgetUsage
  /** Caracteres de entrada que aún caben (para compactar antes de enviar). */
  remainingInputChars(): number
  /**
   * Contabiliza intentos HTTP extra ya realizados (reintentos del gateway) sin bloquear:
   * cada intento real cuenta como llamada al modelo.
   */
  recordExtraCalls?(n: number): void
}

/** Consumo previo para reanudar un turno persistido sin regalar presupuesto. */
export type AgentBudgetInitialUsage = {
  modelCalls?: number
  inputChars?: number
  elapsedMs?: number
}

export class AgentBudgetExceededError extends Error {
  readonly reason: AgentBudgetStopReason
  readonly usage: AgentBudgetUsage
  constructor(reason: AgentBudgetStopReason, usage: AgentBudgetUsage, budget: AgentBudget) {
    super(formatAgentBudgetStop(reason, usage, budget))
    this.name = 'AgentBudgetExceededError'
    this.reason = reason
    this.usage = usage
  }
}

export function isAgentBudgetExceededError(e: unknown): e is AgentBudgetExceededError {
  return e instanceof AgentBudgetExceededError || (e as { name?: string } | null)?.name === 'AgentBudgetExceededError'
}

function positiveOr(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function resolveAgentBudget(partial?: Partial<AgentBudget> | null): AgentBudget {
  return {
    maxModelCalls: Math.floor(positiveOr(partial?.maxModelCalls, DEFAULT_AGENT_BUDGET.maxModelCalls)),
    maxInputChars: Math.floor(positiveOr(partial?.maxInputChars, DEFAULT_AGENT_BUDGET.maxInputChars)),
    maxWallMs: Math.floor(positiveOr(partial?.maxWallMs, DEFAULT_AGENT_BUDGET.maxWallMs)),
  }
}

export function createAgentBudgetTracker(
  partial?: Partial<AgentBudget> | null,
  now: () => number = Date.now,
  initial?: AgentBudgetInitialUsage | null,
): AgentBudgetTracker {
  const budget = Object.freeze(resolveAgentBudget(partial))
  const startedAt = now() - Math.max(0, Math.floor(Number(initial?.elapsedMs) || 0))
  let modelCalls = Math.max(0, Math.floor(Number(initial?.modelCalls) || 0))
  let inputChars = Math.max(0, Math.floor(Number(initial?.inputChars) || 0))

  const usage = (): AgentBudgetUsage => ({
    modelCalls,
    inputChars,
    startedAt,
    elapsedMs: Math.max(0, now() - startedAt),
  })

  const exceeded = (): AgentBudgetStopReason | null => {
    if (modelCalls >= budget.maxModelCalls) return 'model-calls'
    if (inputChars >= budget.maxInputChars) return 'input-chars'
    if (now() - startedAt >= budget.maxWallMs) return 'wall-time'
    return null
  }

  const tryCharge = (chars: number): AgentBudgetStopReason | null => {
    const pre = exceeded()
    if (pre) return pre
    const c = Math.max(0, Math.floor(Number(chars) || 0))
    if (inputChars + c > budget.maxInputChars) return 'input-chars'
    modelCalls += 1
    inputChars += c
    return null
  }

  return {
    budget,
    exceeded,
    tryCharge,
    charge(chars: number) {
      const r = tryCharge(chars)
      if (r) throw new AgentBudgetExceededError(r, usage(), budget)
    },
    usage,
    remainingInputChars: () => Math.max(0, budget.maxInputChars - inputChars),
    recordExtraCalls(n: number) {
      const k = Math.max(0, Math.floor(Number(n) || 0))
      modelCalls += k
    },
  }
}

/**
 * Vista de solo-guarda de un tracker: `tryCharge` comprueba pero NO carga.
 * La usan las capas antiguas (razonamiento, agent loop, harness) cuando el chat real ya pasa por
 * el motor (A1), que carga cada intento HTTP una sola vez: así no se cuenta doble.
 */
export function createBudgetGuard(tracker: AgentBudgetTracker): AgentBudgetTracker {
  const check = (chars: number): AgentBudgetStopReason | null => {
    const pre = tracker.exceeded()
    if (pre) return pre
    const c = Math.max(0, Math.floor(Number(chars) || 0))
    return c > tracker.remainingInputChars() ? 'input-chars' : null
  }
  return {
    budget: tracker.budget,
    exceeded: () => tracker.exceeded(),
    tryCharge: check,
    charge(chars: number) {
      const r = check(chars)
      if (r) throw new AgentBudgetExceededError(r, tracker.usage(), tracker.budget)
    },
    usage: () => tracker.usage(),
    remainingInputChars: () => tracker.remainingInputChars(),
    recordExtraCalls: () => undefined,
  }
}

/** Acepta un tracker compartido o un presupuesto parcial (crea uno nuevo con defaults). */
export function resolveAgentBudgetTracker(
  b?: AgentBudgetTracker | Partial<AgentBudget> | null,
): AgentBudgetTracker {
  if (b && typeof (b as AgentBudgetTracker).tryCharge === 'function') return b as AgentBudgetTracker
  return createAgentBudgetTracker(b as Partial<AgentBudget> | undefined)
}

export function formatAgentBudgetStop(
  reason: AgentBudgetStopReason,
  usage: AgentBudgetUsage,
  budget: AgentBudget,
): string {
  const what =
    reason === 'model-calls'
      ? `se alcanzó el tope de ${budget.maxModelCalls} llamadas al modelo`
      : reason === 'input-chars'
        ? `se alcanzó el tope de ${Math.round(budget.maxInputChars / 1000)}k caracteres enviados al modelo`
        : `se alcanzó el tope de ${Math.round(budget.maxWallMs / 60_000)} min de trabajo`
  return `Presupuesto del agente agotado: ${what} (${usage.modelCalls} llamadas, ${Math.round(
    usage.inputChars / 1000,
  )}k caracteres, ${Math.round(usage.elapsedMs / 1000)} s). Me detengo aquí; pídeme que continúe si quieres seguir.`
}

export function formatAgentBudgetStopFor(tracker: AgentBudgetTracker, reason?: AgentBudgetStopReason | null): string {
  const r = reason ?? tracker.exceeded() ?? 'model-calls'
  return formatAgentBudgetStop(r, tracker.usage(), tracker.budget)
}
