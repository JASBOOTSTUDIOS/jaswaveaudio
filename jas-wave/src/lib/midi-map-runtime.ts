/**
 * Aplica bindings MIDI Learn: comandos, mixer, CC al instrumento, params VST.
 */

import type { MidiParsed } from './midi-bytes'
import {
  chordFromKeyboardEvent,
  midiIsPress,
  midiIsRelease,
  midiMatchesBinding,
  midiValue01,
  triggerFromMidi,
  type MidiMapBinding,
  type MidiMapTarget,
} from './midi-map'
import { midiMapStore } from './midi-map-store'
import { getActionSystemFromWindow } from '@/hooks/use-shortcut-dispatcher'
import { shouldIgnoreGlobalShortcuts } from '../../../shared/src'
import {
  sendVstCc,
  getLoadedInstrumentForTrack,
  setSlotParameter,
} from '@/src/lib/plugin/track-vst-runtime'

export type MidiMapRuntimeHost = {
  executeCommand: (type: string, payload: unknown) => void
  getTracks: () => Array<{ id: string }>
  getLiveTrackIds: () => string[]
}

let host: MidiMapRuntimeHost | null = null
let targetsById = new Map<string, MidiMapTarget>()
const lastToggleAt = new Map<string, number>()

export function attachMidiMapHost(next: MidiMapRuntimeHost | null): void {
  host = next
}

export function setMidiMapTargetIndex(targets: MidiMapTarget[]): void {
  targetsById = new Map(targets.map((t) => [t.id, t]))
}

function sendLiveCc(cc: number, value: number): void {
  const ids = host?.getLiveTrackIds() ?? []
  for (const id of ids) {
    const slot = getLoadedInstrumentForTrack(id)?.slotId
    if (slot) sendVstCc(slot, cc, value)
  }
}

function risingToggle(targetId: string): boolean {
  const now = performance.now()
  const prev = lastToggleAt.get(targetId) ?? 0
  if (now - prev < 80) return false
  lastToggleAt.set(targetId, now)
  return true
}

function applyMixer(target: MidiMapTarget, msg: MidiParsed): void {
  if (!host || !target.mixer) return
  const tracks = host.getTracks()
  const { trackIndex, field } = target.mixer
  if (trackIndex === 'master') {
    if (field !== 'volume') return
    host.executeCommand('master.update', { datos: { volumen: midiValue01(msg) } })
    return
  }
  const track = tracks[trackIndex]
  if (!track) return
  if (field === 'volume') {
    host.executeCommand('track.update', { trackId: track.id, datos: { volumen: midiValue01(msg) } })
    return
  }
  if (field === 'pan') {
    host.executeCommand('track.update', {
      trackId: track.id,
      datos: { paneo: midiValue01(msg) * 2 - 1 },
    })
    return
  }
  if (!midiIsPress(msg) || !risingToggle(target.id)) return
  if (field === 'mute') host.executeCommand('track.toggleMute', { trackId: track.id })
  if (field === 'solo') host.executeCommand('track.toggleSolo', { trackId: track.id })
  if (field === 'arm') host.executeCommand('track.toggleArm', { trackId: track.id })
}

function applyBinding(binding: MidiMapBinding, msg: MidiParsed): void {
  const target = targetsById.get(binding.targetId)
  if (!target) return
  if (target.kind === 'action' && target.actionId) {
    if (!midiIsPress(msg)) return
    getActionSystemFromWindow()?.actions.execute(target.actionId)
    return
  }
  if (target.kind === 'mixer') {
    applyMixer(target, msg)
    return
  }
  if (target.kind === 'midiFn' && target.midiFn) {
    const cc = target.midiFn.cc
    if (msg.kind === 'cc') sendLiveCc(cc, msg.value)
    else if (midiIsPress(msg)) sendLiveCc(cc, 127)
    else if (midiIsRelease(msg)) sendLiveCc(cc, 0)
    return
  }
  if (target.kind === 'pluginParam' && target.pluginParam) {
    void setSlotParameter(target.pluginParam.slotId, target.pluginParam.parameterId, midiValue01(msg))
  }
}

/** true = consumido (no thru al instrumento / no grabar). */
export function dispatchMidiMapMessage(msg: MidiParsed): boolean {
  const learned = triggerFromMidi(msg)
  if (learned && midiMapStore.captureIfLearning(learned)) return true

  let consumed = false
  for (const b of midiMapStore.getBindings()) {
    if (!midiMatchesBinding(msg, b.trigger)) continue
    applyBinding(b, msg)
    consumed = true
  }
  return consumed
}

export function dispatchMidiMapKey(e: KeyboardEvent): boolean {
  if (shouldIgnoreGlobalShortcuts(e.target)) return false
  if (e.repeat) return false
  const chord = chordFromKeyboardEvent(e)
  if (!chord) return false
  const learning = midiMapStore.getLearnTargetId()
  if (learning) {
    if (e.key === 'Escape') {
      midiMapStore.cancelLearn()
      e.preventDefault()
      return true
    }
    midiMapStore.assign(learning, { kind: 'key', chord })
    e.preventDefault()
    e.stopPropagation()
    return true
  }
  const hit = midiMapStore.getBindings().find((b) => b.trigger.kind === 'key' && b.trigger.chord === chord)
  if (!hit) return false
  e.preventDefault()
  e.stopPropagation()
  applyBinding(hit, { kind: 'noteOn', channel: 0, pitch: 60, velocity: 127 })
  return true
}

export function installMidiMapKeyListener(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (shouldIgnoreGlobalShortcuts(e.target) && !midiMapStore.getLearnTargetId()) return
    dispatchMidiMapKey(e)
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}
