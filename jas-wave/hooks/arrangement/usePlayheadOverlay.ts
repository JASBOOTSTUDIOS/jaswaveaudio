import { useMemo } from 'react'

/** Posición de playhead en píxeles de contenido (fase G). */
export function usePlayheadOverlay(transportSeconds: number, bpm: number, beatToPixel: (b: number) => number) {
  return useMemo(() => {
    const beat = Math.max(0, (transportSeconds * bpm) / 60)
    return { playheadBeat: beat, playheadLeft: beatToPixel(beat) }
  }, [transportSeconds, bpm, beatToPixel])
}
