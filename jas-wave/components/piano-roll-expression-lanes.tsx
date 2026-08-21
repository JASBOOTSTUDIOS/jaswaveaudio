/**
 * Lanes de expresión: CC y Pitch Bend (textos en español).
 */

import { useMemo, useState } from 'react'
import type { MidiClipExpression, MidiAutomationPoint } from '../../shared/src/types/clips'
import { sampleAutomation } from '../../shared/src/midi/expression'

type LaneKind = 'cc1' | 'cc11' | 'cc64' | 'pitch'

type Props = {
  width: number
  durationBeats: number
  pxPerBeat: number
  expression?: MidiClipExpression
  onSetCc: (cc: number, puntos: { tiempo: number; valor: number }[]) => void
  onSetPitchBend: (puntos: { tiempo: number; valor: number }[]) => void
}

const LANE_H = 48

function pointsForCc(expression: MidiClipExpression | undefined, cc: number): MidiAutomationPoint[] {
  return expression?.cc?.find((l) => l.cc === cc)?.puntos ?? []
}

export function PianoRollExpressionLanes({
  width,
  durationBeats,
  pxPerBeat,
  expression,
  onSetCc,
  onSetPitchBend,
}: Props) {
  const [active, setActive] = useState<LaneKind>('cc1')

  const lanes: { id: LaneKind; label: string }[] = [
    { id: 'cc1', label: 'CC1 Modulación' },
    { id: 'cc11', label: 'CC11 Expresión' },
    { id: 'cc64', label: 'CC64 Sustain' },
    { id: 'pitch', label: 'Pitch bend' },
  ]

  const points = useMemo(() => {
    if (active === 'pitch') return expression?.pitchBend ?? []
    const cc = active === 'cc1' ? 1 : active === 'cc11' ? 11 : 64
    return pointsForCc(expression, cc)
  }, [active, expression])

  const polyline = useMemo(() => {
    if (points.length === 0) return ''
    const sorted = [...points].sort((a, b) => a.tiempo - b.tiempo)
    return sorted
      .map((p) => {
        const x = p.tiempo * pxPerBeat
        const norm = active === 'pitch' ? (p.valor + 1) / 2 : p.valor
        const y = LANE_H - 4 - norm * (LANE_H - 8)
        return `${x},${y}`
      })
      .join(' ')
  }, [points, pxPerBeat, active])

  const addPoint = (clientX: number, el: HTMLDivElement) => {
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left
    const tiempo = Math.max(0, Math.min(durationBeats, x / pxPerBeat))
    const valor = active === 'pitch' ? 0 : 0.75
    const next = [...points.map((p) => ({ tiempo: p.tiempo, valor: p.valor })), { tiempo, valor }]
    next.sort((a, b) => a.tiempo - b.tiempo)
    if (active === 'pitch') onSetPitchBend(next)
    else {
      const cc = active === 'cc1' ? 1 : active === 'cc11' ? 11 : 64
      onSetCc(cc, next)
    }
  }

  const dragPoint = (pointId: string, clientY: number, el: HTMLDivElement) => {
    const rect = el.getBoundingClientRect()
    const y = clientY - rect.top
    let valor = 1 - Math.max(0, Math.min(1, (y - 4) / (LANE_H - 8)))
    if (active === 'pitch') valor = valor * 2 - 1
    const next = points.map((p) =>
      p.id === pointId ? { tiempo: p.tiempo, valor } : { tiempo: p.tiempo, valor: p.valor },
    )
    if (active === 'pitch') onSetPitchBend(next)
    else {
      const cc = active === 'cc1' ? 1 : active === 'cc11' ? 11 : 64
      onSetCc(cc, next)
    }
  }

  const mid = sampleAutomation(points, durationBeats / 2)

  return (
    <div className="flex shrink-0 flex-col border-t border-border bg-panel">
      <div className="flex h-7 items-center gap-1 border-b border-border px-2">
        <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          Expresión
        </span>
        {lanes.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setActive(l.id)}
            className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
              active === l.id ? 'bg-accent-amber/20 text-accent-amber' : 'text-muted-foreground hover:bg-panel-raised'
            }`}
          >
            {l.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[9px] text-muted-foreground">
          {mid === null ? '—' : active === 'pitch' ? mid.toFixed(2) : Math.round(mid * 127)}
        </span>
      </div>
      <div
        className="relative cursor-crosshair bg-panel-raised/40"
        style={{ width, height: LANE_H }}
        onDoubleClick={(e) => addPoint(e.clientX, e.currentTarget)}
        title="Doble clic para añadir punto"
      >
        <svg width={width} height={LANE_H} className="absolute inset-0">
          <line
            x1={0}
            y1={LANE_H / 2}
            x2={width}
            y2={LANE_H / 2}
            stroke="currentColor"
            className="text-border"
            strokeWidth={1}
          />
          {polyline && (
            <polyline points={polyline} fill="none" stroke="rgb(251, 191, 36)" strokeWidth={1.5} />
          )}
        </svg>
        {points.map((p) => {
          const norm = active === 'pitch' ? (p.valor + 1) / 2 : p.valor
          const y = LANE_H - 4 - norm * (LANE_H - 8)
          return (
            <button
              key={p.id}
              type="button"
              className="absolute z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-amber ring-1 ring-background"
              style={{ left: p.tiempo * pxPerBeat, top: y }}
              title={`Tiempo ${p.tiempo.toFixed(2)} · valor ${p.valor.toFixed(2)}`}
              onPointerDown={(e) => {
                e.stopPropagation()
                const el = e.currentTarget.parentElement as HTMLDivElement
                const move = (ev: PointerEvent) => dragPoint(p.id, ev.clientY, el)
                const up = () => {
                  window.removeEventListener('pointermove', move)
                  window.removeEventListener('pointerup', up)
                }
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', up)
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
