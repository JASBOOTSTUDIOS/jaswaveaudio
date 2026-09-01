import { useEffect } from 'react'
import { useDAW } from '@/src/context/daw-context'
import type { DAWState } from '../../../shared/src'

const CHANNEL = 'jaswave-daw-sync-v1'

/**
 * Sync DAW entre primary y satélites (undock).
 * Publica un recorte sin waveforms (el JSON del proyecto entero congelaba la UI).
 * Tras el primer request del satélite, reenvía con debounce mientras haya ping.
 */
function slimDawState(state: DAWState): DAWState {
  return {
    ...state,
    project: {
      ...state.project,
      tracks: (state.project?.tracks ?? []).map((t) => ({
        ...t,
        clips: (t.clips ?? []).map((c) => {
          if (c && typeof c === 'object' && 'waveform' in c) {
            const next = { ...c } as { waveform?: number[] }
            delete next.waveform
            return next
          }
          return c
        }),
      })),
    },
  } as DAWState
}

export function MultiWindowSync({ role }: { role: 'primary' | 'satellite' }) {
  const tienda = useDAW()

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL)

    if (role === 'primary') {
      let lastPing = 0
      const publish = () => {
        try {
          ch.postMessage({ type: 'state', state: slimDawState(tienda.obtenerEstado()) })
        } catch {
          /* ignore */
        }
      }

      let debounce: ReturnType<typeof setTimeout> | null = null
      const unsub = tienda.suscribir(() => {
        if (Date.now() - lastPing > 45_000) return
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => {
          debounce = null
          publish()
        }, 180)
      })

      const onForce = () => {
        lastPing = Date.now()
        publish()
      }
      window.addEventListener('jaswave-force-daw-sync', onForce)
      ch.onmessage = (ev) => {
        const data = ev.data as { type: string; command?: string; payload?: unknown }
        if (data.type === 'request-state' || data.type === 'ping') {
          lastPing = Date.now()
          if (data.type === 'request-state') publish()
        }
        if (data.type === 'command' && data.command) {
          void tienda.executor.execute(data.command, data.payload ?? {})
        }
      }
      return () => {
        window.removeEventListener('jaswave-force-daw-sync', onForce)
        if (debounce) clearTimeout(debounce)
        unsub()
        ch.close()
      }
    }

    let gotState = false
    const retry = window.setInterval(() => {
      ch.postMessage({ type: gotState ? 'ping' : 'request-state' })
    }, 400)
    ch.postMessage({ type: 'request-state' })

    ch.onmessage = (ev) => {
      const data = ev.data as { type: string; state?: DAWState }
      if (data.type === 'state' && data.state) {
        gotState = true
        tienda.reemplazarEstado(data.state)
      }
    }

    const original = tienda.executor.execute.bind(tienda.executor)
    tienda.executor.execute = async (type: string, payload: unknown, source?: any, userId?: string) => {
      try {
        ch.postMessage({ type: 'command', command: type, payload })
      } catch {
        /* ignore */
      }
      return original(type, payload, source, userId)
    }

    return () => {
      clearInterval(retry)
      tienda.executor.execute = original
      ch.close()
    }
  }, [role, tienda])

  return null
}
