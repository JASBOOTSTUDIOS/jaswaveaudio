import { useCallback } from 'react'
import { snapBeatToDivision, snapDurationToDivision } from '../../../shared/src/midi/grid'

/** Snap musical reutilizando shared/midi/grid (fase E). */
export function useSnap(snapEnabled: boolean, snapValor: number) {
  const snapBeat = useCallback(
    (beat: number) => snapBeatToDivision(beat, snapValor, snapEnabled),
    [snapEnabled, snapValor],
  )
  const snapDuration = useCallback(
    (dur: number) => snapDurationToDivision(dur, snapValor, snapEnabled),
    [snapEnabled, snapValor],
  )
  return { snapBeat, snapDuration }
}
