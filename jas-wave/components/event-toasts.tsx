import { useState, useRef } from 'react'
import { useEventBus } from '../src/context/daw-context'
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react'

interface Toast {
  id: number
  message: string
  type: 'success' | 'warning' | 'info'
}

let toastId = 0

const EVENT_TOAST_MAP: Record<string, { message: string; type: Toast['type'] }> = {
  'track.creada': { message: 'Pista creada', type: 'success' },
  'track.eliminada': { message: 'Pista eliminada', type: 'warning' },
  'proyecto.guardado': { message: 'Proyecto guardado', type: 'success' },
  'proyecto.cargado': { message: 'Proyecto cargado', type: 'success' },
  'proyecto.creado': { message: 'Nuevo proyecto creado', type: 'info' },
  'grabacion.iniciada': { message: 'Grabación iniciada', type: 'warning' },
  'grabacion.detenida': { message: 'Grabación detenida', type: 'info' },
  'exportacion.completada': { message: 'Exportación completada', type: 'success' },
  'exportacion.error': { message: 'Error en exportación', type: 'warning' },
  'comando.fallido': { message: 'Acción fallida', type: 'warning' },
  'validacion.advertencia': { message: 'Advertencia de validación', type: 'warning' },
  'sistema.error': { message: 'Error del sistema', type: 'warning' },
  'portapapeles.copiado': { message: 'Clip copiado', type: 'success' },
  'portapapeles.pegado': { message: 'Clip pegado', type: 'success' },
}

export function EventToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const setToastsRef = useRef(setToasts)
  setToastsRef.current = setToasts

  const addToast = (message: string, type: Toast['type']) => {
    const id = ++toastId
    setToastsRef.current((prev) => [...prev.slice(-4), { id, message, type }])
    setTimeout(() => {
      setToastsRef.current((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }

  // Subscribe to all event toast events via hook — automatic cleanup
  useEventBus(
    Object.entries(EVENT_TOAST_MAP).map(([nombre, config]) => ({
      nombre,
      manejador: (payload: unknown) => {
        if (nombre === 'comando.fallido') {
          const p = payload as { error?: string; type?: string }
          addToast(p.error ? `${config.message}: ${p.error}` : config.message, config.type)
          return
        }
        if (nombre === 'portapapeles.copiado' || nombre === 'portapapeles.pegado') {
          const p = payload as { cantidad?: number }
          const n = p.cantidad ?? 1
          const verb = nombre === 'portapapeles.copiado' ? 'copiado' : 'pegado'
          addToast(n === 1 ? `Clip ${verb}` : `${n} clips ${verb}s`, config.type)
          return
        }
        if (nombre === 'validacion.advertencia') {
          const p = payload as { message?: string; code?: string }
          // No spamear AUTH_MISSING / ruido de pipeline en escritorio local
          if (p.code === 'AUTH_MISSING') return
          addToast(p.message ?? config.message, config.type)
          return
        }
        addToast(config.message, config.type)
      },
    }))
  )

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = toast.type === 'success' ? CheckCircle : toast.type === 'warning' ? AlertTriangle : Info
        const bg = toast.type === 'success'
          ? 'bg-green-500/15 border-green-500/30 text-green-400'
          : toast.type === 'warning'
            ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
            : 'bg-accent-cyan/15 border-accent-cyan/30 text-accent-cyan'

        return (
          <div
            key={toast.id}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] shadow-lg backdrop-blur-sm ${bg}`}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="font-medium">{toast.message}</span>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="ml-2 shrink-0 opacity-60 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
