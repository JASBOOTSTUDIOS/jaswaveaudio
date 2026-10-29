import { useEffect, useState } from 'react'
import { audioEngine } from '@/lib/audio-engine'
import { isNativeMeterHostAvailable, refreshNativeMixMeters } from '@/src/lib/plugin/native-mix-meters'

const SILENCIO = { l: 0, r: 0 }

/**
 * Picos L/R lineales post-fader de una pista (o del master con `'master'`), leídos cada ~50 ms.
 * Para paneles con un solo canal (inspector); el mixer lee todas sus tiras en un único bucle.
 */
export function useStereoMeter(trackId: string | null | undefined): { l: number; r: number } {
  const [peaks, setPeaks] = useState(SILENCIO)
  useEffect(() => {
    if (!trackId) {
      setPeaks(SILENCIO)
      return
    }
    let cancelled = false
    const leer = () => {
      if (cancelled) return
      const next = trackId === 'master' ? audioEngine.getMasterStereoPeaks() : audioEngine.getStereoMeterPeaks(trackId)
      setPeaks((prev) => (Math.abs(prev.l - next.l) < 1e-4 && Math.abs(prev.r - next.r) < 1e-4 ? prev : next))
    }
    const timer = setInterval(() => {
      // La lectura no espera al host: si está ocupado (cargando un VST, renderizando) se sigue mostrando la
      // parte Web Audio y la última lectura nativa, en vez de congelar la barra hasta que responda.
      if (isNativeMeterHostAvailable()) void refreshNativeMixMeters().then(leer, () => {})
      leer()
    }, 50)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [trackId])
  return peaks
}
