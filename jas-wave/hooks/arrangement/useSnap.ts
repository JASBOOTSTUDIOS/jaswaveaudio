import { useCallback } from 'react'
import { snapBeatToDivision, snapDurationToDivision } from '../../../shared/src/midi/grid'
import { resolveSnapDivision } from '@/src/lib/timeline-snap'

/** Snap musical reutilizando shared/midi/grid (fase E). */
export function useSnap(snapEnabled: boolean, snapValor: number, beatsPerBar = 4) {
  const division = resolveSnapDivision(snapValor, beatsPerBar)
  const snapBeat = useCallback(
    (beat: number) => snapBeatToDivision(beat, division, snapEnabled && division > 0),
    [snapEnabled, division],
  )
  const snapDuration = useCallback(
    (dur: number) => snapDurationToDivision(dur, division, snapEnabled && division > 0),
    [snapEnabled, division],
  )
  return { snapBeat, snapDuration }
}