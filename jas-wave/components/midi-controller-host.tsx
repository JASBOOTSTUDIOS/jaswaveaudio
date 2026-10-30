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
import { AgregadorPedales, unificarPedal } from '@/src/lib/midi-pedal'
import {
  ccGrabadosALanes,
  ccRecorderOn,
  createCcRecorder,
  esCcGrabable,
  type CcRecorderState,
} from '@/src/lib/midi-cc-recorder'
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
  getLoadedInstrumentsForTrack,
  subscribeVstRuntime,
} from '@/src/lib/plugin/track-vst-runtime'
import { buildLiveMidiTargets, firmaZonas } from '@/src/lib/midi-zones'
import { EVENTO_PANIC, enviarSeguridadMaster } from '@/src/lib/modo-directo'
import type { ZonaMidi } from '../../shared/src/types/directo'
import { midiMapStore } from '@/src/lib/midi-map-store'
import { buildMidiMapCatalog } from '@/src/lib/midi-map'
import {
  attachMidiMapHost,
  dispatchMidiMapMessage,
  installMidiMapKeyListener,
  setMidiMapTargetIndex,
} from '@/src/lib/midi-map-runtime'
import { routeMidiToTrack, setLiveMidiZones } from '@/src/lib/plugin/vst-voice-router'
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

/**
 * Destinos en vivo del host: TODAS las capas (instrumentos cargados) de cada pista monitorizada, una entrada
 * por zona MIDI activa (K3). `slotIds`/`deviceIds` se mandan además por compatibilidad con hosts anteriores
 * (van antes de `targets`: el host lee los campos globales de la cabecera).
 */
function sendLiveMidiTargets(tracks: MidiRouteTrack[], zonas: readonly ZonaMidi[] | undefined): void {
  const ids = midiNativeLiveTargetIds(tracks)
  const pistas: Array<{ id: string; deviceId: string; slotIds: string[] }> = []
  for (const id of ids) {
    const capas = getLoadedInstrumentsForTrack(id).map((p) => p.slotId)
    const principal = getLoadedInstrumentForTrack(id)?.slotId
    if (principal && !capas.includes(principal)) capas.unshift(principal)
    if (capas.length === 0) continue
    const t = tracks.find((x) => x.id === id)
    pistas.push({ id, deviceId: assignedMidiDevice(t ?? { id }), slotIds: capas })
  }
  const { targets } = buildLiveMidiTargets(pistas, zonas)
  const ch = midiController.getChannel()
  const eat = midiMapStore.eatCsv()
  const cmd = {
    type: 'setLiveMidiTargets' as const,
    slotIds: pistas.map((p) => p.slotIds[0]).join(','),
    deviceIds: pistas.map((p) => p.deviceId).join(','),
    channel: ch === 'omni' ? -1 : ch,
    eatCcs: eat.ccs,
    eatNotes: eat.notes,
    targets,
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
  const zonas = useDAWState((s) => s.project?.directo?.zonas)
  const zonasSig = firmaZonas(zonas)
  const seguridad = useDAWState((s) => s.project?.directo?.seguridad)
  const seguridadSig = `${seguridad?.activa ? 1 : 0}:${seguridad?.techoDb ?? -0.5}`
  const routeSig = useDAWState((s) =>
    (s.project?.tracks ?? [])
      .map(
        (t) =>
          `${t.id}:${t.tipo}:${t.armada ? 1 : 0}:${midiInputOf(t)}:${t.configuracion?.monitorizarEntrada ? 1 : 0}`,
      )
      .join('|'),
  )

  const recMapRef = useRef<Map<string, MidiRecorderState>>(new Map())
  // CC de pedal / expresión de la toma, por pista armada (van a `clip.expression.cc`, no solo al VST en vivo).
  const ccRecMapRef = useRef<Map<string, CcRecorderState>>(new Map())
  // Último valor de CC1/CC11 visto (los pedales salen de pedalesRef): estado inicial de la toma.
  const ccUltimoRef = useRef<Map<number, number>>(new Map())
  const recStartSecRef = useRef(0)
  const recStartPerfRef = useRef(0)
  const wasRecRef = useRef(false)
  const punchWindowRef = useRef<{ startSec: number; endSec: number } | null>(null)
  const playingRef = useRef(playing)
  const bpmRef = useRef(bpm)
  const tracksRef = useRef<MidiRouteTrack[]>(tracks)
  const zonasRef = useRef<readonly ZonaMidi[] | undefined>(zonas)
  const seguridadRef = useRef(seguridad)
  const selectedRef = useRef<string | null>(null)
  // Pedales (CC64/66/67/69) unificados por canal: el PSR-E373 manda «pisado» por dos canales y «suelto» por un
  // tercero en el mismo instante; sin esto el último mensaje anulaba la pisada y el sustain nunca se aplicaba.
  const pedalesRef = useRef(new AgregadorPedales())

  playingRef.current = playing
  bpmRef.current = bpm
  tracksRef.current = tracks.map(toMidiRouteTrack)
  zonasRef.current = zonas
  seguridadRef.current = seguridad

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
    const push = () => {
      setLiveMidiZones(zonasRef.current)
      sendLiveMidiTargets(tracksRef.current, zonasRef.current)
    }
    push()
    const unsubRt = subscribeVstRuntime(push)
    const unsubDev = midiController.subscribeDevices(push)
    const unsubMap = midiMapStore.subscribe(push)
    const offRestart = window.electron?.onPluginHostRestarted?.(() => {
      pedalesRef.current.reiniciar()
      push()
      enviarSeguridadMaster(seguridadRef.current)
    })
    const onPanic = () => pedalesRef.current.reiniciar()
    window.addEventListener(EVENTO_PANIC, onPanic)
    return () => {
      unsubRt()
      unsubDev()
      unsubMap()
      offRestart?.()
      window.removeEventListener(EVENTO_PANIC, onPanic)
    }
  }, [routeSig, zonasSig])

  // Seguridad del máster (limitador true-peak) del proyecto → host.
  useEffect(() => {
    if (isUndockWindow()) return
    enviarSeguridadMaster(seguridadRef.current)
  }, [seguridadSig])

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
    return midiController.subscribeMessages((crudo, tEvento, source, deviceId) => {
      const list = tracksRef.current
      const id = deviceId ?? ''
      const msg = unificarPedal(pedalesRef.current, crudo)
      if (!msg) return
      if (dispatchMidiMapMessage(msg)) return
      playLive(midiLiveTargetIds(list, id), selectedRef.current, msg, source, id, list)
      if (msg.kind === 'cc' && esCcGrabable(msg.cc)) ccUltimoRef.current.set(msg.cc, msg.value)
      if (recMapRef.current.size === 0) return
      if (msg.kind !== 'noteOn' && msg.kind !== 'noteOff' && !(msg.kind === 'cc' && esCcGrabable(msg.cc))) return
      const recIds = midiRecordTargetIds(list, id)
      if (recIds.length === 0) return
      // El evento se tocó `retraso` s antes de llegar aquí (sello del host / Web MIDI): se graba en su sitio.
      const retraso = Math.min(0.5, Math.max(0, performance.now() / 1000 - tEvento))
      const now =
        (playingRef.current
          ? audioEngine.getTimelineSeconds()
          : recStartSecRef.current + (performance.now() - recStartPerfRef.current) / 1000) - retraso
      if (msg.kind === 'cc') {
        for (const trackId of recIds) {
          const cr = ccRecMapRef.current.get(trackId)
          if (cr) ccRecMapRef.current.set(trackId, ccRecorderOn(cr, msg.cc, msg.value, now))
        }
        return
      }
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
      ccRecMapRef.current = new Map()
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
        // Estado de los CC al empezar (p. ej. pedal ya pisado): punto inicial del lane.
        const inicial = new Map<number, number>()
        for (const cc of [64, 66, 67, 69]) {
          const v = pedalesRef.current.valor(cc)
          if (v > 0) inicial.set(cc, v)
        }
        for (const cc of [1, 11]) {
          const v = ccUltimoRef.current.get(cc)
          if (v !== undefined && v > 0) inicial.set(cc, v)
        }
        for (const t of armedMidi) {
          recMapRef.current.set(t.id, createMidiRecorder(startSec))
          ccRecMapRef.current.set(t.id, createCcRecorder(startSec, inicial))
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
      const ccRecs = ccRecMapRef.current
      recMapRef.current = new Map()
      ccRecMapRef.current = new Map()
      // La ventana de punch se lee ANTES de limpiarla (antes se borraba y el recorte nunca se aplicaba).
      const win = punchWindowRef.current
      punchWindowRef.current = null
      if (recs.size === 0) return
      const endSec = playingRef.current
        ? audioEngine.getTimelineSeconds()
        : recStartSecRef.current + (performance.now() - recStartPerfRef.current) / 1000
      const grid = midiController.getQuantizeGridBeats()
      void (async () => {
        for (const [trackId, rec] of recs) {
          let raw = flushRecorder(rec, endSec)
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
          const finToma = win ? Math.min(endSec, win.endSec) : endSec
          const cr = ccRecs.get(trackId)
          const lanes = cr
            ? ccGrabadosALanes(cr, {
                clipStartSec: rec.startSec,
                bpm: bpmRef.current,
                endSec,
                // El pedal puede seguir sonando tras la última nota: el clip se alarga hasta su última marca.
                duracionBeats: Math.max(span.duracion, (finToma - rec.startSec) / (60 / Math.max(1, bpmRef.current))),
                punch: win,
              })
            : []
          const duracionClip = lanes.reduce(
            (m, l) => Math.max(m, ...l.puntos.map((p) => p.tiempo)),
            span.duracion,
          )
          await tienda.executor.execute('midi.clip.create', {
            pistaId: trackId,
            nombre: 'Grabación MIDI',
            inicio: startBeats,
            duracion: duracionClip,
            notas: drafts,
            ...(lanes.length > 0 ? { expression: { cc: lanes, pitchBend: [], channelPressure: [] } } : {}),
          })
        }
      })()
    }
  }, [recording, tienda])

  return null
}
