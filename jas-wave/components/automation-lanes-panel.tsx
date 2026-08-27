/**
 * Lanes MVP de automatización vol/pan + write-on-play.
 */

import { useState } from 'react'
import { useDAW, useDAWState } from '../src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'
import { audioEngine } from '@/lib/audio-engine'

/** Armado global de escritura (mixer + arrange). */
let writeArmed = false

export function isAutomationWriteArmed(): boolean {
  return writeArmed
}

export function setAutomationWriteArmed(next: boolean): void {
  writeArmed = next
}

/** Si Write está armado y hay play, graba el fader/pan en la curva. */
export function maybeWriteAutomationPoint(
  tienda: { executor: { execute: (t: string, p: Record<string, unknown>) => unknown } },
  trackId: string,
  parametro: 'volumen' | 'paneo',
  valor: number,
  playing: boolean,
): void {
  if (!writeArmed || !playing) return
  const tiempo = audioEngine.getTimelineSeconds()
  void tienda.executor.execute('automation.writePoint', {
    trackId,
    parametro,
    tiempo,
    valor,
  })
}

function LaneSpark({
  puntos,
  min,
  max,
}: {
  puntos: { tiempo: number; valor: number }[]
  min: number
  max: number
}) {
  if (!puntos.length) {
    return <div className="h-6 w-full rounded bg-black/20" />
  }
  const t0 = puntos[0]!.tiempo
  const t1 = Math.max(t0 + 0.01, puntos[puntos.length - 1]!.tiempo)
  const span = t1 - t0
  const pts = puntos
    .map((p) => {
      const x = ((p.tiempo - t0) / span) * 100
      const y = (1 - (p.valor - min) / Math.max(1e-6, max - min)) * 100
      return `${x},${y}`
    })
    .join(' ')
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-6 w-full rounded bg-black/20">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={pts} className="text-accent-cyan" />
    </svg>
  )
}

export function AutomationLanesPanel() {
  const tienda = useDAW()
  const tracks = useDAWState((s: DAWState) => s.project?.tracks ?? [])
  const selectedId = useDAWState((s: DAWState) => getSelectedTrackId(s))
  const playing = useDAWState((s: DAWState) => Boolean(s.transport?.reproduciendo))
  const [armed, setArmed] = useState(() => isAutomationWriteArmed())
  const track = tracks.find((t) => t.id === selectedId)

  const toggleWrite = () => {
    const next = !isAutomationWriteArmed()
    setAutomationWriteArmed(next)
    setArmed(next)
  }

  if (!track) {
    return (
      <div className="border-t border-border p-2 text-[10px] text-muted-foreground">
        Selecciona una pista para editar automatización.
      </div>
    )
  }
  const vol = track.automatizaciones?.find((a) => a.parametro === 'volumen')
  const pan = track.automatizaciones?.find((a) => a.parametro === 'paneo')

  const setRamp = (parametro: 'volumen' | 'paneo', from: number, to: number, endSec: number) => {
    void tienda.executor.execute('automation.setCurve', {
      trackId: track.id,
      parametro,
      puntos: [
        { tiempo: 0, valor: from },
        { tiempo: endSec, valor: to },
      ],
    })
  }

  return (
    <div className="border-t border-border p-2 text-[10px]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="font-medium text-foreground">Automatización · {track.nombre}</p>
        <button
          type="button"
          onClick={toggleWrite}
          className={`rounded px-2 py-0.5 font-semibold ${
            armed
              ? 'bg-destructive/25 text-destructive'
              : 'bg-panel-raised text-muted-foreground hover:text-foreground'
          }`}
          title={
            armed
              ? 'Write ON: mover fader/pan en play graba la curva'
              : 'Write OFF: arma para grabar faders en play'
          }
        >
          {armed ? (playing ? 'WRITE ●' : 'WRITE') : 'Write'}
        </button>
      </div>
      <div className="mb-1 grid grid-cols-2 gap-2">
        <div>
          <p className="mb-0.5 text-muted-foreground">Volumen</p>
          <LaneSpark puntos={vol?.puntos ?? []} min={0} max={1} />
        </div>
        <div>
          <p className="mb-0.5 text-muted-foreground">Paneo</p>
          <LaneSpark puntos={pan?.puntos ?? []} min={-1} max={1} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className="rounded bg-panel-raised px-2 py-0.5 hover:bg-accent-amber/20"
          onClick={() => setRamp('volumen', 0.2, 0.9, 8)}
        >
          Vol fade-in 8s
        </button>
        <button
          type="button"
          className="rounded bg-panel-raised px-2 py-0.5 hover:bg-accent-amber/20"
          onClick={() => setRamp('volumen', 0.9, 0.1, 8)}
        >
          Vol fade-out 8s
        </button>
        <button
          type="button"
          className="rounded bg-panel-raised px-2 py-0.5 hover:bg-accent-amber/20"
          onClick={() => setRamp('paneo', -0.8, 0.8, 4)}
        >
          Pan L→R 4s
        </button>
        {(vol || pan) && (
          <button
            type="button"
            className="rounded px-2 py-0.5 text-muted-foreground hover:bg-panel-raised"
            onClick={() => void tienda.executor.execute('automation.clear', { trackId: track.id })}
          >
            Limpiar
          </button>
        )}
      </div>
      <p className="mt-1 text-muted-foreground">
        Curvas: vol={vol?.puntos?.length ?? 0} pts · pan={pan?.puntos?.length ?? 0} pts
        {armed ? ' · Write armado' : ''}
      </p>
    </div>
  )
}
