/**
 * Controladores MIDI: thru al instrumento de la pista + grabación en clips.
 * Solo ventana principal (un cliente Web MIDI).
 */

import { useEffect, useRef } from 'react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { audioEngine } from '@/lib/audio-engine'
import { isUndockWindow } from '@/lib/undock-window'
import { segundosABeats } from '@/lib/audio-conversions'
import { midiController, type MidiParsed } from '@/src/lib/midi-controller'
import {
  clipSpanBeats,
  createMidiRecorder,
  flushRecorder,
  recordedToClipNotes,
  recorderNoteOff,
  recorderNoteOn,
  type MidiRecorderState,
} from '@/src/lib/midi-note-recorder'
import { sendVstCc, getLoadedInstrumentForTrack } from '@/src/lib/plugin/track-vst-runtime'
import { routeMidiToTrack } from '@/src/lib/plugin/vst-voice-router'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'
import type { DAWState } from '../../shared/src/types/state'

function isMidiTrack(tipo: string | undefined): boolean {
  return tipo === 'midi' || tipo === 'instrumento'
}

function midiTargetIds(state: DAWState): string[] {
  const tracks = state.project?.tracks ?? []
  const armed = tracks.filter((t) => t.armada && isMidiTrack(t.tipo))
  if (armed.length) return armed.map((t) => t.id)
  const sel = getSelectedTrackId(state)
  const track = tracks.find((t) => t.id === sel)
  if (track && isMidiTrack(track.tipo)) return [track.id]
  return []
}

function playLive(trackIds: string[], selectedId: string | null, msg: MidiParsed): void {
  if (msg.kind !== 'noteOn' && msg.kind !== 'noteOff') {
    if (msg.kind === 'cc') {
      for (const id of trackIds) {
        const slot = getLoadedInstrumentForTrack(id)?.slotId
        if (slot) sendVstCc(slot, msg.cc, msg.value)
      }
    }
    return
  }
  const on = msg.kind === 'noteOn'
  const vel = on ? msg.velocity : 0
  let any = false
  for (const id of trackIds) {
    if (routeMidiToTrack(id, on, msg.pitch, vel)) any = true
  }
  if (any) return
  if (selectedId && trackIds.includes(selectedId)) {
    if (on) audioEngine.noteOn(msg.pitch, vel)
    else audioEngine.noteOff(msg.pitch)
  }
}

export function MidiControllerHost() {
  const tienda = useDAW()
  const recording = useDAWState((s) => s.transport?.grabacion === 'grabando')
  const playing = useDAWState((s) => Boolean(s.transport?.reproduciendo))
  const bpm = useDAWState((s) => s.project?.bpm?.valor ?? 120)
  const midiInPref = useDAWState((s) => s.project?.configuracion?.dispositivoMidiEntrada)

  const recRef = useRef<MidiRecorderState | null>(null)
  const recStartSecRef = useRef(0)
  const recStartPerfRef = useRef(0)
  const wasRecRef = useRef(false)
  const playingRef = useRef(playing)
  const bpmRef = useRef(bpm)
  const targetsRef = useRef<string[]>([])
  const selectedRef = useRef<string | null>(null)

  playingRef.current = playing
  bpmRef.current = bpm

  const selectedId = useDAWState((s) => getSelectedTrackId(s))
  selectedRef.current = selectedId
  const targetSig = useDAWState((s) => midiTargetIds(s).join(','))
  targetsRef.current = targetSig ? targetSig.split(',') : []

  useEffect(() => {
    if (isUndockWindow()) return
    void midiController.start()
    return () => midiController.stop()
  }, [])

  useEffect(() => {
    if (!midiInPref) return
    if (midiInPref === midiController.getSelectedId()) return
    midiController.setSelectedId(midiInPref)
  }, [midiInPref])

  useEffect(() => {
    if (isUndockWindow()) return
    return midiController.subscribeMessages((msg) => {
      const targets = targetsRef.current
      playLive(targets, selectedRef.current, msg)
      const rec = recRef.current
      if (!rec || (msg.kind !== 'noteOn' && msg.kind !== 'noteOff')) return
      const now = playingRef.current
        ? audioEngine.getTimelineSeconds()
        : recStartSecRef.current + (performance.now() - recStartPerfRef.current) / 1000
      recRef.current =
        msg.kind === 'noteOn'
          ? recorderNoteOn(rec, msg.pitch, msg.velocity, now, msg.channel)
          : recorderNoteOff(rec, msg.pitch, now, msg.channel)
    })
  }, [])

  useEffect(() => {
    if (isUndockWindow()) return
    if (recording && !wasRecRef.current) {
      wasRecRef.current = true
      const armedMidi = (tienda.obtenerEstado().project?.tracks ?? []).filter(
        (t) => t.armada && isMidiTrack(t.tipo),
      )
      if (armedMidi.length === 0) {
        recRef.current = null
        return
      }
      recStartSecRef.current = audioEngine.getTimelineSeconds()
      recStartPerfRef.current = performance.now()
      recRef.current = createMidiRecorder(recStartSecRef.current)
      if (!playingRef.current) {
        void tienda.executor.execute('transport.toggle', {})
      }
      return
    }
    if (!recording && wasRecRef.current) {
      wasRecRef.current = false
      const rec = recRef.current
      recRef.current = null
      if (!rec) return
      const endSec = playingRef.current
        ? audioEngine.getTimelineSeconds()
        : recStartSecRef.current + (performance.now() - recStartPerfRef.current) / 1000
      const raw = flushRecorder(rec, endSec)
      const grid = midiController.getQuantizeGridBeats()
      const drafts = recordedToClipNotes(raw, rec.startSec, bpmRef.current, grid)
      if (drafts.length === 0) return
      const span = clipSpanBeats(drafts, 1)
      const startBeats = segundosABeats(rec.startSec, bpmRef.current)
      const armed = (tienda.obtenerEstado().project?.tracks ?? []).filter(
        (t) => t.armada && isMidiTrack(t.tipo),
      )
      if (armed.length === 0) return
      void (async () => {
        for (const t of armed) {
          await tienda.executor.execute('midi.clip.create', {
            pistaId: t.id,
            nombre: 'Grabación MIDI',
            inicio: startBeats,
            duracion: span.duracion,
            notas: drafts,
          })
        }
      })()
    }
  }, [recording, tienda])

  return null
}
