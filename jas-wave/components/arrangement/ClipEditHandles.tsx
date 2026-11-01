/**
 * Manijas de edición dentro de un clip del arrange (G3):
 *  - Fade in / fade out (esquinas superiores): arrastre horizontal = duración; vertical = curva.
 *  - Ganancia del clip (centro superior): arrastre vertical = dB (doble clic = 0 dB).
 *  - Clip silenciado: franjas diagonales y etiqueta [MUTE] (audio y MIDI).
 * Durante el arrastre solo hay vista previa local; al soltar se ejecuta UN comando (un paso de undo).
 */

import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useDAW } from '@/src/context/daw-context'

type Curva = 'lineal' | 'exponencial' | 'logaritmica'
const CURVAS: Curva[] = ['lineal', 'exponencial', 'logaritmica']

export type EdicionClip = {
  silenciado?: boolean
  ganancia?: number
  fadeIn?: { duracion?: number; curva?: string } | null
  fadeOut?: { duracion?: number; curva?: string } | null
}

function curvaDe(v: unknown): Curva {
  return v === 'exponencial' || v === 'logaritmica' ? v : 'lineal'
}

/** Forma del fundido para dibujarlo (0..1 → 0..1), la misma que aplica el motor. */
function forma(x: number, c: Curva): number {
  if (c === 'exponencial') return x * x
  if (c === 'logaritmica') return Math.sqrt(x)
  return x
}

/** Polígono de la zona atenuada de un fundido dentro de un ancho `w` y alto `h`. */
function trazadoFade(w: number, h: number, curva: Curva, salida: boolean): string {
  const pts: string[] = []
  const N = 16
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * w
    const g = forma(salida ? 1 - i / N : i / N, curva)
    pts.push(`${x.toFixed(1)},${(h * (1 - g)).toFixed(1)}`)
  }
  // Zona por encima de la curva de ganancia (lo que el fundido quita), cerrada por el borde superior.
  return `0,0 ${pts.join(' ')} ${w},0`
}

export function ClipMutedOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[15]"
      style={{
        background:
          'repeating-linear-gradient(135deg, rgba(0,0,0,0.28) 0px, rgba(0,0,0,0.28) 6px, transparent 6px, transparent 12px)',
      }}
    >
      <span className="absolute right-1 top-0.5 rounded bg-black/60 px-1 font-mono text-[9px] font-bold text-muted-foreground">
        [MUTE]
      </span>
    </div>
  )
}

export function ClipEditHandles({
  pistaId,
  clipId,
  edicion,
  anchoPx,
  altoPx,
  duracionSec,
}: {
  pistaId: string
  clipId: string
  edicion: EdicionClip
  anchoPx: number
  altoPx: number
  duracionSec: number
}) {
  const tienda = useDAW()
  const pxPorSeg = duracionSec > 0 ? anchoPx / duracionSec : 0
  const [preview, setPreview] = useState<{
    fadeIn?: { duracion: number; curva: Curva }
    fadeOut?: { duracion: number; curva: Curva }
    ganancia?: number
  } | null>(null)

  const fiDur = preview?.fadeIn?.duracion ?? edicion.fadeIn?.duracion ?? 0
  const fiCurva = preview?.fadeIn?.curva ?? curvaDe(edicion.fadeIn?.curva)
  const foDur = preview?.fadeOut?.duracion ?? edicion.fadeOut?.duracion ?? 0
  const foCurva = preview?.fadeOut?.curva ?? curvaDe(edicion.fadeOut?.curva)
  const ganancia = preview?.ganancia ?? edicion.ganancia ?? 0

  const arrastrarFade = (e: ReactPointerEvent, tipo: 'in' | 'out') => {
    if (e.button !== 0 || pxPorSeg <= 0) return
    e.stopPropagation()
    e.preventDefault()
    const x0 = e.clientX
    const y0 = e.clientY
    const durIni = tipo === 'in' ? fiDur : foDur
    const curvaIni = tipo === 'in' ? fiCurva : foCurva
    const otro = tipo === 'in' ? foDur : fiDur
    let dur = durIni
    let curva = curvaIni
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) * (tipo === 'in' ? 1 : -1)
      dur = Math.max(0, Math.min(duracionSec - otro, durIni + dx / pxPorSeg))
      // Arrastre vertical: cada 24 px cambia de curva (arriba = más rápida, abajo = más suave).
      const paso = Math.round((y0 - ev.clientY) / 24)
      curva = CURVAS[(((CURVAS.indexOf(curvaIni) + paso) % 3) + 3) % 3]!
      setPreview((p) => ({ ...(p ?? {}), [tipo === 'in' ? 'fadeIn' : 'fadeOut']: { duracion: dur, curva } }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setPreview(null)
      if (Math.abs(dur - durIni) < 1e-4 && curva === curvaIni) return
      void tienda.executor.execute('clip.setFade', { pistaId, clipId, tipo, duracion: dur, curva })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const arrastrarGanancia = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const y0 = e.clientY
    const gIni = ganancia
    let g = gIni
    const move = (ev: PointerEvent) => {
      // 0,25 dB por píxel; Shift = fino (0,05 dB).
      const k = ev.shiftKey ? 0.05 : 0.25
      g = Math.round(Math.max(-48, Math.min(24, gIni + (y0 - ev.clientY) * k)) * 10) / 10
      setPreview((p) => ({ ...(p ?? {}), ganancia: g }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setPreview(null)
      if (g === gIni) return
      void tienda.executor.execute('clip.setGain', { pistaId, clipId, gananciaDb: g })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const fiPx = fiDur * pxPorSeg
  const foPx = foDur * pxPorSeg
  const etiquetaG = `${ganancia > 0 ? '+' : ''}${ganancia.toFixed(1)} dB`

  return (
    <>
      {fiPx > 0.5 && (
        <svg className="pointer-events-none absolute left-0 top-0 z-[12]" width={fiPx} height={altoPx}>
          <polygon points={trazadoFade(fiPx, altoPx, fiCurva, false)} fill="rgba(0,0,0,0.45)" />
        </svg>
      )}
      {foPx > 0.5 && (
        <svg className="pointer-events-none absolute right-0 top-0 z-[12]" width={foPx} height={altoPx}>
          <polygon points={trazadoFade(foPx, altoPx, foCurva, true)} fill="rgba(0,0,0,0.45)" />
        </svg>
      )}
      <div
        role="slider"
        aria-label="Fundido de entrada"
        aria-valuenow={Math.round(fiDur * 1000)}
        title={`Fade in ${(fiDur * 1000).toFixed(0)} ms · ${fiCurva} (arrastra: ↔ duración, ↕ curva)`}
        onPointerDown={(e) => arrastrarFade(e, 'in')}
        className="absolute top-0 z-[16] size-3 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100"
        style={{ left: Math.max(0, fiPx - 6), clipPath: 'polygon(0 0, 100% 0, 0 100%)', background: 'rgba(251,191,36,0.95)' }}
      />
      <div
        role="slider"
        aria-label="Fundido de salida"
        aria-valuenow={Math.round(foDur * 1000)}
        title={`Fade out ${(foDur * 1000).toFixed(0)} ms · ${foCurva} (arrastra: ↔ duración, ↕ curva)`}
        onPointerDown={(e) => arrastrarFade(e, 'out')}
        className="absolute top-0 z-[16] size-3 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100"
        style={{ right: Math.max(0, foPx - 6), clipPath: 'polygon(0 0, 100% 0, 100% 100%)', background: 'rgba(251,191,36,0.95)' }}
      />
      <div
        role="slider"
        aria-label="Ganancia del clip"
        aria-valuenow={ganancia}
        title={`Ganancia del clip ${etiquetaG} (arrastra ↕ · Shift fino · doble clic: 0 dB)`}
        onPointerDown={arrastrarGanancia}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (ganancia !== 0) void tienda.executor.execute('clip.setGain', { pistaId, clipId, gananciaDb: 0 })
        }}
        className={`absolute left-1/2 top-0 z-[16] h-1.5 w-8 -translate-x-1/2 cursor-ns-resize rounded-b bg-sky-300/90 transition-opacity ${
          preview?.ganancia != null || ganancia !== 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      />
      {(preview?.ganancia != null || ganancia !== 0) && (
        <span className="pointer-events-none absolute left-1/2 top-2 z-[16] -translate-x-1/2 rounded bg-black/70 px-1 font-mono text-[9px] tabular-nums text-sky-200">
          {etiquetaG}
        </span>
      )}
    </>
  )
}
