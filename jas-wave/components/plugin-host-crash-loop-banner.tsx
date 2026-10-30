import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * U7: aviso de bucle de fallos del motor de audio.
 * "El motor de audio se reinició varias veces · Reiniciar motor".
 */
export function PluginHostCrashLoopBanner() {
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    const off = window.electron?.onPluginHostCrashLoop?.((info) => {
      if (info?.activo) {
        setMensaje(info.mensaje ?? 'El motor de audio se reinició varias veces')
        return
      }
      setMensaje(null)
    })
    return () => {
      off?.()
    }
  }, [])

  const reiniciar = useCallback(async () => {
    setOcupado(true)
    try {
      const r = await window.electron?.pluginHostReset?.()
      if (!r?.ok) {
        setMensaje(r?.message ?? 'No se pudo reiniciar el motor de audio')
        return
      }
      setMensaje(null)
    } finally {
      setOcupado(false)
    }
  }, [])

  if (!mensaje) return null

  return (
    <div
      data-testid="plugin-host-crash-loop"
      className="fixed top-3 left-1/2 z-[82] -translate-x-1/2 flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-[12px] text-amber-200 shadow-lg backdrop-blur-sm"
    >
      <AlertTriangle className="size-4 shrink-0" />
      <span className="font-medium">El motor de audio se reinició varias veces</span>
      <span className="text-amber-200/80">{mensaje}</span>
      <button
        type="button"
        data-testid="plugin-host-reset"
        disabled={ocupado}
        onClick={() => void reiniciar()}
        className="flex items-center gap-1 rounded-md border border-amber-500/50 px-2 py-1 font-medium text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
      >
        <RefreshCw className={`size-3.5 ${ocupado ? 'animate-spin' : ''}`} />
        Reiniciar motor
      </button>
    </div>
  )
}
