/**
 * Checklist de tareas del agente: ejecutar una a una con confirmación Continuar.
 */

import type { DawAction } from './ai-daw-agent'
import { labelForAction } from './describe-action'

export { labelForAction, describeActionForUser } from './describe-action'
export type { ActionDescription } from './describe-action'

export type AgentChecklistItemStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'done'
  | 'skipped'
  | 'failed'

export type AgentChecklistItem = {
  id: string
  label: string
  status: AgentChecklistItemStatus
  actions: DawAction[]
  detail?: string
  error?: string
}

export type AgentChecklist = {
  status: 'active' | 'done' | 'stopped'
  currentIndex: number
  items: AgentChecklistItem[]
}

const CHECKLIST_RE = /<<<CHECKLIST\s*([\s\S]*?)\s*CHECKLIST>>>/i

export function stripChecklistBlock(text: string): string {
  return text.replace(CHECKLIST_RE, '').replace(/\n{3,}/g, '\n\n').trim()
}

/** Parsea <<<CHECKLIST [{id,label,actions:[...]}] CHECKLIST>>> del modelo. */
export function parseChecklistFromText(text: string): AgentChecklist | null {
  const m = CHECKLIST_RE.exec(text)
  if (!m) return null
  let raw = m[1]!.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  try {
    const start = raw.indexOf('[')
    const end = raw.lastIndexOf(']')
    if (start >= 0 && end > start) raw = raw.slice(start, end + 1)
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || !parsed.length) return null
    const items: AgentChecklistItem[] = []
    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i]
      if (!row || typeof row !== 'object') continue
      const o = row as Record<string, unknown>
      const actionsRaw = o.actions ?? o.acciones
      const actions: DawAction[] = []
      if (Array.isArray(actionsRaw)) {
        for (const a of actionsRaw) {
          if (a && typeof a === 'object' && typeof (a as { type?: string }).type === 'string') {
            actions.push({
              type: String((a as { type: string }).type),
              payload: ((a as { payload?: Record<string, unknown> }).payload ?? {}) as Record<
                string,
                unknown
              >,
            })
          }
        }
      } else if (typeof o.type === 'string') {
        actions.push({
          type: o.type,
          payload: (o.payload as Record<string, unknown> | undefined) ?? {},
        })
      }
      if (!actions.length) continue
      items.push({
        id: String(o.id ?? `t${i + 1}`),
        label: String(o.label ?? o.title ?? labelForAction(actions[0]!)).slice(0, 120),
        status: 'pending',
        actions,
        detail: typeof o.detail === 'string' ? o.detail : undefined,
      })
    }
    if (!items.length) return null
    return normalizeChecklist({ status: 'active', currentIndex: 0, items })
  } catch {
    return null
  }
}

export function buildChecklistFromActions(actions: DawAction[]): AgentChecklist | null {
  const mutating = actions.filter((a) => !isLikelyReadOnly(a.type))
  const list = mutating.length ? mutating : actions
  if (!list.length) return null
  const items: AgentChecklistItem[] = list.map((a, i) => ({
    id: `t${i + 1}`,
    label: labelForAction(a),
    status: 'pending' as const,
    actions: [a],
  }))
  return normalizeChecklist({ status: 'active', currentIndex: 0, items })
}

function isLikelyReadOnly(type: string): boolean {
  return /^(doc\.read|doc\.list|library\.preset\.(list|search)|plugin\.(lookup|probe)|analysis\.|web\.search|track\.getFxChain)/i.test(
    type,
  )
}

export function normalizeChecklist(list: AgentChecklist): AgentChecklist {
  const items: AgentChecklistItem[] = list.items.map((it, i) => {
    if (it.status === 'done' || it.status === 'skipped' || it.status === 'failed') return it
    if (i === list.currentIndex && list.status === 'active') {
      return { ...it, status: 'ready' }
    }
    // Pasos anteriores al índice actual: ya ejecutados (o se marcan done)
    if (i < list.currentIndex) {
      return { ...it, status: 'done' }
    }
    return { ...it, status: 'pending' }
  })
  const allDone = items.every((it) => it.status === 'done' || it.status === 'skipped')
  return {
    ...list,
    status: list.status === 'stopped' ? 'stopped' : allDone ? 'done' : 'active',
    items,
  }
}

export function currentChecklistItem(list: AgentChecklist): AgentChecklistItem | null {
  if (list.status !== 'active') return null
  return list.items[list.currentIndex] ?? null
}

/** Marca el paso del checklist como done/failed y avanza el índice. */
export function advanceChecklistAfterStep(
  list: AgentChecklist,
  stepId: string,
  outcome: 'done' | 'failed' | 'skipped',
  error?: string,
): AgentChecklist {
  const idx = list.items.findIndex((it) => it.id === stepId)
  if (idx < 0) return list
  const items = list.items.map((it, i) =>
    i === idx
      ? {
          ...it,
          status: outcome,
          error: outcome === 'failed' ? error : undefined,
        }
      : it,
  )
  const nextIndex = outcome === 'done' || outcome === 'skipped' ? idx + 1 : idx
  return normalizeChecklist({
    status: list.status === 'stopped' ? 'stopped' : 'active',
    currentIndex: Math.min(Math.max(0, nextIndex), Math.max(0, items.length - 1)),
    items,
  })
}
