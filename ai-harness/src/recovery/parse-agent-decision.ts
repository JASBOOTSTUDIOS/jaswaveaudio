import { parseActionsFromText } from './legacy-actions-parser'
import { legacyActionsToToolCalls, normalizeToolArgs } from '../compatibility/legacy-actions-adapter'
import type { AgentDecision, AgentLoopToolCall } from '../loop/agent-run-types'

const DECISION_RE = /<<<DECISION\s*([\s\S]*?)\s*DECISION>>>/i
const DECISION_OPEN_RE = /<<<DECISION\s*([\s\S]+)/i
const CLARIFY_RE = /<<<CLARIFY\s*([\s\S]*?)\s*CLARIFY>>>/i
const ACTIONS_OPEN_RE = /<<<ACTIONS\s*([\s\S]+)/i

function withIds(calls: Array<{ tool: string; arguments: Record<string, unknown>; id?: string }>): AgentLoopToolCall[] {
  return calls.map((c, i) => ({
    id: c.id && c.id.length > 0 ? c.id : `c${i + 1}`,
    tool: c.tool,
    arguments: c.arguments ?? {},
  }))
}

function parseJsonBlob(raw: string): unknown {
  let t = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  return JSON.parse(t) as unknown
}

function asCalls(raw: unknown): AgentLoopToolCall[] {
  if (!Array.isArray(raw)) return []
  const mapped = raw
    .filter((x) => x && typeof x === 'object')
    .map((x) => {
      const o = x as Record<string, unknown>
      const tool = String(o.tool ?? o.type ?? '')
      const args = normalizeToolArgs(o)
      const id = typeof o.id === 'string' ? o.id : undefined
      return { id, tool, arguments: args }
    })
    .filter((c) => c.tool.length > 0)
  return withIds(mapped)
}

function decisionFromObject(parsed: unknown): AgentDecision | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const o = parsed as { type?: unknown; calls?: unknown; message?: unknown; reason?: unknown; summary?: unknown }
  const type = String(o.type ?? '')
  if (type === 'tool-calls') return { type: 'tool-calls', calls: asCalls(o.calls) }
  if (type === 'request-confirmation') {
    return {
      type: 'request-confirmation',
      message: String(o.message ?? 'Confirma para continuar'),
      calls: asCalls(o.calls),
    }
  }
  if (type === 'request-user-input') {
    return { type: 'request-user-input', message: String(o.message ?? '') }
  }
  if (type === 'replan') return { type: 'replan', reason: String(o.reason ?? '') }
  if (type === 'complete') return { type: 'complete', summary: String(o.summary ?? '') }
  if (type === 'fail') return { type: 'fail', reason: String(o.reason ?? '') }
  return null
}

/** Extrae el primer array JSON `[...]` balanceado (ACTIONS sueltas / fences). */
function extractJsonArray(text: string): unknown | null {
  const start = text.indexOf('[')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as unknown
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function extractJsonObject(text: string): unknown | null {
  const start = text.search(/\{\s*"type"\s*:/)
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as unknown
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function parseActionsLoose(text: string): AgentDecision | null {
  const closed = parseActionsFromText(text)
  if (closed.length) {
    return { type: 'tool-calls', calls: withIds(legacyActionsToToolCalls(closed)) }
  }
  const open = ACTIONS_OPEN_RE.exec(text)
  if (open) {
    const arr = extractJsonArray(open[1] ?? '')
    const calls = asCalls(arr)
    if (calls.length) return { type: 'tool-calls', calls }
  }
  // Array suelto de {type,payload} típico de modelos que olvidan marcadores
  if (/\{\s*"type"\s*:\s*"[a-z0-9]+(\.[a-z0-9]+)+"/i.test(text)) {
    const arr = extractJsonArray(text)
    const calls = asCalls(arr)
    if (calls.length) return { type: 'tool-calls', calls }
  }
  return null
}

export function parseAgentDecisionFromText(text: string): AgentDecision | null {
  const dec = DECISION_RE.exec(text)
  if (dec) {
    try {
      const fromClosed = decisionFromObject(parseJsonBlob(dec[1] ?? ''))
      if (fromClosed) return fromClosed
    } catch {
      /* fall through */
    }
  }

  const decOpen = !dec ? DECISION_OPEN_RE.exec(text) : null
  if (decOpen) {
    try {
      const obj = extractJsonObject(decOpen[1] ?? '') ?? parseJsonBlob(decOpen[1] ?? '')
      const fromOpen = decisionFromObject(obj)
      if (fromOpen) return fromOpen
    } catch {
      /* fall through */
    }
  }

  // JSON decision sin marcadores
  const bareObj = extractJsonObject(text)
  const fromBare = decisionFromObject(bareObj)
  if (fromBare) return fromBare

  const fromActions = parseActionsLoose(text)
  if (fromActions) return fromActions

  const clarify = CLARIFY_RE.exec(text)
  if (clarify) {
    return { type: 'request-user-input', message: (clarify[1] ?? '').trim() || 'Necesito una aclaración.' }
  }

  return null
}

/** Herramientas de control del bucle nativo (no tocan el DAW). */
export const AGENT_CONTROL_TOOLS = {
  complete: 'agent.complete',
  askUser: 'agent.askUser',
  fail: 'agent.fail',
} as const

export const AGENT_CONTROL_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(AGENT_CONTROL_TOOLS))

/** JSON Schemas de las herramientas de control (se añaden a las tools del rol en modo nativo). */
export const AGENT_CONTROL_TOOL_SCHEMAS: ReadonlyArray<{
  name: string
  description: string
  parameters: Record<string, unknown>
}> = [
  {
    name: AGENT_CONTROL_TOOLS.complete,
    description: 'Termina el turno cuando el pedido está cumplido y verificado. Incluye un resumen para el usuario.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'Resumen final para el usuario' } },
      required: ['summary'],
    },
  },
  {
    name: AGENT_CONTROL_TOOLS.askUser,
    description: 'Pide una aclaración REAL al usuario (solo si no puedes seguir sin ella).',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Pregunta concreta' } },
      required: ['message'],
    },
  },
  {
    name: AGENT_CONTROL_TOOLS.fail,
    description: 'Abandona el turno por un error irrecuperable, explicando el motivo.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
  },
]

export type NativeToolCallLike = { id?: string; name: string; arguments?: Record<string, unknown> }

/**
 * Decisión a partir de tool calls nativas (A2). Las de control mandan si no hay herramientas DAW;
 * si las hay, se ejecutan primero (el control se ignora en esa iteración).
 */
export function agentDecisionFromToolCalls(calls: NativeToolCallLike[], text = ''): AgentDecision | null {
  if (!calls.length) return null
  const work = calls.filter((c) => !AGENT_CONTROL_TOOL_NAMES.has(c.name))
  if (work.length) {
    return {
      type: 'tool-calls',
      calls: work.map((c, i) => ({
        id: c.id && c.id.length ? c.id : `c${i + 1}`,
        tool: c.name,
        arguments: c.arguments ?? {},
      })),
    }
  }
  const ctl = calls[0]!
  const args = ctl.arguments ?? {}
  if (ctl.name === AGENT_CONTROL_TOOLS.complete) {
    return { type: 'complete', summary: String(args.summary ?? '').trim() || text.trim() }
  }
  if (ctl.name === AGENT_CONTROL_TOOLS.askUser) {
    return { type: 'request-user-input', message: String(args.message ?? '').trim() || text.trim() || 'Necesito una aclaración.' }
  }
  return { type: 'fail', reason: String(args.reason ?? '').trim() || text.trim() || 'Fallo del agente' }
}

/**
 * Decisión unificada de una respuesta de chat: tool calls nativas → decisión; si no hay,
 * marcadores en el texto; y en modo nativo un texto sin marcadores es la respuesta final.
 */
export function agentDecisionFromChatResponse(
  res: { content?: string; toolCalls?: NativeToolCallLike[] },
  opts: { native: boolean },
): AgentDecision | null {
  const text = res.content ?? ''
  const fromTools = agentDecisionFromToolCalls(res.toolCalls ?? [], text)
  if (fromTools) return fromTools
  const fromText = parseAgentDecisionFromText(text)
  if (fromText) return fromText
  if (opts.native && text.trim()) return { type: 'complete', summary: text.trim() }
  return null
}
