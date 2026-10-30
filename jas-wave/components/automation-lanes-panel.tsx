/**
 * Lanes MVP de automatización vol/pan + write-on-play.
 */

import { useState } from 'react'
import { useDAW, useDAWState } from '../src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'
import { audioEngine } from '@/lib/audio-engine'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { OpcionesEjecucion } from '../../shared/src/types/command'

/** Armado global de escritura (mixer + arrange). */
let writeArmed = false

export function isAutomationWriteArmed(): boolean {
  return writeArmed
}

export function setAutomationWriteArmed(next: boolean): void {
  writeArmed = next
}

/**
 * Si Write está armado y hay play, graba el fader/pan en la curva. Con
 * `opciones` (coalescencia del gesto del fader) los puntos escritos durante un
 * arrastre se deshacen junto con el movimiento del fader.
 */
export function maybeWriteAutomationPoint(
  tienda: {
    executor: {
      execute: (t: string, p: Record<string, unknown>, source?: 'user', userId?: string, opciones?: OpcionesEjecucion) => unknown
    }
  },
  trackId: string,
  parametro: 'volumen' | 'paneo',
  valor: number,
  playing: boolean,
  opciones?: OpcionesEjecucion,
): void {
  if (!writeArmed || !playing) return
  const tiempo = audioEngine.getTimelineSeconds()
  void tienda.executor.execute(
    'automation.writePoint',
    {
      trackId,
      parametro,
      tiempo,
      valor,
    },
    'user',
    undefined,
    opciones,
  )
}

type ConfirmacionPendiente = { titulo: string; mensaje: string; confirmar: string; accion: () => void }

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
  const [pendiente, setPendiente] = useState<ConfirmacionPendiente | null>(null)
  const track = tracks.find((t) => t.id === selectedId)

  const toggleWrite = () => {
    const next = !isAutomationWriteArmed()
    setAutomationWriteArmed(next)
    setArmed(next)
  }

  if (!track) {
    return (
      <div className="flex h-full flex-col bg-panel p-4 text-[12px] text-muted-foreground">
        <p className="font-medium text-foreground">Automatización</p>
        <p className="mt-2">Selecciona una pista en el arrange para editar curvas de volumen y paneo.</p>
      </div>
    )
  }
  const vol = track.automatizaciones?.find((a) => a.parametro === 'volumen')
  const pan = track.automatizaciones?.find((a) => a.parametro === 'paneo')

  const aplicarRampa = (parametro: 'volumen' | 'paneo', from: number, to: number, endSec: number) => {
    void tienda.executor.execute('automation.setCurve', {
      trackId: track.id,
      parametro,
      puntos: [
        { tiempo: 0, valor: from },
        { tiempo: endSec, valor: to },
      ],
    })
  }

  /** Un preset de rampa reemplaza la curva: si ya hay puntos, pedir confirmación. */
  const setRamp = (parametro: 'volumen' | 'paneo', from: number, to: number, endSec: number) => {
    const existente = parametro === 'volumen' ? vol : pan
    const puntos = existente?.puntos?.length ?? 0
    if (puntos === 0) {
      aplicarRampa(parametro, from, to, endSec)
      return
    }
    setPendiente({
      titulo: 'Reemplazar curva',
      mensaje: `La curva de ${parametro} ya tiene ${puntos} punto(s). El preset la reemplazará (puedes deshacerlo con Ctrl+Z).`,
      confirmar: 'Reemplazar',
      accion: () => aplicarRampa(parametro, from, to, endSec),
    })
  }

  const pedirLimpiar = () => {
    setPendiente({
      titulo: 'Limpiar automatización',
      mensaje: `Se borrarán todas las curvas de automatización de «${track.nombre}» (puedes deshacerlo con Ctrl+Z).`,
      confirmar: 'Limpiar',
      accion: () => void tienda.executor.execute('automation.clear', { trackId: track.id }),
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-panel p-3 text-[11px]">
      <ConfirmDialog
        open={pendiente !== null}
        onClose={() => setPendiente(null)}
        onConfirm={() => {
          const p = pendiente
          setPendiente(null)
          p?.accion()
        }}
        title={pendiente?.titulo ?? ''}
        message={pendiente?.mensaje ?? ''}
        confirmLabel={pendiente?.confirmar ?? 'Confirmar'}
        variant="warning"
      />
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-foreground">Automatización · {track.nombre}</p>
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
            onClick={pedirLimpiar}

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
