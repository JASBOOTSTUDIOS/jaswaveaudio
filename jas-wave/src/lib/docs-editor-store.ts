/**
 * Tabs del editor de docs (edit / preview por archivo) + zoom tipográfico.
 * Sincronizado entre ventanas vía BroadcastChannel.
 */

export type DocsTabMode = 'edit' | 'preview'

export type DocsEditorTab = {
  id: string
  slug: string
  mode: DocsTabMode
}

type DocsEditorState = {
  tabs: DocsEditorTab[]
  activeTabId: string | null
  /** Zoom tipográfico del editor/preview (0.75–2). */
  textZoom: number
}

const STORAGE_KEY = 'jaswave-docs-editor-v1'
const CHANNEL = 'jaswave-docs-editor-v1'
const listeners = new Set<() => void>()

let state: DocsEditorState = load()

function load(): DocsEditorState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { tabs: [], activeTabId: null, textZoom: 1 }
    const parsed = JSON.parse(raw) as DocsEditorState
    return {
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs : [],
      activeTabId: parsed.activeTabId ?? null,
      textZoom: clampZoom(typeof parsed.textZoom === 'number' ? parsed.textZoom : 1),
    }
  } catch {
    return { tabs: [], activeTabId: null, textZoom: 1 }
  }
}

function clampZoom(z: number): number {
  return Math.max(0.75, Math.min(2, Math.round(z * 100) / 100))
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
  for (const l of listeners) l()
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.postMessage({ type: 'sync', state })
    ch.close()
  } catch {
    /* ignore */
  }
}

export function subscribeDocsEditor(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getDocsEditorState(): DocsEditorState {
  return state
}

function tabId(slug: string, mode: DocsTabMode): string {
  return `${slug}::${mode}`
}

export function openDocsTab(slug: string, mode: DocsTabMode = 'edit'): DocsEditorTab {
  const id = tabId(slug, mode)
  const existing = state.tabs.find((t) => t.id === id)
  if (existing) {
    state = { ...state, activeTabId: id }
    persist()
    return existing
  }
  const tab: DocsEditorTab = { id, slug, mode }
  state = { ...state, tabs: [...state.tabs, tab], activeTabId: id }
  persist()
  return tab
}

export function closeDocsTab(id: string): void {
  const tabs = state.tabs.filter((t) => t.id !== id)
  let activeTabId = state.activeTabId
  if (activeTabId === id) {
    activeTabId = tabs[tabs.length - 1]?.id ?? null
  }
  state = { ...state, tabs, activeTabId }
  persist()
}

export function setActiveDocsTab(id: string): void {
  if (!state.tabs.some((t) => t.id === id)) return
  state = { ...state, activeTabId: id }
  persist()
}

export function setDocsTextZoom(zoom: number): void {
  state = { ...state, textZoom: clampZoom(zoom) }
  persist()
}

export function bumpDocsTextZoom(delta: number): void {
  setDocsTextZoom(state.textZoom + delta)
}

/** Escucha sync desde otras ventanas. */
export function startDocsEditorChannel(): () => void {
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; state?: DocsEditorState }
      if (data?.type === 'sync' && data.state) {
        state = {
          tabs: Array.isArray(data.state.tabs) ? data.state.tabs : state.tabs,
          activeTabId: data.state.activeTabId ?? state.activeTabId,
          textZoom: clampZoom(data.state.textZoom ?? state.textZoom),
        }
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
        } catch {
          /* ignore */
        }
        for (const l of listeners) l()
      }
    }
    return () => ch.close()
  } catch {
    return () => undefined
  }
}

/** Zoom UI global del DAW (chrome), independiente del timeline. */
const UI_ZOOM_KEY = 'jaswave-ui-zoom-v1'
const uiListeners = new Set<() => void>()
let uiZoom = (() => {
  try {
    const n = Number(localStorage.getItem(UI_ZOOM_KEY))
    return Number.isFinite(n) ? clampZoom(n) : 1
  } catch {
    return 1
  }
})()

export function getUiZoom(): number {
  return uiZoom
}

export function subscribeUiZoom(l: () => void): () => void {
  uiListeners.add(l)
  return () => uiListeners.delete(l)
}

export function applyUiZoom(zoom: number): void {
  uiZoom = clampZoom(zoom)
  try {
    localStorage.setItem(UI_ZOOM_KEY, String(uiZoom))
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--jaswave-ui-zoom', String(uiZoom))
    document.documentElement.style.fontSize = `${uiZoom * 100}%`
  }
  for (const l of uiListeners) l()
}

export function bumpUiZoom(delta: number): void {
  applyUiZoom(uiZoom + delta)
}

export function initUiZoom(): void {
  applyUiZoom(uiZoom)
}
