/**
 * Playhead fluido entre ventana principal y satélites (undock).
 *
 * Estrategia satélite (anti-tambaleo):
 * - Al empezar play (o seek), fija UNA ancla { ms, wall=Date.now local }.
 * - Mientras suena, IGNORA ticks remotos y solo extrapola con Date.now.
 * - Solo re-ancla en: pause, seek grande, o reanudación de play.
 *
 * Así la línea no “correge” 20×/s (causa del tambaleo / freeze visual).
 */

const CHANNEL = 'jaswave-playhead-sync-v1'

/** |Δ| ≥ esto vs extrapolación → seek (usuario). */
const SEEK_SNAP_MS = 500

export type PlayheadTick = {
  type: 'tick'
  ms: number
  playing: boolean
  /** Epoch wall del emisor (Date.now). */
  wall: number
}

export type PlayheadAnchor = {
  ms: number
  wall: number
  playing: boolean
}

type Listener = (tick: PlayheadTick) => void

let lastTick: PlayheadTick | null = null
const listeners = new Set<Listener>()
let publishChannel: BroadcastChannel | null = null

function getPublishChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (publishChannel) return publishChannel
  try {
    publishChannel = new BroadcastChannel(CHANNEL)
    return publishChannel
  } catch {
    return null
  }
}

export function getLastPlayheadTick(): PlayheadTick | null {
  return lastTick
}

/** Posición viva: ancla + (now - wall) en play. */
export function extrapolatePlayheadMs(anchor: PlayheadAnchor | null | undefined, now = Date.now()): number {
  if (!anchor) return 0
  if (!anchor.playing) return Math.max(0, anchor.ms)
  return Math.max(0, anchor.ms + Math.max(0, now - anchor.wall))
}

/**
 * Free-run: no re-anclar en cada tick (evita tambaleo).
 * wall local = Date.now() al fijar, para que la extrapolación sea estable en ESTE proceso.
 */
export function mergeSatellitePlayheadTick(
  prev: PlayheadAnchor | null | undefined,
  tick: PlayheadTick,
  now = Date.now(),
): PlayheadAnchor {
  // Pause / stop / seek en pause: siempre la posición oficial del tick (p.ej. W → 0)
  if (!tick.playing) {
    return { ms: Math.max(0, tick.ms), wall: now, playing: false }
  }

  // Inicio de play o primera ancla
  if (!prev || !prev.playing) {
    return { ms: Math.max(0, tick.ms), wall: now, playing: true }
  }

  const current = extrapolatePlayheadMs(prev, now)
  const delta = tick.ms - current

  // Seek duro (usuario movió playhead / jump)
  if (Math.abs(delta) >= SEEK_SNAP_MS) {
    return { ms: Math.max(0, tick.ms), wall: now, playing: true }
  }

  // En marcha normal: mantener ancla (free-run). Cero tambaleo.
  return prev
}

export function subscribePlayheadSync(listener: Listener): () => void {
  listeners.add(listener)
  if (lastTick) listener(lastTick)
  return () => listeners.delete(listener)
}

export function publishPlayheadTick(ms: number, playing: boolean): void {
  const tick: PlayheadTick = {
    type: 'tick',
    ms: Math.max(0, ms),
    playing,
    wall: Date.now(),
  }
  lastTick = tick
  for (const l of listeners) l(tick)
  try {
    getPublishChannel()?.postMessage(tick)
  } catch {
    /* ignore */
  }
}

export function startPlayheadSyncReceiver(onTick: Listener): () => void {
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = (ev: MessageEvent) => {
      const data = ev.data as PlayheadTick
      if (!data || data.type !== 'tick' || typeof data.ms !== 'number') return
      const wall = typeof data.wall === 'number' && data.wall > 1e12 ? data.wall : Date.now()
      const tick: PlayheadTick = { ...data, wall, ms: Math.max(0, data.ms) }
      lastTick = tick
      onTick(tick)
    }
    return () => ch.close()
  } catch {
    return () => undefined
  }
}

export function requestPlayheadSync(): void {
  try {
    getPublishChannel()?.postMessage({ type: 'request' })
  } catch {
    /* ignore */
  }
}

export function startPlayheadSyncResponder(getMs: () => number, isPlaying: () => boolean): () => void {
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string }
      if (!data || data.type !== 'request') return
      publishPlayheadTick(getMs(), isPlaying())
    }
    return () => ch.close()
  } catch {
    return () => undefined
  }
}
