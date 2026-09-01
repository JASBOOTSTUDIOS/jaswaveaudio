import { useEffect, useRef, useState } from 'react'
import {
  readMixBufferLive,
  type MixBufferLiveSnapshot,
} from '@/src/lib/audio-buffer-health'

export type LiveBufferMeterState = MixBufferLiveSnapshot & {
  underrunDelta: number
  overflowDelta: number
  dropDelta: number
}

/**
 * Poll del ring mix→ASIO en tiempo real (transporte + medidores).
 * Intervalo más rápido durante reproducción.
 */
export function useLiveBufferMeter(playing: boolean): LiveBufferMeterState | null {
  const [snap, setSnap] = useState<LiveBufferMeterState | null>(null)
  const prevRef = useRef<{ u: number; o: number; d: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let inFlight = false

    const tick = async () => {
      if (cancelled || inFlight) {
        if (!cancelled) timer = setTimeout(() => void tick(), playing ? 120 : 400)
        return
      }
      inFlight = true
      try {
        const live = await readMixBufferLive()
        if (cancelled || !live) return
        const prev = prevRef.current
        const underrunDelta = prev ? Math.max(0, live.underrunBlocks - prev.u) : 0
        const overflowDelta = prev ? Math.max(0, live.overflowPushes - prev.o) : 0
        const dropDelta = prev ? Math.max(0, live.highFillDropFrames - prev.d) : 0
        prevRef.current = {
          u: live.underrunBlocks,
          o: live.overflowPushes,
          d: live.highFillDropFrames,
        }
        setSnap({ ...live, underrunDelta, overflowDelta, dropDelta })
      } catch {
        /* host caído */
      } finally {
        inFlight = false
        if (!cancelled) timer = setTimeout(() => void tick(), playing ? 120 : 400)
      }
    }

    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [playing])

  return snap
}
