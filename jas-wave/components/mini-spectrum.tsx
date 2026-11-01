/**
 * Mini analizador de espectro de una tira del mixer (post-fader, 20 Hz–20 kHz en escala log).
 * Los datos vienen de la FFT del plugin host: de la pista con `getStemSpectrum` (un tap por pista, varios
 * a la vez) o del master con `getMasterSpectrum`.
 */
import { useEffect, useRef } from 'react'
import {
  getNativeMasterSpectrum,
  getNativeTrackSpectrum,
  isNativeMeterHostAvailable,
  refreshNativeMasterSpectrum,
  refreshNativeTrackSpectrum,
  releaseNativeTrackSpectrum,
} from '@/src/lib/plugin/native-mix-meters'
import { alturasEspectro } from '@/lib/meter-scale'

/** El canvas no entiende `var(--x)`: se resuelve contra los estilos del elemento. */
function resolverColor(color: string, el: Element): string {
  const m = /^var\((--[^),\s]+)/.exec(color)
  if (!m) return color
  return getComputedStyle(el).getPropertyValue(m[1]!).trim() || '#a3a3a3'
}

export function MiniSpectrum({ trackId, color }: { trackId: string; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const disponible = isNativeMeterHostAvailable()

  useEffect(() => {
    if (!disponible) return
    const esMaster = trackId === 'master'
    let cancelled = false
    const dibujar = () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const cols = esMaster ? getNativeMasterSpectrum() : getNativeTrackSpectrum(trackId)
      if (!cols) return
      const alturas = alturasEspectro(cols)
      const ancho = w / alturas.length
      ctx.fillStyle = resolverColor(color, canvas)
      ctx.globalAlpha = 0.85
      for (let i = 0; i < alturas.length; i++) {
        const bh = alturas[i]! * h
        if (bh < 0.5) continue
        ctx.fillRect(i * ancho, h - bh, Math.max(1, ancho - 0.5), bh)
      }
    }
    const timer = setInterval(() => {
      const p = esMaster ? refreshNativeMasterSpectrum() : refreshNativeTrackSpectrum(trackId)
      void p.then(() => {
        if (!cancelled) dibujar()
      })
    }, 66)
    return () => {
      cancelled = true
      clearInterval(timer)
      // Libera solo el tap de esta pista: los espectros de otras tiras siguen abiertos.
      if (!esMaster) releaseNativeTrackSpectrum(trackId)
    }
  }, [trackId, color, disponible])

  if (!disponible) {
    return (
      <p className="h-10 text-center text-[8px] leading-10 text-muted-foreground" title="El espectro lo calcula el plugin host">
        Sin host de audio
      </p>
    )
  }
  return (
    <canvas
      ref={canvasRef}
      className="h-10 w-full rounded-sm bg-background/70 ring-1 ring-border"
      aria-label="Espectro de frecuencias"
      title="Espectro post-fader · 20 Hz–20 kHz"
    />
  )
}
