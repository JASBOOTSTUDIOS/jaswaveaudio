/**
 * Zoom general de la interfaz (Ctrl± fuera de paneles con zoom propio). Persistido por equipo.
 */

function clampZoom(z: number): number {
  return Math.max(0.75, Math.min(2, Math.round(z * 100) / 100))
}

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
