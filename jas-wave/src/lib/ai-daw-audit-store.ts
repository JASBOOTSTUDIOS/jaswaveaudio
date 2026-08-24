/**
 * Historial auditable IA → DAW: tool, params, comandos, resultado y origen.
 */

export type AiDawAuditSource =
  | 'model_actions'
  | 'fallback'
  | 'harness'
  | 'user_build'
  | 'user_confirm'

export type AiDawAuditStatus =
  | 'proposed'
  | 'pending_confirm'
  | 'executed'
  | 'rejected'
  | 'skipped_by_mode'
  | 'failed'

export type AiDawAuditEntry = {
  id: string
  ts: number
  conversationId: string
  messageId: string
  agentMode: string
  source: AiDawAuditSource
  tool: string
  params: Record<string, unknown>
  commands?: Array<{ name: string; params: Record<string, unknown> }>
  status: AiDawAuditStatus
  result?: { success: boolean; message?: string; error?: string }
  rawSnippet?: string
}

const STORAGE_KEY = 'jaswave-ai-daw-audit-v1'
const MAX_ENTRIES = 800
const listeners = new Set<() => void>()

function newId(): string {
  return `aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function load(): AiDawAuditEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AiDawAuditEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function save(entries: AiDawAuditEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    /* quota */
  }
  for (const l of listeners) l()
}

export function subscribeAiDawAudit(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function listAiDawAudit(limit = 200): AiDawAuditEntry[] {
  return load().slice(-limit).reverse()
}

export function listAiDawAuditForMessage(messageId: string): AiDawAuditEntry[] {
  return load().filter((e) => e.messageId === messageId)
}

export function appendAiDawAudit(
  partial: Omit<AiDawAuditEntry, 'id' | 'ts'> & { id?: string; ts?: number },
): AiDawAuditEntry {
  const entry: AiDawAuditEntry = {
    id: partial.id ?? newId(),
    ts: partial.ts ?? Date.now(),
    conversationId: partial.conversationId,
    messageId: partial.messageId,
    agentMode: partial.agentMode,
    source: partial.source,
    tool: partial.tool,
    params: partial.params ?? {},
    commands: partial.commands,
    status: partial.status,
    result: partial.result,
    rawSnippet: partial.rawSnippet,
  }
  const all = load()
  all.push(entry)
  save(all)
  return entry
}

export function clearAiDawAudit(): void {
  save([])
}

export function exportAiDawAuditJson(): string {
  return JSON.stringify(load(), null, 2)
}
