/**
 * Pista enfocada en el piano roll / editor: debe oírse en preview
 * aunque otra pista tenga solo en el arrangement.
 */

const CHANNEL = 'jaswave-preview-focus-v1'

let focusTrackId: string | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function getEditorPreviewTrackId(): string | null {
  return focusTrackId
}

export function setEditorPreviewTrackId(trackId: string | null): void {
  if (focusTrackId === trackId) return
  focusTrackId = trackId
  emit()
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.postMessage({ type: 'focus', trackId })
    ch.close()
  } catch {
    /* ignore */
  }
}

export function subscribeEditorPreviewTrack(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Primary: aplica focus que llega desde ventanas undock. */
export function startEditorPreviewFocusBridge(): () => void {
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; trackId?: string | null }
      if (data?.type !== 'focus') return
      const next = data.trackId ?? null
      if (focusTrackId === next) return
      focusTrackId = next
      emit()
    }
    return () => ch.close()
  } catch {
    return () => undefined
  }
}
