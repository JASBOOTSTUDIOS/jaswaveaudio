/**
 * Vista de partitura compartida (editor + vista previa) — compases VexFlow en tarjeta blanca.
 */

import { useEffect, useMemo, useRef, type ReactNode, Fragment } from 'react'
import type { MidiNote } from '@jaswave/shared'
import {
  computeScoreBarCount,
  renderScoreBarToContainer,
  SHEET_BAR_SLOT_WIDTH,
  SHEET_BAR_SLOT_HEIGHT,
} from '@/src/lib/midi-score-render'
import { ensureVexFlowFonts } from '@/src/lib/vexflow-ready'

export const SCORE_BAR_HEIGHT = SHEET_BAR_SLOT_HEIGHT

type ScoreBarViewProps = {
  barIndex: number
  notes: MidiNote[]
  drums: boolean
  showClef?: boolean
  selectedIds?: Set<string>
  className?: string
}

/** Un compás renderizado con VexFlow (solo lectura). */
export function ScoreBarView({
  barIndex,
  notes,
  drums,
  showClef = barIndex === 0,
  selectedIds,
  className = '',
}: ScoreBarViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let cancelled = false
    void ensureVexFlowFonts().then(() => {
      if (cancelled) return
      return renderScoreBarToContainer(el, barIndex, notes, drums, {
        showClef,
        selectedIds,
      })
    })
    return () => {
      cancelled = true
    }
  }, [barIndex, notes, drums, showClef, selectedIds])

  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={{ width: SHEET_BAR_SLOT_WIDTH, height: SCORE_BAR_HEIGHT }}
    >
      <div ref={hostRef} className="pointer-events-none h-full w-full" />
    </div>
  )
}

type ScoreSheetCanvasProps = {
  notes: MidiNote[]
  drums: boolean
  barCount?: number
  selectedIds?: Set<string>
  renderBar?: (barIndex: number) => ReactNode
}

/** Área beige + tarjeta blanca con compases (mismo layout que el editor). */
export function ScoreSheetCanvas({
  notes,
  drums,
  barCount: barCountProp,
  selectedIds,
  renderBar,
}: ScoreSheetCanvasProps) {
  const barCount = useMemo(
    () => barCountProp ?? Math.max(1, computeScoreBarCount(notes)),
    [barCountProp, notes],
  )

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[#f4f2ee] p-4">
      <div className="mx-auto w-fit rounded-lg bg-white p-4 shadow-md ring-1 ring-black/5">
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: barCount }, (_, barIndex) =>
            renderBar ? (
              <Fragment key={barIndex}>{renderBar(barIndex)}</Fragment>
            ) : (
              <ScoreBarView
                key={barIndex}
                barIndex={barIndex}
                notes={notes}
                drums={drums}
                selectedIds={selectedIds}
              />
            ),
          )}
        </div>
      </div>
    </div>
  )
}
