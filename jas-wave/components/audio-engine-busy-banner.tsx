import { useCallback, useEffect, useState } from 'react'
import { ArrowDownToLine, VolumeX } from 'lucide-react'

/**
 * Aviso de motor de audio ocupado: otra instancia de JasWave tiene el dispositivo (o esta se lo cedió).
 * Esta queda sin sonido sin pelear por el driver; «Usar audio aquí» se lo pide a la otra, que para su
 * transporte y lo suelta sin cerrarse.
 */
export function AudioEngineBusyBanner() {
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trayendo, setTrayendo] = useState(false)

  useEffect(() => {
    const off = window.electron?.onAudioEngineBusy?.((info) => {
      setMensaje(info?.activo ? (info.mensaje ?? 'Otra ventana de JasWave está usando el motor de audio.') : null)
      setError(null)
    })
    return () => {
      off?.()
    }
  }, [])

  const traer = useCallback(async () => {
    setTrayendo(true)
    setError(null)
    try {
      const r = await window.electron?.audioEngineTake?.()
      if (r && !r.ok) setError(r.message ?? 'No se pudo traer el motor de audio')
    } finally {
      setTrayendo(false)
    }
  }, [])

  if (!mensaje) return null

  return (
    <div
      data-testid="audio-engine-busy"
      role="status"
      className="fixed top-3 left-1/2 z-[82] -translate-x-1/2 flex max-w-[min(760px,calc(100vw-32px))] items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-[12px] text-amber-200 shadow-lg backdrop-blur-sm"
    >
      <VolumeX className="size-4 shrink-0" />
      <span className="font-medium shrink-0">Motor de audio en uso</span>
      <span className="text-amber-200/80">{error ?? mensaje}</span>
      {window.electron?.audioEngineTake ? (
        <button
          type="button"
          data-testid="audio-engine-take"
          disabled={trayendo}
          onClick={() => void traer()}
          className="flex shrink-0 items-center gap-1 rounded-md border border-amber-500/50 px-2 py-1 font-medium text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
        >
          <ArrowDownToLine className={`size-3.5 ${trayendo ? 'animate-pulse' : ''}`} />
          {trayendo ? 'Trayendo…' : 'Usar audio aquí'}
        </button>
      ) : null}
    </div>
  )
}
