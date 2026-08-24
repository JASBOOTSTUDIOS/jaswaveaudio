/** Sustain (CC64) para el Soft Pad: las notas sueltas se mantienen hasta soltar el pedal. */

export type PadSustainState = {
  pedal: boolean
  down: Set<number>
  latched: Set<number>
}

export function createPadSustain(): PadSustainState {
  return { pedal: false, down: new Set(), latched: new Set() }
}

export function padNoteOn(state: PadSustainState, pitch: number): PadSustainState {
  const down = new Set(state.down)
  const latched = new Set(state.latched)
  down.add(pitch)
  latched.delete(pitch)
  return { pedal: state.pedal, down, latched }
}

export function padNoteOff(
  state: PadSustainState,
  pitch: number,
): { next: PadSustainState; silence: boolean } {
  const down = new Set(state.down)
  down.delete(pitch)
  if (state.pedal) {
    const latched = new Set(state.latched)
    latched.add(pitch)
    return { next: { pedal: true, down, latched }, silence: false }
  }
  return { next: { pedal: false, down, latched: state.latched }, silence: true }
}

export function padPedal(
  state: PadSustainState,
  value: number,
): { next: PadSustainState; release: number[] } {
  const pedal = value >= 64
  if (pedal === state.pedal) return { next: state, release: [] }
  if (pedal) return { next: { ...state, pedal: true }, release: [] }
  const release: number[] = []
  for (const p of state.latched) {
    if (!state.down.has(p)) release.push(p)
  }
  return { next: { pedal: false, down: state.down, latched: new Set() }, release }
}
