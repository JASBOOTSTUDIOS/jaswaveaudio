/** Mensajes MIDI 1.0 que el DAW usa (notas, CC, pitch, programa). */

export type MidiParsed =
  | { kind: 'noteOn'; channel: number; pitch: number; velocity: number }
  | { kind: 'noteOff'; channel: number; pitch: number; velocity: number }
  | { kind: 'cc'; channel: number; cc: number; value: number }
  | { kind: 'pitchBend'; channel: number; value: number }
  | { kind: 'program'; channel: number; program: number }
  | { kind: 'channelPressure'; channel: number; pressure: number }

export function parseMidiMessage(data: ArrayLike<number>, runningStatus = 0): {
  msg: MidiParsed | null
  runningStatus: number
} {
  if (!data || data.length === 0) return { msg: null, runningStatus }
  let i = 0
  let status = data[0]!
  if (status < 0x80) {
    if (runningStatus < 0x80) return { msg: null, runningStatus }
    status = runningStatus
  } else {
    i = 1
    runningStatus = status < 0xf0 ? status : 0
  }
  const hi = status & 0xf0
  const channel = status & 0x0f
  const a = data[i] ?? 0
  const b = data[i + 1] ?? 0

  if (hi === 0x90) {
    if (a > 127) return { msg: null, runningStatus }
    if (b === 0) return { msg: { kind: 'noteOff', channel, pitch: a, velocity: 0 }, runningStatus }
    return { msg: { kind: 'noteOn', channel, pitch: a, velocity: b }, runningStatus }
  }
  if (hi === 0x80) {
    return { msg: { kind: 'noteOff', channel, pitch: a & 0x7f, velocity: b & 0x7f }, runningStatus }
  }
  if (hi === 0xb0) {
    return { msg: { kind: 'cc', channel, cc: a & 0x7f, value: b & 0x7f }, runningStatus }
  }
  if (hi === 0xe0) {
    const raw = (a & 0x7f) | ((b & 0x7f) << 7)
    return { msg: { kind: 'pitchBend', channel, value: (raw - 8192) / 8192 }, runningStatus }
  }
  if (hi === 0xc0) {
    return { msg: { kind: 'program', channel, program: a & 0x7f }, runningStatus }
  }
  if (hi === 0xd0) {
    return { msg: { kind: 'channelPressure', channel, pressure: a & 0x7f }, runningStatus }
  }
  return { msg: null, runningStatus }
}

export function channelFilterAllows(filter: number | 'omni', channel: number): boolean {
  if (filter === 'omni') return true
  return filter === channel
}
