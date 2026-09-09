/**
 * Lanes apilados de tomas + matriz de comp por pista.
 */

import { useCallback, useMemo, useState } from 'react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { CompSegment, Take, TakeFolder } from '../../shared/src/types/entidades'
import { beatsASegundos, segundosABeats } from '@/lib/audio-conversions'
import { flattenCompToClip } from '@/src/lib/comp-flatten'

type Props = {
  pistaId: string
  onClose?: () => void
}

const LANE_H = 28

export function TakeLanesPanel({ pistaId, onClose }: Props) {
  const tienda = useDAW()
  const bpm = useDAWState((s) => s.project?.bpm?.valor ?? 120)
  const folder = useDAWState((s) => s.project?.takeFolders?.find((f) => f.pistaId === pistaId))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const compSegments = folder?.segments ?? []
  const takes = folder?.takes ?? []

  const tlRange = useMemo(() => {
    const all = [...compSegments.map((s) => s.timelineFin), ...takes.map((t) => t.finGrabacion)]
    const maxBeats = all.length ? Math.max(...all.map((v) => (typeof v === 'number' && v > 100 ? v : segundosABeats(v, bpm)))) : 16
    return { start: 0, end: Math.max(16, maxBeats) }
  }, [compSegments, takes, bpm])

  const ensureFolder = useCallback(async () => {
    await tienda.executor.execute('take.folder.ensure', { pistaId })
  }, [tienda, pistaId])

  const promoteTake = useCallback(
    async (take: Take) => {
      await ensureFolder()
      const tl0 = take.inicioGrabacion > 100 ? take.inicioGrabacion : segundosABeats(take.inicioGrabacion, bpm)
      const dur =
        take.finGrabacion > take.inicioGrabacion
          ? take.finGrabacion > 100
            ? take.finGrabacion - take.inicioGrabacion
            : segundosABeats(take.finGrabacion - take.inicioGrabacion, bpm)
          : segundosABeats(Math.max(0.1, take.finGrabacion - take.inicioGrabacion), bpm)
      await tienda.executor.execute('comp.segment.set', {
        pistaId,
        takeId: take.id,
        timelineInicio: tl0,
        timelineFin: tl0 + Math.max(0.25, dur),
        origenInicio: 0,
        origenFin: Math.max(0.1, take.finGrabacion - take.inicioGrabacion),
      })
    },
    [tienda, pistaId, bpm, ensureFolder],
  )

  const flatten = useCallback(async () => {
    setBusy(true)
    setMsg('Aplanando comp…')
    const r = await flattenCompToClip(tienda, pistaId)
    setBusy(false)
    setMsg(r.error ?? (r.clipId ? `Clip creado: ${r.clipId}` : 'Listo'))
  }, [tienda, pistaId])

  if (!folder) {
    return (
      <div className="rounded border border-zinc-700 bg-zinc-900/90 p-3 text-sm text-zinc-200">
        <p className="mb-2">Sin carpeta de tomas en esta pista.</p>
        <button
          type="button"
          className="rounded bg-amber-700/80 px-2 py-1 text-xs hover:bg-amber-600"
          onClick={() => void ensureFolder()}
        >
          Crear carpeta de tomas
        </button>
        {onClose && (
          <button type="button" className="ml-2 text-xs text-zinc-400 underline" onClick={onClose}>
            Cerrar
          </button>
        )}
      </div>
    )
  }

  const spanBeats = tlRange.end - tlRange.start || 1
  const segLeft = (s: CompSegment) =>
    `${((s.timelineInicio - tlRange.start) / spanBeats) * 100}%`
  const segWidth = (s: CompSegment) =>
    `${((s.timelineFin - s.timelineInicio) / spanBeats) * 100}%`

  return (
    <div className="rounded border border-zinc-700 bg-zinc-900/95 p-2 text-xs text-zinc-200">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-medium text-amber-200">Tomas / Comp</span>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={busy || !compSegments.length}
            className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600 disabled:opacity-40"
            onClick={() => void flatten()}
          >
            Flatten
          </button>
          {onClose && (
            <button type="button" className="text-zinc-400 underline" onClick={onClose}>
              Cerrar
            </button>
          )}
        </div>
      </div>
      {msg && <p className="mb-2 text-zinc-400">{msg}</p>}

      <div className="mb-1 rounded bg-emerald-950/50 px-1" style={{ height: LANE_H }}>
        <div className="relative h-full w-full">
          {compSegments.map((s) => (
            <div
              key={s.id}
              className="absolute top-1 bottom-1 rounded bg-emerald-600/80"
              style={{ left: segLeft(s), width: segWidth(s) }}
              title={`Comp: ${s.takeId}`}
            />
          ))}
          <span className="absolute left-1 top-1 text-[10px] text-emerald-300">Comp</span>
        </div>
      </div>

      {takes.map((take, i) => (
        <div
          key={take.id}
          className="mb-1 flex items-center gap-2 rounded bg-zinc-800/80 px-1"
          style={{ height: LANE_H }}
        >
          <button
            type="button"
            className="shrink-0 text-[10px] text-sky-400 underline"
            onClick={() =>
              void tienda.executor.execute('take.preview', { pistaId, takeId: take.id })
            }
          >
            Aud
          </button>
          <span className="flex-1 truncate">{take.nombre || `Take ${i + 1}`}</span>
          <button
            type="button"
            className="shrink-0 rounded bg-amber-800/70 px-1.5 py-0.5 text-[10px] hover:bg-amber-700"
            onClick={() => void promoteTake(take)}
          >
            → Comp
          </button>
          <button
            type="button"
            className="shrink-0 text-[10px] text-red-400"
            onClick={() => void tienda.executor.execute('take.delete', { takeId: take.id })}
          >
            ×
          </button>
        </div>
      ))}

      {!takes.length && (
        <p className="text-zinc-500">Graba en modo Comp para añadir tomas.</p>
      )}
    </div>
  )
}
