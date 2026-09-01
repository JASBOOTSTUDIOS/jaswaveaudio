/** Acumula note on/off de un controlador y los convierte a notas de clip (beats). */

export type RecordedMidiNote = {
  pitch: number
  velocity: number
  startSec: number
  endSec: number
  channel: number
}

export type MidiClipNoteDraft = {
  pitch: number
  inicio: number
  duracion: number
  velocidad: number
  canal: number
  source: 'recorded'
}

type OpenVoice = { pitch: number; velocity: number; startSec: number; channel: number }

export type MidiRecorderState = {
  startSec: number
  open: Map<string, OpenVoice>
  closed: RecordedMidiNote[]
}

export function createMidiRecorder(startSec: number): MidiRecorderState {
  return { startSec, open: new Map(), closed: [] }
}

function voiceKey(channel: number, pitch: number): string {
  return `${channel}:${pitch}`
}

export function recorderNoteOn(
  state: MidiRecorderState,
  pitch: number,
  velocity: number,
  timeSec: number,
  channel = 0,
): MidiRecorderState {
  const key = voiceKey(channel, pitch)
  const nextOpen = new Map(state.open)
  const prev = nextOpen.get(key)
  const closed = prev
    ? state.closed.concat({
        pitch: prev.pitch,
        velocity: prev.velocity,
        startSec: prev.startSec,
        endSec: Math.max(prev.startSec + 0.02, timeSec),
        channel: prev.channel,
      })
    : state.closed
  nextOpen.set(key, { pitch, velocity, startSec: timeSec, channel })
  return { ...state, open: nextOpen, closed }
}

export function recorderNoteOff(
  state: MidiRecorderState,
  pitch: number,
  timeSec: number,
  channel = 0,
): MidiRecorderState {
  const key = voiceKey(channel, pitch)
  const prev = state.open.get(key)
  if (!prev) return state
  const nextOpen = new Map(state.open)
  nextOpen.delete(key)
  return {
    ...state,
    open: nextOpen,
    closed: state.closed.concat({
      pitch: prev.pitch,
      velocity: prev.velocity,
      startSec: prev.startSec,
      endSec: Math.max(prev.startSec + 0.02, timeSec),
      channel: prev.channel,
    }),
  }
}

export function flushRecorder(state: MidiRecorderState, endSec: number): RecordedMidiNote[] {
  const extra: RecordedMidiNote[] = []
  for (const prev of state.open.values()) {
    extra.push({
      pitch: prev.pitch,
      velocity: prev.velocity,
      startSec: prev.startSec,
      endSec: Math.max(prev.startSec + 0.02, endSec),
      channel: prev.channel,
    })
  }
  return state.closed.concat(extra)
}

export function quantizeBeat(beat: number, gridBeats: number): number {
  if (!Number.isFinite(gridBeats) || gridBeats <= 0) return beat
  return Math.round(beat / gridBeats) * gridBeats
}

export function recordedToClipNotes(
  notes: RecordedMidiNote[],
  clipStartSec: number,
  bpm: number,
  gridBeats = 0,
): MidiClipNoteDraft[] {
  const spb = 60 / Math.max(1, bpm)
  const out: MidiClipNoteDraft[] = []
  for (const n of notes) {
    const startBeat = Math.max(0, (n.startSec - clipStartSec) / spb)
    const endBeat = Math.max(startBeat + 0.0625, (n.endSec - clipStartSec) / spb)
    const inicio = quantizeBeat(startBeat, gridBeats)
    let fin = gridBeats > 0 ? Math.max(inicio + gridBeats, quantizeBeat(endBeat, gridBeats)) : endBeat
    if (fin <= inicio) fin = inicio + (gridBeats > 0 ? gridBeats : 0.0625)
    out.push({
      pitch: n.pitch,
      inicio,
      duracion: fin - inicio,
      velocidad: Math.max(1, Math.min(127, Math.round(n.velocity))),
      canal: n.channel,
      source: 'recorded',
    })
  }
  return out
}

export function clipSpanBeats(notes: MidiClipNoteDraft[], minBeats = 1): { inicio: number; duracion: number } {
  if (notes.length === 0) return { inicio: 0, duracion: minBeats }
  let max = 0
  for (const n of notes) max = Math.max(max, n.inicio + n.duracion)
  return { inicio: 0, duracion: Math.max(minBeats, max) }
}
