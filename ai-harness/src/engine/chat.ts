/**
 * Única ruta de chat del agente (A1): TODO chat del motor pasa por `engineChat`.
 *
 * Garantías:
 *  - siempre hay system prompt (base + modo + rol + contexto DAW vía host + plan + regla de datos no confiables);
 *  - fallback de modelos (lo hace el host) con CADA intento HTTP cargado al presupuesto del turno;
 *  - tool-calling nativo cuando el proveedor lo soporta y caída automática a marcadores `<<<DECISION>>>` (A2).
 */

import { UNTRUSTED_TOOL_DATA_RULE, wrapUntrustedToolResult } from '../agent/untrusted'
import type { AgentBudgetStopReason, AgentBudgetTracker } from '../agent/budget'
import { formatAgentBudgetStopFor } from '../agent/budget'
import type {
  EngineAgentRole,
  EngineChatMessage,
  EngineChatPurpose,
  EngineEventPayload,
  EngineHost,
  EngineHostChatResponse,
  EngineMode,
  EngineToolCall,
  EngineToolChoice,
  EngineToolSchema,
} from './engine-types'

/** Bloque de rol (A6 lo sustituirá por prompts por agente). */
export const ENGINE_ROLE_PROMPTS: Readonly<Record<EngineAgentRole, string>> = Object.freeze({
  coproductor: '',
  director:
    '## Rol: Director\nEntiendes el pedido, mantienes el plan con pasos medibles, asignas cada paso y decides cuándo termina el turno.',
  productor:
    '## Rol: Productor / Arreglista\nEstructura, armonía, MIDI, instrumentos y estilo. Delega la mezcla al ingeniero de mezcla.',
  mezcla:
    '## Rol: Ingeniero de mezcla\nProtocolo: medir → diagnosticar → pocos cambios con valores reales → re-medir → comparar.',
  mastering:
    '## Rol: Ingeniero de mastering\nCadena master, loudness por plataforma, true-peak y balance tonal; verifica con medición.',
  qa: '## Rol: QA / Escucha\nSolo verificas criterios con mediciones y emites un veredicto; nunca modificas el proyecto.',
})

/** Instrucciones del protocolo de marcadores cuando no hay tools nativas. */
export const MARKER_PROTOCOL_HINT = [
  '## Protocolo de herramientas (texto)',
  'Este modelo no usa tool-calling nativo. Para llamar herramientas emite:',
  '<<<DECISION',
  '{"type":"tool-calls","calls":[{"id":"c1","tool":"nombre.herramienta","arguments":{}}]}',
  'DECISION>>>',
  'Para terminar: <<<DECISION {"type":"complete","summary":"…"} DECISION>>>.',
  'Para preguntar al usuario: <<<DECISION {"type":"request-user-input","message":"…"} DECISION>>>.',
].join('\n')

export type EngineChatDeps = {
  host: EngineHost
  runId: string
  mode: EngineMode
  role: EngineAgentRole
  userText: string
  budget: AgentBudgetTracker
  signal: AbortSignal
  emit: (e: EngineEventPayload) => void
  /** Plan actual (plan.md o planOverride) — se ancla al system prompt si el host no lo incluyó. */
  plan?: () => Promise<string | null | undefined> | string | null | undefined
  /** Estado compartido: si un proveedor no soporta tools, el resto del turno usa marcadores. */
  protocol?: { current: 'native' | 'markers' }
}

export type EngineChatOptions = {
  purpose: EngineChatPurpose
  messages: EngineChatMessage[]
  /** System propio del llamador (p. ej. razonamiento). Si falta se usa el del host. */
  system?: string
  role?: EngineAgentRole
  mode?: EngineMode
  tools?: EngineToolSchema[]
  toolChoice?: EngineToolChoice
  temperature?: number
  maxTokens?: number
  iteration?: number
  onDelta?: (text: string) => void
  /** No anclar plan.md (p. ej. prompts de razonamiento que ya lo resumen). */
  skipPlan?: boolean
}

export type EngineChatResult = EngineHostChatResponse & {
  /** Protocolo efectivo de esta respuesta. */
  protocol: 'native' | 'markers' | 'text'
  budgetStop?: AgentBudgetStopReason
  budgetMessage?: string
  /** System prompt efectivo (para tests/auditoría). */
  system: string
}

const PLAN_MAX_CHARS = 4_000

function messageChars(m: EngineChatMessage): number {
  const base = m.content?.length ?? 0
  if (m.role === 'assistant' && m.toolCalls?.length) return base + JSON.stringify(m.toolCalls).length
  return base
}

/** Añade al system las piezas obligatorias que falten (idempotente). */
export function ensureSystemRules(
  system: string,
  opts: { role: EngineAgentRole; plan?: string | null; markers?: boolean },
): string {
  const parts = [system.trim()]
  const roleBlock = ENGINE_ROLE_PROMPTS[opts.role]
  if (roleBlock && !system.includes(roleBlock.split('\n')[0]!)) parts.push(roleBlock)
  const plan = opts.plan?.trim()
  if (plan && !system.includes('plan.md') && !system.includes('## Plan actual')) {
    parts.push(['## Plan actual (plan.md — el usuario puede editarlo)', plan.slice(0, PLAN_MAX_CHARS)].join('\n'))
  }
  if (opts.markers && !system.includes('<<<DECISION')) parts.push(MARKER_PROTOCOL_HINT)
  if (!system.includes(UNTRUSTED_TOOL_DATA_RULE)) parts.push(UNTRUSTED_TOOL_DATA_RULE)
  return parts.filter(Boolean).join('\n\n')
}

/**
 * Convierte el hilo nativo a texto para proveedores sin tools:
 * tool_calls → bloque DECISION; resultados → mensaje user con <tool_result untrusted>.
 */
export function toMarkerMessages(messages: EngineChatMessage[]): EngineChatMessage[] {
  const out: EngineChatMessage[] = []
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const decision = {
        type: 'tool-calls',
        calls: m.toolCalls.map((c) => ({ id: c.id, tool: c.name, arguments: c.arguments })),
      }
      out.push({
        role: 'assistant',
        content: [m.content?.trim(), `<<<DECISION\n${JSON.stringify(decision)}\nDECISION>>>`].filter(Boolean).join('\n\n'),
      })
    } else if (m.role === 'tool') {
      const prev = out[out.length - 1]
      const text = m.content.includes('untrusted="true"') ? m.content : wrapUntrustedToolResult(m.name, m.content)
      if (prev && prev.role === 'user' && prev.content.startsWith('Resultados de herramientas')) {
        prev.content = `${prev.content}\n${text}`
      } else {
        out.push({ role: 'user', content: `Resultados de herramientas:\n${text}` })
      }
    } else {
      out.push({ ...m })
    }
  }
  return out
}

async function resolvePlan(deps: EngineChatDeps): Promise<string | null> {
  try {
    const p = typeof deps.plan === 'function' ? await deps.plan() : deps.plan
    return p ?? null
  } catch {
    return null
  }
}

/**
 * Chat único del agente. Nunca lanza por errores del proveedor: devuelve success:false.
 * Lanza AbortError si la señal se cancela.
 */
export async function engineChat(deps: EngineChatDeps, opts: EngineChatOptions): Promise<EngineChatResult> {
  const role = opts.role ?? deps.role
  const mode = opts.mode ?? deps.mode
  const protocol = deps.protocol ?? { current: 'native' as const }
  if (deps.signal.aborted) throw new DOMException('Aborted', 'AbortError')

  const callerSystems = opts.messages.filter((m) => m.role === 'system').map((m) => m.content)
  const rest = opts.messages.filter((m) => m.role !== 'system')
  const baseSystem =
    opts.system ??
    (callerSystems.length
      ? callerSystems.join('\n\n')
      : await deps.host.buildSystemPrompt({ mode, role, purpose: opts.purpose, userText: deps.userText, runId: deps.runId }))
  const plan = opts.skipPlan ? null : await resolvePlan(deps)

  const wantsTools = Boolean(opts.tools?.length)
  const attempt = async (useNative: boolean): Promise<EngineChatResult> => {
    const system = ensureSystemRules(baseSystem, { role, plan, markers: wantsTools && !useNative })
    const thread = useNative ? rest : toMarkerMessages(rest)
    const messages: EngineChatMessage[] = [{ role: 'system', content: system }, ...thread]
    const tools = useNative ? opts.tools : undefined
    const chars = messages.reduce((n, m) => n + messageChars(m), 0) + (tools ? JSON.stringify(tools).length : 0)

    let budgetStop: AgentBudgetStopReason | undefined
    let charged = 0
    const pre = deps.budget.exceeded()
    if (pre) budgetStop = pre
    const res: EngineHostChatResponse = budgetStop
      ? { success: false, error: 'Presupuesto agotado', errorCode: 'budget' }
      : await deps.host.chat(
          {
            messages,
            tools,
            toolChoice: tools ? (opts.toolChoice ?? 'auto') : undefined,
            temperature: opts.temperature,
            maxTokens: opts.maxTokens,
            meta: { runId: deps.runId, purpose: opts.purpose, role, mode, iteration: opts.iteration },
          },
          {
            signal: deps.signal,
            onDelta: opts.onDelta,
            beforeAttempt: (a) => {
              const stop = deps.budget.tryCharge(chars)
              if (stop) {
                budgetStop = stop
                return false
              }
              charged += 1
              if (a.index > 0) {
                deps.emit({ type: 'phase', phase: 'chat.fallback', label: `Modelo sin respuesta → ${a.label} (${a.index + 1}/${a.total})` })
              }
              return true
            },
          },
        )
    if (deps.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (res.httpAttempts && res.httpAttempts > charged) deps.budget.recordExtraCalls?.(res.httpAttempts - charged)
    const usage = deps.budget.usage()
    deps.emit({ type: 'budget', usage, budget: { ...deps.budget.budget }, exceeded: deps.budget.exceeded() })
    const result: EngineChatResult = {
      ...res,
      system,
      protocol: tools ? 'native' : wantsTools ? 'markers' : 'text',
      ...(budgetStop
        ? { success: false, budgetStop, budgetMessage: formatAgentBudgetStopFor(deps.budget, budgetStop) }
        : {}),
    }
    if (!budgetStop) {
      deps.emit({
        type: 'provider',
        status: res.success ? 'online' : res.errorCode === 'missing_api_key' ? 'misconfigured' : 'offline',
        detail: res.success ? undefined : [res.error, res.hint].filter(Boolean).join(' — '),
        usedModel: res.usedModel,
        fallbackUsed: res.fallbackUsed,
        protocol: tools ? 'native' : wantsTools ? 'markers' : undefined,
      })
    }
    return result
  }

  if (wantsTools && protocol.current === 'native') {
    const first = await attempt(true)
    if (first.toolsUnsupported && !first.budgetStop) {
      protocol.current = 'markers'
      deps.host.log?.('info', 'engine.chat: proveedor sin tools nativas → marcadores', { runId: deps.runId })
      return attempt(false)
    }
    return first
  }
  return attempt(false)
}

/** Formatea un resultado de herramienta como mensaje `tool` no confiable. */
export function toolResultMessage(call: EngineToolCall, result: { status: string; data?: unknown; error?: { message: string } }, maxChars = 6_000): EngineChatMessage {
  const body =
    result.status === 'success'
      ? typeof result.data === 'string'
        ? result.data
        : JSON.stringify(result.data ?? { ok: true })
      : `[${result.status}] ${result.error?.message ?? ''}`
  return {
    role: 'tool',
    toolCallId: call.id,
    name: call.name,
    content: wrapUntrustedToolResult(call.name, body ?? '', maxChars),
  }
}
