/**
 * Playhead fluido entre ventana principal y satélites (undock).
 * Primary publica ~30 Hz en play; satélites siguen sin tocar el AudioEngine.
 */

const CHANNEL = 'jaswave-playhead-sync-v1'

export type PlayheadTick = {
  type: 'tick'
  ms: number
  playing: boolean
  wall: number
}

type Listener = (tick: PlayheadTick) => void

let lastTick: PlayheadTick | null = null
const listeners = new Set<Listener>()

export function getLastPlayheadTick(): PlayheadTick | null {
  return lastTick
}

export function subscribePlayheadSync(listener: Listener): () => void {
  listeners.add(listener)
  if (lastTick) listener(lastTick)
  return () => listeners.delete(listener)
}

export function publishPlayheadTick(ms: number, playing: boolean): void {
  const tick: PlayheadTick = {
    type: 'tick',
    ms,
    playing,
    wall: performance.now(),
  }
  lastTick = tick
  for (const l of listeners) l(tick)
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.postMessage(tick)
    ch.close()
  } catch {
    /* ignore */
  }
}

/** Escucha ticks de otras ventanas (no los propios vía listeners locales). */
export function startPlayheadSyncReceiver(onTick: Listener): () => void {
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = (ev: MessageEvent) => {
      const data = ev.data as PlayheadTick
      if (!data || data.type !== 'tick' || typeof data.ms !== 'number') return
      lastTick = data
      onTick(data)
    }
    return () => ch.close()
  } catch {
    return () => undefined
  }
}
