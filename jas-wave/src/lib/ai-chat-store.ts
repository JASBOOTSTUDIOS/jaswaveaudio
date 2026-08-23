/**
 * Historial persistente de conversaciones del Asistente Jas.
 */

export type ChatRole = 'user' | 'assistant' | 'system'

export type StoredChatMessage = {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  /** Acciones DAW ejecutadas en este turno (si aplica). */
  actionsSummary?: string
  /** Vista previa MIDI pendiente de aplicar al proyecto. */
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
}

export type ChatConversation = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: StoredChatMessage[]
}

const STORAGE_KEY = 'jaswave-ai-chat-history-v1'
const MAX_CONVERSATIONS = 40
const MAX_MESSAGES = 200

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function loadAll(): ChatConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ChatConversation[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

function saveAll(list: ChatConversation[]): void {
  const trimmed = list
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS)
    .map((c) => ({
      ...c,
      messages: c.messages.slice(-MAX_MESSAGES),
    }))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
}

export function listConversations(): ChatConversation[] {
  return loadAll()
}

export function getConversation(id: string): ChatConversation | null {
  return loadAll().find((c) => c.id === id) ?? null
}

export function createConversation(title = 'Nueva conversación'): ChatConversation {
  const now = Date.now()
  const conv: ChatConversation = {
    id: newId('chat'),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
  const all = loadAll()
  all.unshift(conv)
  saveAll(all)
  return conv
}

export function deleteConversation(id: string): void {
  saveAll(loadAll().filter((c) => c.id !== id))
}

export function renameConversation(id: string, title: string): void {
  const all = loadAll()
  const idx = all.findIndex((c) => c.id === id)
  if (idx < 0) return
  all[idx] = { ...all[idx], title: title.trim() || all[idx].title, updatedAt: Date.now() }
  saveAll(all)
}

export function appendMessage(
  conversationId: string,
  message: Omit<StoredChatMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
): ChatConversation | null {
  const all = loadAll()
  const idx = all.findIndex((c) => c.id === conversationId)
  if (idx < 0) return null

  const msg: StoredChatMessage = {
    id: message.id ?? newId('msg'),
    role: message.role,
    content: message.content,
    createdAt: message.createdAt ?? Date.now(),
    actionsSummary: message.actionsSummary,
    midiPreview: message.midiPreview,
  }

  const messages = [...all[idx].messages, msg].slice(-MAX_MESSAGES)
  let title = all[idx].title
  if (
    (title === 'Nueva conversación' || title === 'Chat') &&
    message.role === 'user' &&
    message.content.trim()
  ) {
    title = message.content.trim().slice(0, 48) + (message.content.trim().length > 48 ? '…' : '')
  }

  all[idx] = {
    ...all[idx],
    title,
    messages,
    updatedAt: Date.now(),
  }
  saveAll(all)
  return all[idx]
}

export function updateMessageContent(
  conversationId: string,
  messageId: string,
  content: string,
  actionsSummary?: string,
  midiPreview?: StoredChatMessage['midiPreview'],
  projectPlan?: StoredChatMessage['projectPlan'],
  musicBuild?: StoredChatMessage['musicBuild'],
): ChatConversation | null {
  const all = loadAll()
  const idx = all.findIndex((c) => c.id === conversationId)
  if (idx < 0) return null
  all[idx] = {
    ...all[idx],
    updatedAt: Date.now(),
    messages: all[idx].messages.map((m) =>
      m.id === messageId
        ? {
            ...m,
            content,
            ...(actionsSummary !== undefined ? { actionsSummary } : {}),
            ...(midiPreview !== undefined ? { midiPreview } : {}),
            ...(projectPlan !== undefined ? { projectPlan } : {}),
            ...(musicBuild !== undefined ? { musicBuild } : {}),
          }
        : m,
    ),
  }
  saveAll(all)
  return all[idx]
}

export function getActiveConversationId(): string | null {
  try {
    return localStorage.getItem('jaswave-ai-active-chat-id')
  } catch {
    return null
  }
}

export function setActiveConversationId(id: string | null): void {
  if (!id) localStorage.removeItem('jaswave-ai-active-chat-id')
  else localStorage.setItem('jaswave-ai-active-chat-id', id)
}

/** Obtiene o crea la conversación activa. */
export function ensureActiveConversation(): ChatConversation {
  const id = getActiveConversationId()
  if (id) {
    const existing = getConversation(id)
    if (existing) return existing
  }
  const created = createConversation()
  setActiveConversationId(created.id)
  return created
}
