import { useEffect, useRef } from 'react'
import { useDAW } from '@/src/context/daw-context'
import type { DAWState } from '../../../shared/src'

const CHANNEL = 'jaswave-daw-sync-v1'

/**
 * Sincroniza estado DAW entre ventana principal y ventanas flotantes.
 * Throttle fuerte: durante play no spamea el estado completo cada tick.
 */
export function MultiWindowSync({ role }: { role: 'primary' | 'satellite' }) {
  const tienda = useDAW()

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL)

    if (role === 'primary') {
      let timer: ReturnType<typeof setTimeout> | null = null
      let pending = false

      const publish = () => {
        pending = false
        timer = null
        try {
          ch.postMessage({ type: 'state', state: tienda.obtenerEstado() })
        } catch {
          /* ignore */
        }
      }

      const schedule = () => {
        pending = true
        if (timer) return
        timer = setTimeout(publish, 120)
      }

      const unsub = tienda.suscribir(schedule)
      ch.onmessage = (ev) => {
        const data = ev.data as { type: string; command?: string; payload?: unknown }
        if (data.type === 'request-state') {
          publish()
        }
        if (data.type === 'command' && data.command) {
          void tienda.executor.execute(data.command, data.payload ?? {})
        }
      }
      publish()
      return () => {
        unsub()
        if (timer) clearTimeout(timer)
        if (pending) publish()
        ch.close()
      }
    }

    // satellite
    ch.postMessage({ type: 'request-state' })
    const retry = window.setInterval(() => {
      ch.postMessage({ type: 'request-state' })
    }, 250)
    const stopRetry = window.setTimeout(() => clearInterval(retry), 2000)

    ch.onmessage = (ev) => {
      const data = ev.data as { type: string; state?: DAWState }
      if (data.type === 'state' && data.state) {
        tienda.reemplazarEstado(data.state)
        clearInterval(retry)
        clearTimeout(stopRetry)
      }
    }

    const original = tienda.executor.execute.bind(tienda.executor)
    tienda.executor.execute = async (type: string, payload: unknown, source?: any, userId?: string) => {
      ch.postMessage({ type: 'command', command: type, payload })
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
