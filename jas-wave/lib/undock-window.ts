/** Ventana flotante (`?undock=` / `#undock/`). Cada BrowserWindow tiene su propio JS. */

export function isUndockWindow(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('undock')) return true
    const hash = window.location.hash.replace(/^#/, '')
    return hash.startsWith('undock/')
  } catch {
    return false
  }
}

export function getUndockUrlFocus(): {
  toolId: string | null
  trackId: string | null
  clipId: string | null
} {
  if (typeof window === 'undefined') {
    return { toolId: null, trackId: null, clipId: null }
  }
  try {
    const params = new URLSearchParams(window.location.search)
    const hash = window.location.hash.replace(/^#/, '')
    const fromHash = hash.startsWith('undock/') ? hash.slice('undock/'.length) : null
    const toolId = params.get('undock') || fromHash
    return {
      toolId,
      trackId: params.get('trackId'),
      clipId: params.get('clipId'),
    }
  } catch {
    return { toolId: null, trackId: null, clipId: null }
  }
}
