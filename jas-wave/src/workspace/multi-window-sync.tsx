import { useEffect } from 'react'
import { useDAW } from '@/src/context/daw-context'
import type { DAWState } from '../../../shared/src'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { CommandResult } from '../../../shared/src/types/command'
import {
  cerrarCanal,
  enviarMensaje,
  esMensajeSincronizacion,
  obtenerCanal,
  type AccionSatelite,
} from './satellite-channel'

/**
 * Sync DAW entre primary y satélites (undock).
 * Publica un recorte sin waveforms (el JSON del proyecto entero congelaba la UI).
 * Tras el primer request del satélite, reenvía con debounce mientras haya ping.
 *
 * U7: el satélite no tiene autoridad. No ejecuta comandos localmente (solo los
 * reenvía) y aplica únicamente el estado que difunde la ventana principal.
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

/** Acciones de alto nivel que el satélite pide al primario. */
async function ejecutarAccionEnPrimario(
  tienda: TiendaDAW,
  accion: AccionSatelite,
  payload?: unknown,
): Promise<void> {
  if (accion === 'deshacer') {
    await tienda.executor.undo()
    return
  }
  if (accion === 'rehacer') {
    await tienda.executor.redo()
    return
  }
  const { abrirProyectoIO, guardarProyectoComoIO, guardarProyectoIO } = await import('@/src/lib/project-io')
  if (accion === 'guardar') {
    await guardarProyectoIO(tienda)
    return
  }
  if (accion === 'guardar-como') {
    await guardarProyectoComoIO(tienda)
    return
  }
  if (accion === 'abrir') {
    await abrirProyectoIO(tienda, payload as { ruta?: string } | undefined)
  }
}

/** Resultado "reenviado": el satélite no ejecuta nada, solo pide al primario. */
function resultadoReenviado(tienda: TiendaDAW): CommandResult {
  return {
    success: true,
    state: tienda.obtenerEstado(),
    events: [],
    result: { reenviadoAlPrimario: true },
  }
}

export function MultiWindowSync({ role }: { role: 'primary' | 'satellite' }) {
  const tienda = useDAW()

  useEffect(() => {
    const ch = obtenerCanal()
    if (!ch) return

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
        const data = ev.data
        if (!esMensajeSincronizacion(data)) return
        if (data.type === 'request-state' || data.type === 'ping') {
          lastPing = Date.now()
          if (data.type === 'request-state') publish()
        }
        if (data.type === 'command') {
          void tienda.executor.execute(data.command, data.payload ?? {})
        }
        if (data.type === 'action') {
          void ejecutarAccionEnPrimario(tienda, data.action, data.payload)
        }
      }
      return () => {
        window.removeEventListener('jaswave-force-daw-sync', onForce)
        if (debounce) clearTimeout(debounce)
        unsub()
        ch.onmessage = null
      }
    }

    // Satélite: pide el estado y espera; no ejecuta nada por su cuenta.
    let gotState = false
    const retry = window.setInterval(() => {
      ch.postMessage({ type: gotState ? 'ping' : 'request-state' })
    }, 400)
    ch.postMessage({ type: 'request-state' })

    ch.onmessage = (ev) => {
      const data = ev.data
      if (!esMensajeSincronizacion(data)) return
      if (data.type === 'state' && data.state) {
        gotState = true
        // Gancho de depuración/pruebas: último estado recibido del primario.
        ;(globalThis as unknown as { __jaswaveSateliteEstado?: unknown }).__jaswaveSateliteEstado =
          data.state
        tienda.reemplazarEstado(data.state as DAWState)
      }
    }

    // U7: sin autoridad local. Los comandos se reenvían al primario y el estado
    // llega de vuelta por el canal (así los ids los genera la ventana principal).
    const originalExecute = tienda.executor.execute.bind(tienda.executor)
    const originalUndo = tienda.executor.undo.bind(tienda.executor)
    const originalRedo = tienda.executor.redo.bind(tienda.executor)
    tienda.executor.execute = async <T = unknown>(
      type: string,
      payload: unknown,
      _source?: 'user' | 'macro' | 'script' | 'ai',
      _userId?: string,
    ): Promise<CommandResult<T>> => {
      enviarMensaje({ type: 'command', command: type, payload })
      return resultadoReenviado(tienda) as CommandResult<T>
    }
    tienda.executor.undo = async () => {
      enviarMensaje({ type: 'action', action: 'deshacer' })
      return resultadoReenviado(tienda)
    }
    tienda.executor.redo = async () => {
      enviarMensaje({ type: 'action', action: 'rehacer' })
      return resultadoReenviado(tienda)
    }

    // Gancho de depuración/pruebas: ejecutar un comando desde la ventana satélite
    // (debe acabar en la ventana principal).
    ;(
      globalThis as unknown as {
        __jaswaveSateliteEjecutar?: (type: string, payload?: unknown) => Promise<unknown>
      }
    ).__jaswaveSateliteEjecutar = (type, payload) => tienda.executor.execute(type, payload ?? {})

    return () => {
      clearInterval(retry)
      tienda.executor.execute = originalExecute
      tienda.executor.undo = originalUndo
      tienda.executor.redo = originalRedo
      ch.onmessage = null
      cerrarCanal()
    }
  }, [role, tienda])

  return null
}
