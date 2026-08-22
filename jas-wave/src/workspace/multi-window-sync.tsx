import { useEffect } from 'react'
import { useDAW } from '@/src/context/daw-context'
import type { DAWState } from '../../../shared/src'

const CHANNEL = 'jaswave-daw-sync-v1'

/**
 * Sync DAW entre primary y satélites (undock).
 * NO publica en cada cambio de estado (congelaba la UI con JSON del proyecto entero).
 * Solo responde a request-state / force.
 */
export function MultiWindowSync({ role }: { role: 'primary' | 'satellite' }) {
  const tienda = useDAW()

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL)

    if (role === 'primary') {
      const publish = () => {
        try {
          const raw = JSON.parse(JSON.stringify(tienda.obtenerEstado())) as DAWState
          ch.postMessage({ type: 'state', state: raw })
        } catch {
          /* ignore */
        }
      }

      const onForce = () => publish()
      window.addEventListener('jaswave-force-daw-sync', onForce)
      ch.onmessage = (ev) => {
        const data = ev.data as { type: string; command?: string; payload?: unknown }
        if (data.type === 'request-state') publish()
        if (data.type === 'command' && data.command) {
          void tienda.executor.execute(data.command, data.payload ?? {})
        }
      }
      return () => {
        window.removeEventListener('jaswave-force-daw-sync', onForce)
        ch.close()
      }
    }

    let gotState = false
    const ask = () => {
      if (!gotState) ch.postMessage({ type: 'request-state' })
    }
    ask()
    const retry = window.setInterval(ask, 400)
    const stopRetry = window.setTimeout(() => clearInterval(retry), 15_000)

    ch.onmessage = (ev) => {
      const data = ev.data as { type: string; state?: DAWState }
      if (data.type === 'state' && data.state) {
        gotState = true
        tienda.reemplazarEstado(data.state)
        clearInterval(retry)
        clearTimeout(stopRetry)
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
      clearTimeout(stopRetry)
      tienda.executor.execute = original
      ch.close()
    }
  }, [role, tienda])

  return null
}
