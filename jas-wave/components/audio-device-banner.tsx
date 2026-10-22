import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react'
import { useDAWOptional } from '@/src/context/daw-context'

/**
 * U6: aviso del dispositivo de audio.
 * - `lost`: el host perdió la interfaz → banner con "Reintentar".
 * - `reset`: el driver pidió reinicio → el host ya lo ha reaplicado.
 */
export function AudioDeviceBanner() {
  const tienda = useDAWOptional()
  const [perdido, setPerdido] = useState(false)
  const [reiniciado, setReiniciado] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    const off = window.electron?.onAudioDeviceNotice?.((notice) => {
      if (notice === 'lost') {
        setPerdido(true)
        setReiniciado(false)
        return
      }
      setReiniciado(true)
      setPerdido(false)
    })
    return () => {
      off?.()
    }
  }, [])

  useEffect(() => {
    if (!reiniciado) return
    const t = setTimeout(() => setReiniciado(false), 6000)
    return () => clearTimeout(t)
  }, [reiniciado])

  const reintentar = useCallback(async () => {
    if (!tienda) return
    setOcupado(true)
    try {
      const { ensureBestAudioDevice, armNativeAudioOutput } = await import('@/src/lib/audio-device-cli')
      const res = await ensureBestAudioDevice(tienda, 'UMC')
      if (res.ok) {
        await armNativeAudioOutput()
        setPerdido(false)
      }
    } finally {
      setOcupado(false)
    }
  }, [tienda])

  if (!perdido && !reiniciado) return null

  if (perdido) {
    return (
      <div className="fixed top-3 left-1/2 z-[80] -translate-x-1/2 flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/15 px-4 py-2 text-[12px] text-red-200 shadow-lg backdrop-blur-sm">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="font-medium">Interfaz desconectada</span>
        <button
          type="button"
          onClick={() => void reintentar()}
          disabled={ocupado}
          className="flex items-center gap-1 rounded border border-red-400/40 px-2 py-0.5 hover:bg-red-400/20 disabled:opacity-50"
        >
          {ocupado ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          Reintentar
        </button>
        <button
          type="button"
          onClick={() => setPerdido(false)}
          aria-label="Cerrar aviso"
          className="opacity-60 hover:opacity-100"
        >
          <X className="size-3" />
        </button>
      </div>
    )
  }

  return (
    <div className="fixed top-3 left-1/2 z-[80] -translate-x-1/2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-[12px] text-amber-200 shadow-lg backdrop-blur-sm">
      <RefreshCw className="size-3.5 shrink-0" />
      <span className="font-medium">Interfaz reiniciada por el driver</span>
      <button
        type="button"
        onClick={() => setReiniciado(false)}
        aria-label="Cerrar aviso"
        className="opacity-60 hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
