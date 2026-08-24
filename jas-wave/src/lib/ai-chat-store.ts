/**
 * Historial persistente de conversaciones del Asistente Jas — aislado por proyecto.
 */

export type ChatRole = 'user' | 'assistant' | 'system'

export type StoredChatMessage = {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  actionsSummary?: string
  pendingActions?: {
    status: 'pending' | 'applied' | 'discarded'
    actions: Array<{ type: string; payload?: Record<string, unknown> }>
    agentMode: string
  }
  confirmActions?: {
    status: 'pending' | 'confirmed' | 'rejected'
    actions: Array<{ type: string; payload?: Record<string, unknown> }>
    reason: string
  }
  midiPreview?: {
    kind: 'midiPreview'
    nombre: string
    keyLabel: string
    bpm: number
    durationBeats: number
    notes: Array<{ pitch: number; inicio: number; duracion: number; velocidad: number }>
    structureLabel: string
    status?: 'pending' | 'applied' | 'discarded'
    mood?: string
    style?: string
    pistaId?: string
    applied?: boolean
  }
  projectPlan?: import('./project-plan').ProjectPlanData
  musicBuild?: import('./music-build/types').MusicBuildResult
  citedMessageIds?: string[]
}

export type ChatConversation = {
  id: string
  projectId: string
  title: string
  createdAt: number
  updatedAt: number
  messages: StoredChatMessage[]
}

const STORAGE_KEY = 'jaswave-ai-chat-history-v2'
const LEGACY_KEY = 'jaswave-ai-chat-history-v1'
const MAX_CONVERSATIONS = 40
const MAX_MESSAGES = 200

let scopedProjectId = 'default'

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function activeKey(projectId: string): string {
  return `jaswave-ai-active-chat-id:${projectId || 'default'}`
}

/** Fija el proyecto activo para el historial de chat (llamar al abrir/cambiar proyecto). */
export function setChatProjectScope(projectId: string | null | undefined): void {
  scopedProjectId = projectId?.trim() || 'default'
}

export function getChatProjectScope(): string {
  return scopedProjectId
}

function migrateLegacyIfNeeded(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY)) return
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (!legacy) return
    const parsed = JSON.parse(legacy) as ChatConversation[]
    if (!Array.isArray(parsed)) return
    const migrated = parsed.map((c) => ({
      ...c,
      projectId: c.projectId || 'default',
    }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
  } catch {
    /* ignore */
  }
}

function loadAllRaw(): ChatConversation[] {
  migrateLegacyIfNeeded()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ChatConversation[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages))
      .map((c) => ({ ...c, projectId: c.projectId || 'default' }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

function saveAllRaw(list: ChatConversation[]): void {
  const trimmed = list
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS * 8)
    .map((c) => ({
      ...c,
      projectId: c.projectId || 'default',
      messages: c.messages.slice(-MAX_MESSAGES),
    }))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
}

function loadForProject(projectId = scopedProjectId): ChatConversation[] {
  const pid = projectId || 'default'
  return loadAllRaw()
    .filter((c) => c.projectId === pid)
    .slice(0, MAX_CONVERSATIONS)
}

function upsertConversation(conv: ChatConversation): void {
  const all = loadAllRaw()
  const idx = all.findIndex((c) => c.id === conv.id)
  if (idx >= 0) all[idx] = conv
  else all.unshift(conv)
  saveAllRaw(all)
}

export function listConversations(projectId = scopedProjectId): ChatConversation[] {
  return loadForProject(projectId)
}

export function getConversation(id: string): ChatConversation | null {
  return loadAllRaw().find((c) => c.id === id) ?? null
}

export function createConversation(
  title = 'Nueva conversación',
  projectId = scopedProjectId,
): ChatConversation {
  const now = Date.now()
  const conv: ChatConversation = {
    id: newId('chat'),
    projectId: projectId || 'default',
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
  upsertConversation(conv)
  return conv
}

export function deleteConversation(id: string): void {
  saveAllRaw(loadAllRaw().filter((c) => c.id !== id))
}

export function renameConversation(id: string, title: string): void {
  const c = getConversation(id)
  if (!c) return
  upsertConversation({ ...c, title: title.trim() || c.title, updatedAt: Date.now() })
}

export function appendMessage(
  conversationId: string,
  message: Omit<StoredChatMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
  projectId?: string,
): ChatConversation | null {
  const prev = getConversation(conversationId)
  if (!prev) return null
  const pid = projectId || scopedProjectId
  if (prev.projectId !== pid) return null

  const msg: StoredChatMessage = {
    id: message.id ?? newId('msg'),
    role: message.role,
    content: message.content,
    createdAt: message.createdAt ?? Date.now(),
    actionsSummary: message.actionsSummary,
    midiPreview: message.midiPreview,
    citedMessageIds: message.citedMessageIds,
    pendingActions: message.pendingActions,
    confirmActions: message.confirmActions,
    projectPlan: message.projectPlan,
    musicBuild: message.musicBuild,
  }

  const messages = [...prev.messages, msg].slice(-MAX_MESSAGES)
  let title = prev.title
  if (
    (title === 'Nueva conversación' || title === 'Chat') &&
    message.role === 'user' &&
    message.content.trim()
  ) {
    title = message.content.trim().slice(0, 48) + (message.content.trim().length > 48 ? '…' : '')
  }

  const next = { ...prev, title, messages, updatedAt: Date.now() }
  upsertConversation(next)
  return next
}

export function updateMessageContent(
  conversationId: string,
  messageId: string,
  content: string,
  actionsSummary?: string,
  midiPreview?: StoredChatMessage['midiPreview'],
  projectPlan?: StoredChatMessage['projectPlan'],
  musicBuild?: StoredChatMessage['musicBuild'],
  pendingActions?: StoredChatMessage['pendingActions'],
  confirmActions?: StoredChatMessage['confirmActions'],
): ChatConversation | null {
  return patchMessage(conversationId, messageId, {
    content,
    ...(actionsSummary !== undefined ? { actionsSummary } : {}),
    ...(midiPreview !== undefined ? { midiPreview } : {}),
    ...(projectPlan !== undefined ? { projectPlan } : {}),
    ...(musicBuild !== undefined ? { musicBuild } : {}),
    ...(pendingActions !== undefined ? { pendingActions } : {}),
    ...(confirmActions !== undefined ? { confirmActions } : {}),
  })
}

export function patchMessage(
  conversationId: string,
  messageId: string,
  patch: Partial<StoredChatMessage>,
  projectId?: string,
): ChatConversation | null {
  const prev = getConversation(conversationId)
  if (!prev) return null
  const pid = projectId || scopedProjectId
  if (prev.projectId !== pid) return null
  const next = {
    ...prev,
    updatedAt: Date.now(),
    messages: prev.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
  }
  upsertConversation(next)
  return next
}

export function getActiveConversationId(projectId = scopedProjectId): string | null {
  try {
    return localStorage.getItem(activeKey(projectId))
  } catch {
    return null
  }
}

export function setActiveConversationId(id: string | null, projectId = scopedProjectId): void {
  const key = activeKey(projectId)
  if (!id) localStorage.removeItem(key)
  else localStorage.setItem(key, id)
}

/** Obtiene o crea la conversación activa del proyecto en scope. */
export function ensureActiveConversation(projectId = scopedProjectId): ChatConversation {
  const pid = projectId || 'default'
  setChatProjectScope(pid)
  const id = getActiveConversationId(pid)
  if (id) {
    const existing = getConversation(id)
    if (existing && existing.projectId === pid) return existing
  }
  const created = createConversation('Nueva conversación', pid)
  setActiveConversationId(created.id, pid)
  return created
}
