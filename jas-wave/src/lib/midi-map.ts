/**
 * MIDI Learn: disparador (nota / CC / tecla) → destino del DAW.
 * Independiente del thru al instrumento.
 */

import { ACTION_CATALOG } from '../../../shared/src/actions/catalog'
import type { ActionDefinition } from '../../../shared/src/actions/types'
import type { MidiParsed } from './midi-bytes'

export type MidiMapTrigger =
  | { kind: 'note'; channel: number | 'omni'; pitch: number }
  | { kind: 'cc'; channel: number | 'omni'; cc: number }
  | { kind: 'key'; chord: string }

export type MidiMapTarget = {
  id: string
  name: string
  group: string
  kind: 'action' | 'mixer' | 'midiFn' | 'pluginParam'
  hint?: string
  search: string
  actionId?: string
  mixer?: {
    trackIndex: number | 'master'
    field: 'volume' | 'pan' | 'mute' | 'solo' | 'arm'
  }
  midiFn?: { cc: number }
  pluginParam?: { slotId: string; parameterId: string }
}

export type MidiMapBinding = {
  targetId: string
  trigger: MidiMapTrigger
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export function noteDisplayName(pitch: number): string {
  const p = Math.max(0, Math.min(127, pitch | 0))
  return `${NOTE_NAMES[p % 12]!}${Math.floor(p / 12) - 1}`
}

export function formatMidiMapTrigger(t: MidiMapTrigger): string {
  if (t.kind === 'key') return t.chord
  const ch = t.channel === 'omni' ? 'omni' : `ch${t.channel + 1}`
  if (t.kind === 'note') return `Nota ${noteDisplayName(t.pitch)} (${ch})`
  return `CC${t.cc} (${ch})`
}

export function triggerFromMidi(msg: MidiParsed): MidiMapTrigger | null {
  if (msg.kind === 'noteOn' && msg.velocity > 0) {
    return { kind: 'note', channel: 'omni', pitch: msg.pitch }
  }
  if (msg.kind === 'cc') {
    return { kind: 'cc', channel: 'omni', cc: msg.cc }
  }
  return null
}

export function chordFromKeyboardEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let name = e.key
  if (name === ' ') name = 'Space'
  else if (name.length === 1) name = name.toUpperCase()
  parts.push(name)
  return parts.join('+')
}

export function triggersMatch(a: MidiMapTrigger, b: MidiMapTrigger): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'key' && b.kind === 'key') return a.chord === b.chord
  if (a.kind === 'note' && b.kind === 'note') {
    if (a.pitch !== b.pitch) return false
    if (a.channel === 'omni' || b.channel === 'omni') return true
    return a.channel === b.channel
  }
  if (a.kind === 'cc' && b.kind === 'cc') {
    if (a.cc !== b.cc) return false
    if (a.channel === 'omni' || b.channel === 'omni') return true
    return a.channel === b.channel
  }
  return false
}

export function midiMatchesBinding(msg: MidiParsed, trigger: MidiMapTrigger): boolean {
  if (trigger.kind === 'key') return false
  const chOk = trigger.channel === 'omni' || trigger.channel === msg.channel
  if (!chOk) return false
  if (trigger.kind === 'note') {
    return (msg.kind === 'noteOn' || msg.kind === 'noteOff') && msg.pitch === trigger.pitch
  }
  return msg.kind === 'cc' && msg.cc === trigger.cc
}

function blob(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ').toLowerCase()
}

export function buildMidiMapCatalog(
  trackCount: number,
  actions: readonly ActionDefinition[] = ACTION_CATALOG,
): MidiMapTarget[] {
  const fns: MidiMapTarget[] = [
    { id: 'midi.fn.modwheel', name: 'Rueda de modulación (CC1)', group: 'MIDI', kind: 'midiFn', midiFn: { cc: 1 }, search: blob('mod wheel cc1') },
    { id: 'midi.fn.volume', name: 'Volumen MIDI (CC7)', group: 'MIDI', kind: 'midiFn', midiFn: { cc: 7 }, search: blob('volumen midi cc7') },
    { id: 'midi.fn.pan', name: 'Paneo MIDI (CC10)', group: 'MIDI', kind: 'midiFn', midiFn: { cc: 10 }, search: blob('pan midi cc10') },
    { id: 'midi.fn.expression', name: 'Expresión (CC11)', group: 'MIDI', kind: 'midiFn', midiFn: { cc: 11 }, search: blob('expression cc11') },
    { id: 'midi.fn.sustain', name: 'Sustain / pedal (CC64)', group: 'MIDI', kind: 'midiFn', hint: 'Pedal de sustain del instrumento activo', midiFn: { cc: 64 }, search: blob('sustain pedal damper piano cc64 sostenuto') },
    { id: 'midi.fn.sostenuto', name: 'Sostenuto (CC66)', group: 'MIDI', kind: 'midiFn', midiFn: { cc: 66 }, search: blob('sostenuto cc66') },
    { id: 'midi.fn.soft', name: 'Pedal suave (CC67)', group: 'MIDI', kind: 'midiFn', midiFn: { cc: 67 }, search: blob('soft una corda cc67') },
  ]

  const n = Math.max(8, Math.min(32, trackCount | 0))
  const mixer: MidiMapTarget[] = [
    {
      id: 'mixer.master.volume',
      name: 'Master · Volumen',
      group: 'Mixer',
      kind: 'mixer',
      mixer: { trackIndex: 'master', field: 'volume' },
      search: blob('master volumen fader'),
    },
  ]
  const fields: Array<{ field: 'volume' | 'pan' | 'mute' | 'solo' | 'arm'; name: string; extra: string }> = [
    { field: 'volume', name: 'Volumen', extra: 'fader nivel' },
    { field: 'pan', name: 'Paneo', extra: 'pan knob' },
    { field: 'mute', name: 'Mute', extra: 'silencio' },
    { field: 'solo', name: 'Solo', extra: 'solo' },
    { field: 'arm', name: 'Armar grabación', extra: 'arm rec' },
  ]
  for (let i = 0; i < n; i++) {
    const label = `Pista ${i + 1}`
    for (const f of fields) {
      mixer.push({
        id: `mixer.track.${i}.${f.field}`,
        name: `${label} · ${f.name}`,
        group: 'Mixer',
        kind: 'mixer',
        mixer: { trackIndex: i, field: f.field },
        search: blob(label, f.name, f.extra, `track ${i + 1}`),
      })
    }
  }

  const cmds: MidiMapTarget[] = actions.map((a) => ({
    id: `action.${a.id}`,
    name: a.name,
    group: a.category,
    kind: 'action',
    hint: a.description,
    actionId: a.id,
    search: blob(a.id, a.name, a.description, ...(a.aliases ?? [])),
  }))

  return [...fns, ...mixer, ...cmds]
}

export function pluginParamTarget(
  slotId: string,
  pluginName: string,
  parameterId: string,
  paramName: string,
): MidiMapTarget {
  return {
    id: `plugin.param:${encodeURIComponent(slotId)}:${encodeURIComponent(parameterId)}`,
    name: `${pluginName} · ${paramName}`,
    group: 'Plugins',
    kind: 'pluginParam',
    pluginParam: { slotId, parameterId },
    search: blob(pluginName, paramName, slotId, parameterId, 'fx plugin'),
  }
}

export function looksLikeSmcMixer(name: string): boolean {
  return /smc[\s\-]*mix|m-?vave|m\s*wave/i.test(name)
}

/** Modo CC / User del M-VAVE SMC-MIXER: faders CC40–47, knobs CC30–37. */
export function smcMixerCcPreset(): MidiMapBinding[] {
  const out: MidiMapBinding[] = []
  for (let i = 0; i < 8; i++) {
    out.push({
      targetId: `mixer.track.${i}.volume`,
      trigger: { kind: 'cc', channel: 'omni', cc: 40 + i },
    })
    out.push({
      targetId: `mixer.track.${i}.pan`,
      trigger: { kind: 'cc', channel: 'omni', cc: 30 + i },
    })
  }
  return out
}

export function mergeSmcMixerPreset(existing: MidiMapBinding[]): MidiMapBinding[] {
  const preset = smcMixerCcPreset()
  const presetIds = new Set(preset.map((b) => b.targetId))
  const rest = existing.filter((b) => !presetIds.has(b.targetId))
  const withoutTriggers = rest.filter((b) => !preset.some((p) => triggersMatch(p.trigger, b.trigger)))
  return [...withoutTriggers, ...preset]
}

export function eatListsFromBindings(bindings: MidiMapBinding[]): { ccs: string; notes: string } {
  const ccs: number[] = []
  const notes: number[] = []
  for (const b of bindings) {
    if (b.trigger.kind === 'cc') ccs.push(b.trigger.cc)
    if (b.trigger.kind === 'note') notes.push(b.trigger.pitch)
  }
  const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b)
  return { ccs: uniq(ccs).join(','), notes: uniq(notes).join(',') }
}

export function midiValue01(msg: MidiParsed): number {
  if (msg.kind === 'cc') return msg.value / 127
  if (msg.kind === 'noteOn') return msg.velocity / 127
  return 0
}

export function midiIsPress(msg: MidiParsed): boolean {
  if (msg.kind === 'noteOn') return msg.velocity > 0
  if (msg.kind === 'cc') return msg.value >= 64
  return false
}

export function midiIsRelease(msg: MidiParsed): boolean {
  if (msg.kind === 'noteOff') return true
  if (msg.kind === 'cc') return msg.value < 64
  return false
}

export function upsertBinding(bindings: MidiMapBinding[], next: MidiMapBinding): MidiMapBinding[] {
  return [
    ...bindings.filter((b) => b.targetId !== next.targetId && !triggersMatch(b.trigger, next.trigger)),
    next,
  ]
}
