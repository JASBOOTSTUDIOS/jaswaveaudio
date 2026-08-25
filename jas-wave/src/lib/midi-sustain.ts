/**
 * Sustain (CC64) — Soft Pad Web Audio eliminado.
 * API conservada como no-op para callers legacy / tests.
 */

export type PadSustainState = {
  pedal: boolean
  down: Set<number>
  latched: Set<number>
}

export function createPadSustain(): PadSustainState {
  return { pedal: false, down: new Set(), latched: new Set() }
}

export function padNoteOn(state: PadSustainState, _pitch: number): PadSustainState {
  return state
}

export function padNoteOff(
  state: PadSustainState,
  _pitch: number,
): { next: PadSustainState; silence: boolean } {
  return { next: state, silence: true }
}

export function padPedal(
  state: PadSustainState,
  _value: number,
): { next: PadSustainState; release: number[] } {
  return { next: state, release: [] }
}
