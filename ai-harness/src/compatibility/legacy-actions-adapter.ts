import type { HarnessDawAction } from '../types/actions'

/** Contrato interno alineado a Tool Registry (no confundir con ExecutionPlan plano). */
export type AgentToolCall = {
  id?: string
  tool: string
  arguments: Record<string, unknown>
}

const META_KEYS = new Set(['type', 'tool', 'id', 'arguments', 'payload', 'name', 'function'])

/**
 * Unifica formas que emiten los modelos:
 * - { type, payload:{ bpm } }
 * - { type, arguments:{ bpm } }
 * - { type, bpm: 125 }  (flat — antes se perdía)
 * - { type, arguments:{ payload:{ bpm } } } (doble anidado)
 */
export function normalizeToolArgs(o: Record<string, unknown>): Record<string, unknown> {
  const pickNested = (v: unknown): Record<string, unknown> | null => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    return v as Record<string, unknown>
  }

  let nested = pickNested(o.arguments) ?? pickNested(o.payload) ?? {}
  // Unwrap accidental { payload: {...} } / { arguments: {...} }
  const inner =
    pickNested(nested.payload) ?? pickNested(nested.arguments) ?? null
  if (inner) {
    const { payload: _p, arguments: _a, ...rest } = nested
    nested = { ...rest, ...inner }
  }

  const flat: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (META_KEYS.has(k)) continue
    flat[k] = v
  }
  return { ...flat, ...nested }
}

export function legacyActionsToToolCalls(actions: HarnessDawAction[]): AgentToolCall[] {
  return actions
    .filter((a) => typeof a.type === 'string' && a.type.trim().length > 0)
    .map((a) => {
      const raw = a as HarnessDawAction & Record<string, unknown>
      return {
        tool: a.type,
        arguments: normalizeToolArgs(raw),
      }
    })
}

export function toolCallsToLegacyActions(calls: AgentToolCall[]): HarnessDawAction[] {
  return calls
    .filter((c) => typeof c.tool === 'string' && c.tool.trim().length > 0)
    .map((c) => ({
      type: c.tool,
      payload: c.arguments ?? {},
    }))
}

export function filterUnknownTools(
  actions: HarnessDawAction[],
  known: ReadonlySet<string> | Iterable<string>,
): { known: HarnessDawAction[]; unknown: HarnessDawAction[] } {
  const set = known instanceof Set ? known : new Set(known)
  const ok: HarnessDawAction[] = []
  const bad: HarnessDawAction[] = []
  for (const a of actions) {
    if (set.has(a.type)) ok.push(a)
    else bad.push(a)
  }
  return { known: ok, unknown: bad }
}
