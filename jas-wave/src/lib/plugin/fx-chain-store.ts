/**
 * Foco de la FX Chain panel (una pista a la vez — ADR-0012).
 * Persistido + BroadcastChannel para ventanas flotantes.
 */

export type FxChainFocus = {
  trackId: string
  openedAt: number
}

type Listener = () => void

const STORAGE_KEY = 'jaswave.fxChainFocus.v1'
const CHANNEL = 'jaswave-fx-chain-focus-v1'

function readStored(): FxChainFocus | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FxChainFocus
    if (!parsed?.trackId) return null
    return parsed
  } catch {
    return null
  }
}

let focus: FxChainFocus | null = readStored()
const listeners = new Set<Listener>()

function persist(next: FxChainFocus | null) {
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.postMessage({ type: 'focus', focus: next })
    ch.close()
  } catch {
    /* ignore */
  }
}

function emit() {
  for (const l of listeners) l()
}

export function getFxChainFocus(): FxChainFocus | null {
  return focus
}

export function setFxChainFocus(next: FxChainFocus | null): void {
  focus = next
  persist(next)
  emit()
}

export function subscribeFxChainFocus(listener: Listener): () => void {
  listeners.add(listener)
  let ch: BroadcastChannel | null = null
  try {
    ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = (ev) => {
      const data = ev.data as { type?: string; focus?: FxChainFocus | null }
      if (data?.type !== 'focus') return
      focus = data.focus ?? null
      listener()
    }
  } catch {
    /* ignore */
  }
  return () => {
    listeners.delete(listener)
    ch?.close()
  }
}

export function openFxChain(trackId: string, zone: 'left' | 'right' | 'bottom' | 'center' = 'right'): void {
  setFxChainFocus({ trackId, openedAt: Date.now() })
  window.dispatchEvent(
    new CustomEvent('jaswave-open-tool', {
      detail: { toolId: 'fx-chain', zone },
    }),
  )
}
