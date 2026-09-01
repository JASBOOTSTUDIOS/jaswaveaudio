/**
 * Controladores MIDI: thru al instrumento de la pista + grabación en clips.
 * Solo ventana principal (un cliente Web MIDI).
 *
 * Notas/CC del host nativo (WinMM) van al VST en el audio thread.
 * Aquí no se reenvían al VST (evitar duplicados y pérdidas).
 *
 * Thru y grabación van por pista: dispositivo asignado + monitor (IN) / armado.
 */

import { useEffect, useRef } from 'react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { audioEngine } from '@/lib/audio-engine'
import { isUndockWindow } from '@/lib/undock-window'
import { segundosABeats } from '@/lib/audio-conversions'
import { midiController, type MidiParsed, type MidiSource } from '@/src/lib/midi-controller'
import {
  clipSpanBeats,
  createMidiRecorder,
  flushRecorder,
  recordedToClipNotes,
  recorderNoteOff,
  recorderNoteOn,
  type MidiRecorderState,
} from '@/src/lib/midi-note-recorder'
import {
  sendVstCc,
  getLoadedInstrumentForTrack,
  subscribeVstRuntime,
} from '@/src/lib/plugin/track-vst-runtime'
import { midiMapStore } from '@/src/lib/midi-map-store'
import { buildMidiMapCatalog } from '@/src/lib/midi-map'
import {
  attachMidiMapHost,
  dispatchMidiMapMessage,
  installMidiMapKeyListener,
  setMidiMapTargetIndex,
} from '@/src/lib/midi-map-runtime'
import { routeMidiToTrack } from '@/src/lib/plugin/vst-voice-router'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'
import {
  assignedMidiDevice,
  isMidiLikeTrack,
  midiInputOf,
  midiLiveTargetIds,
  midiNativeLiveTargetIds,
  midiRecordTargetIds,
  toMidiRouteTrack,
  trackMatchesMidiDevice,
  type MidiRouteTrack,
} from '@/src/lib/midi-track-io'

function sendLiveMidiTargets(tracks: MidiRouteTrack[]): void {
  const ids = midiNativeLiveTargetIds(tracks)
  const slots: string[] = []
  const deviceIds: string[] = []
  for (const id of ids) {
    const slot = getLoadedInstrumentForTrack(id)?.slotId
    if (!slot) continue
    const t = tracks.find((x) => x.id === id)
    slots.push(slot)
    deviceIds.push(assignedMidiDevice(t ?? { id }))
  }
  const ch = midiController.getChannel()
  const eat = midiMapStore.eatCsv()
  const cmd = {
    type: 'setLiveMidiTargets' as const,
    slotIds: slots.join(','),
    deviceIds: deviceIds.join(','),
    channel: ch === 'omni' ? -1 : ch,
    eatCcs: eat.ccs,
    eatNotes: eat.notes,
  }
  try {
    const api = window.electron
    if (typeof api?.pluginHostMidi === 'function') {
      api.pluginHostMidi(cmd)
      return
    }
    void api?.pluginHostSend?.(cmd)
  } catch {
    /* ignore */
  }
}

function trackUsesNativeLiveMidi(trackId: string, deviceId: string, tracks: MidiRouteTrack[]): boolean {
  const t = tracks.find((x) => x.id === trackId)
  if (!t) return false
  return (
    Boolean(t.configuracion?.monitorizarEntrada) &&
    assignedMidiDevice(t).length > 0 &&
    trackMatchesMidiDevice(t, deviceId)
  )
}

function playLive(
  trackIds: string[],
  _selectedId: string | null,
  msg: MidiParsed,
  source?: MidiSource,
  deviceId?: string,
  tracks?: MidiRouteTrack[],
): void {
  if (trackIds.length === 0) return
  const list = tracks ?? []
  const dev = deviceId ?? ''
  if (msg.kind === 'cc') {
    if (source !== 'native') {
      for (const id of trackIds) {
        const slot = getLoadedInstrumentForTrack(id)?.slotId
        if (slot) sendVstCc(slot, msg.cc, msg.value)
      }
    }
    return
  }
  if (msg.kind !== 'noteOn' && msg.kind !== 'noteOff') return
  const on = msg.kind === 'noteOn'
  const vel = on ? msg.velocity : 0
  for (const id of trackIds) {
    if (source === 'native' && trackUsesNativeLiveMidi(id, dev, list)) continue
    routeMidiToTrack(id, on, msg.pitch, vel)
  }
}

export function MidiControllerHost() {
  const tienda = useDAW()
  const recording = useDAWState((s) => s.transport?.grabacion === 'grabando')
  const playing = useDAWState((s) => Boolean(s.transport?.reproduciendo))
  const bpm = useDAWState((s) => s.project?.bpm?.valor ?? 120)
  const midiInPref = useDAWState((s) => s.project?.configuracion?.dispositivoMidiEntrada)
  const tracks = useDAWState((s) => s.project?.tracks ?? [])
  const routeSig = useDAWState((s) =>
    (s.project?.tracks ?? [])
      .map(
        (t) =>
          `${t.id}:${t.tipo}:${t.armada ? 1 : 0}:${midiInputOf(t)}:${t.configuracion?.monitorizarEntrada ? 1 : 0}`,
      )
      .join('|'),
  )

  const recMapRef = useRef<Map<string, MidiRecorderState>>(new Map())
  const recStartSecRef = useRef(0)
  const recStartPerfRef = useRef(0)
  const wasRecRef = useRef(false)
  const punchWindowRef = useRef<{ startSec: number; endSec: number } | null>(null)
  const playingRef = useRef(playing)
  const bpmRef = useRef(bpm)
  const tracksRef = useRef<MidiRouteTrack[]>(tracks)
  const selectedRef = useRef<string | null>(null)

  playingRef.current = playing
  bpmRef.current = bpm
  tracksRef.current = tracks.map(toMidiRouteTrack)

  const selectedId = useDAWState((s) => getSelectedTrackId(s))
  selectedRef.current = selectedId

  useEffect(() => {
    attachMidiMapHost({
      executeCommand: (type, payload) => {
        void tienda.executor.execute(type, payload)
      },
      getTracks: () => tienda.obtenerEstado().project?.tracks ?? [],
      getLiveTrackIds: () => midiNativeLiveTargetIds(tracksRef.current),
    })
    const stopKeys = installMidiMapKeyListener()
    return () => {
      stopKeys()
      attachMidiMapHost(null)
    }
  }, [tienda])

  const trackCount = useDAWState((s) => s.project?.tracks?.length ?? 0)
  useEffect(() => {
    setMidiMapTargetIndex(buildMidiMapCatalog(Math.max(trackCount, 8)))
  }, [trackCount])

  useEffect(() => {
    const push = () => sendLiveMidiTargets(tracksRef.current)
    push()
    const unsubRt = subscribeVstRuntime(push)
    const unsubDev = midiController.subscribeDevices(push)
    const unsubMap = midiMapStore.subscribe(push)
    const offRestart = window.electron?.onPluginHostRestarted?.(push)
    return () => {
      unsubRt()
      unsubDev()
      unsubMap()
      offRestart?.()
    }
  }, [routeSig])

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
    return midiController.subscribeMessages((msg, _t, source, deviceId) => {
      const list = tracksRef.current
      const id = deviceId ?? ''
      if (dispatchMidiMapMessage(msg)) return
      playLive(midiLiveTargetIds(list, id), selectedRef.current, msg, source, id, list)
      if (recMapRef.current.size === 0) return
      if (msg.kind !== 'noteOn' && msg.kind !== 'noteOff') return
      const recIds = midiRecordTargetIds(list, id)
      if (recIds.length === 0) return
      const now = playingRef.current
        ? audioEngine.getTimelineSeconds()
        : recStartSecRef.current + (performance.now() - recStartPerfRef.current) / 1000
      for (const trackId of recIds) {
        const rec = recMapRef.current.get(trackId)
        if (!rec) continue
        recMapRef.current.set(
          trackId,
          msg.kind === 'noteOn'
            ? recorderNoteOn(rec, msg.pitch, msg.velocity, now, msg.channel)
            : recorderNoteOff(rec, msg.pitch, now, msg.channel),
        )
      }
    })
  }, [])

  useEffect(() => {
    if (isUndockWindow()) return
    if (recording && !wasRecRef.current) {
      wasRecRef.current = true
      const st = tienda.obtenerEstado()
      const armedMidi = (st.project?.tracks ?? []).filter(
        (t) => t.armada && isMidiLikeTrack(t.tipo) && assignedMidiDevice(t).length > 0,
      )
      recMapRef.current = new Map()
      if (armedMidi.length === 0) return
      const transport = st.transport
      const useCountIn = Boolean(transport.countIn?.activo)
      const bars = Math.max(1, transport.countIn?.compases ?? 1)
      const beatsPerBar = st.project?.timeSignature?.numerador ?? 4
      const bpm = bpmRef.current || 120
      const delayMs = useCountIn ? bars * beatsPerBar * (60000 / bpm) : 0
      const punchOn = Boolean(transport.punch?.activo)
      const punchStartSec = transport.punch?.inicio?.segundos ?? 0
      const punchEndSec = transport.punch?.fin?.segundos ?? 0
      const startRec = () => {
        if (!wasRecRef.current) return
        const startSec =
          punchOn && punchEndSec > punchStartSec
            ? punchStartSec
            : audioEngine.getTimelineSeconds()
        recStartSecRef.current = startSec
        recStartPerfRef.current = performance.now()
        punchWindowRef.current =
          punchOn && punchEndSec > punchStartSec
            ? { startSec: punchStartSec, endSec: punchEndSec }
            : null
        for (const t of armedMidi) {
          recMapRef.current.set(t.id, createMidiRecorder(startSec))
        }
      }
      if (delayMs > 0) {
        if (useCountIn && !transport.metronomo?.activo) {
          void tienda.executor.execute('transport.toggleMetronome', {})
        }
        window.setTimeout(startRec, delayMs)
      } else {
        startRec()
      }
      return
    }
    if (!recording && wasRecRef.current) {
      wasRecRef.current = false
      const recs = recMapRef.current
      recMapRef.current = new Map()
      punchWindowRef.current = null
      if (recs.size === 0) return
      const endSec = playingRef.current
        ? audioEngine.getTimelineSeconds()
        : recStartSecRef.current + (performance.now() - recStartPerfRef.current) / 1000
      const grid = midiController.getQuantizeGridBeats()
      void (async () => {
        for (const [trackId, rec] of recs) {
          let raw = flushRecorder(rec, endSec)
          const win = punchWindowRef.current
          if (win) {
            raw = raw
              .map((n) => ({
                ...n,
                startSec: Math.max(n.startSec, win.startSec),
                endSec: Math.min(n.endSec, win.endSec),
              }))
              .filter((n) => n.endSec > n.startSec + 0.01)
          }
          const drafts = recordedToClipNotes(raw, rec.startSec, bpmRef.current, grid)
          if (drafts.length === 0) continue
          const span = clipSpanBeats(drafts, 1)
          const startBeats = segundosABeats(rec.startSec, bpmRef.current)
          await tienda.executor.execute('midi.clip.create', {
            pistaId: trackId,
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
