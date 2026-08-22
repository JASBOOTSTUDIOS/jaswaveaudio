import { useMemo } from 'react'
import { createProjection, type TimelineProjection } from '@/lib/timeline-projection'
import { BASE_PIXELS_PER_BEAT } from '@/components/arrangement/constants'

/** Proyección musical beat ↔ pixel (fase B). */
export function useTimelineScale(opts: {
  zoom: number
  scrollX: number
  viewportWidth: number
  bpm: number
}): { projection: TimelineProjection; pixelsPerBeat: number } {
  const { zoom, scrollX, viewportWidth, bpm } = opts
  const pixelsPerBeat = BASE_PIXELS_PER_BEAT * zoom
  const projection = useMemo(
    () =>
      createProjection({
        pixelsPerBeat,
        viewportWidth,
        scrollX,
        bpm,
      }),
    [pixelsPerBeat, scrollX, viewportWidth, bpm],
  )
  return { projection, pixelsPerBeat }
}
