/**
 * Fondo del piano roll (filas de pitch + líneas de rejilla). Memoizado: sus props sólo
 * cambian con zoom/duración/snap, no al arrastrar notas. Antes se recreaban cientos de
 * <div> de líneas (hasta 512 por nivel) en cada render del piano roll.
 */
import { memo } from 'react'
import { zoomLevelRank } from '@/components/arrangement/timeline-grid-math'

type GridLevel = { kind: string; spacingBeats: number }

type Props = {
  keys: number
  highest: number
  keyH: number
  gridWidth: number
  gridHeight: number
  pxPerBeat: number
  viewDurationBeats: number
  gridLines: GridLevel[]
  zoomPrimary: number
  isBlack: (pitch: number) => boolean
}

function PianoRollGridLayerImpl({
  keys,
  highest,
  keyH,
  gridWidth,
  gridHeight,
  pxPerBeat,
  viewDurationBeats,
  gridLines,
  zoomPrimary,
  isBlack,
}: Props) {
  return (
    <>
      {Array.from({ length: keys }).map((_, i) => {
        const pitch = highest - i
        return (
          <div
            key={pitch}
            className={`absolute left-0 right-0 border-b ${
              isBlack(pitch) ? 'border-border/30 bg-background/40' : 'border-border/20'
            }`}
            style={{ top: i * keyH, height: keyH, width: gridWidth }}
          />
        )
      })}

      {gridLines.map((line) => {
        const rank = zoomLevelRank(line.spacingBeats, zoomPrimary)
        const count = Math.ceil(viewDurationBeats / line.spacingBeats) + 1
        const className =
          rank === 0
            ? 'border-sky-300/80'
            : rank === 1
              ? 'border-sky-400/55'
              : rank === 2
                ? 'border-sky-500/35'
                : 'border-border/25'
        return Array.from({ length: count }).map((_, i) => {
          if (rank > 0) {
            const coarser = rank === 1 ? zoomPrimary : zoomPrimary / 2
            const beatsFromCoarser = (i * line.spacingBeats) % coarser
            if (Math.abs(beatsFromCoarser) < 1e-9) return null
          }
          return (
            <div
              key={`${line.kind}-${line.spacingBeats}-${i}`}
              className={`pointer-events-none absolute top-0 border-l ${className}`}
              style={{
                left: i * line.spacingBeats * pxPerBeat,
                height: gridHeight,
                borderLeftWidth: rank === 0 ? 2 : rank === 1 ? 1.5 : 1,
              }}
            />
          )
        })
      })}
    </>
  )
}

export const PianoRollGridLayer = memo(PianoRollGridLayerImpl)
