/**
 * Zoom tipográfico del chat del Asistente Jas (solo el panel, no toda la app).
 */

const STORAGE_KEY = 'jaswave-chat-text-zoom'
const listeners = new Set<() => void>()

function clampZoom(z: number): number {
  return Math.min(2, Math.max(0.75, Math.round(z * 100) / 100))
}

let textZoom = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const n = raw ? Number(raw) : 1
    return Number.isFinite(n) ? clampZoom(n) : 1
  } catch {
    return 1
  }
})()

let chatPanelMounted = false

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(textZoom))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

export function getChatTextZoom(): number {
  return textZoom
}

export function setChatTextZoom(zoom: number): void {
  textZoom = clampZoom(zoom)
  persist()
}

export function bumpChatTextZoom(delta: number): void {
  setChatTextZoom(textZoom + delta)
}

export function subscribeChatTextZoom(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setChatPanelMounted(mounted: boolean): void {
  chatPanelMounted = mounted
}

export function isChatPanelMounted(): boolean {
  return chatPanelMounted
}

/** Ctrl± del chat solo con foco en el panel (o undock chat). */
export function isChatZoomTarget(): boolean {
  if (!chatPanelMounted) return false
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.get('undock') === 'coproducer' || q.get('undock') === 'chat') return true
    const hash = window.location.hash.replace(/^#/, '')
    if (hash.startsWith('undock/coproducer') || hash.startsWith('undock/chat')) return true
  } catch {
    /* ignore */
  }
  const ae = document.activeElement
  if (ae && typeof (ae as HTMLElement).closest === 'function') {
    if ((ae as HTMLElement).closest('[data-chat-panel]')) return true
  }
  return false
}
