/**
 * Audición MIDI en chat/preview vía Plugin Host (motor de audio JasWave).
 * Carga un instrumento temporal en el host si hace falta; Web Audio solo como fallback.
 */

import { audioEngine } from '@/lib/audio-engine'
import { beatsASegundos } from '@/lib/audio-conversions'
import { descriptorToPluginInfo } from '@/src/lib/plugin/plugin-info-adapter'
import { pluginRegistry } from '@/src/lib/plugin/registry'
import {
  applyJasWaveRolesParameter,
  findJasWaveRolesDescriptor,
  isJasWaveRolesDescriptor,
} from '@/src/lib/plugin/jaswave-roles'
import { findJasWavePianoDescriptor } from '@/src/lib/plugin/jaswave-piano'
import {
  ensureHostMidiAudible,
  ensureTrackVstPlugin,
  getLoadedInstrumentForTrack,
} from '@/src/lib/plugin/track-vst-runtime'
import {
  routeMidiToTrack,
  setPreferredVstPreviewTrack,
  setTrackChannelAudible,
} from '@/src/lib/plugin/vst-voice-router'
import type { InstrumentRole } from '@/src/lib/plugin-knowledge'

export type PreviewMidiNote = {
  pitch: number
  inicio: number
  duracion: number
  velocidad: number
}

type AuditionHandle = { stop: () => void }

const PREVIEW_TRACK_ID = '__chat_midi_preview__'

let active: AuditionHandle | null = null
let sharedCtx: AudioContext | null = null

function getPreviewAudioContext(): AudioContext {
  if (sharedCtx && sharedCtx.state !== 'closed') return sharedCtx
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  sharedCtx = new Ctor()
  return sharedCtx
}

export function stopMidiPreviewAudition(): void {
  active?.stop()
  active = null
  try {
    audioEngine.stopAllSources()
  } catch {
    /* ignore */
  }
}

function findAudibleTrackId(
  preferred?: string | null,
  candidateTrackIds?: string[],
): string | null {
  if (preferred && getLoadedInstrumentForTrack(preferred)?.slotId) return preferred
  for (const id of candidateTrackIds ?? []) {
    if (getLoadedInstrumentForTrack(id)?.slotId) return id
  }
  return null
}

function resolvePreviewDescriptor(opts: {
  pluginId?: string | null
  pluginNombre?: string | null
  rol?: string | null
}) {
  if (opts.pluginId) {
    const byId = pluginRegistry.findById(opts.pluginId)
    if (byId) return byId
  }
  if (opts.pluginNombre) {
    const byName = pluginRegistry.findByName(opts.pluginNombre)[0]
    if (byName) return byName
  }
  const rol = String(opts.rol ?? 'keys').toLowerCase()
  if (rol === 'piano' || rol === 'keys') {
    const piano = findJasWavePianoDescriptor()
    if (piano) return piano
  }
  const roles = findJasWaveRolesDescriptor()
  if (roles) return roles
  return pluginRegistry.findInstruments()[0] ?? null
}

/** Carga (o reutiliza) un VST en el slot de preview del host. */
async function ensurePreviewHostInstrument(opts: {
  pluginId?: string | null
  pluginNombre?: string | null
  rol?: string | null
}): Promise<{ trackId: string; slotId: string } | null> {
  await ensureHostMidiAudible()
  const desc = resolvePreviewDescriptor(opts)
  if (!desc) return null
  const info = descriptorToPluginInfo(desc)
  const ok = await ensureTrackVstPlugin(PREVIEW_TRACK_ID, info)
  if (!ok) return null
  if (isJasWaveRolesDescriptor(desc)) {
    const rol = (opts.rol as InstrumentRole) || 'keys'
    try {
      await applyJasWaveRolesParameter(PREVIEW_TRACK_ID, info, rol)
    } catch {
      /* ignore */
    }
  }
  const loaded = getLoadedInstrumentForTrack(PREVIEW_TRACK_ID)
  if (!loaded?.slotId) return null
  setTrackChannelAudible(PREVIEW_TRACK_ID, true)
  setPreferredVstPreviewTrack(PREVIEW_TRACK_ID, [info])
  return { trackId: PREVIEW_TRACK_ID, slotId: loaded.slotId }
}

/** Motor: schedule MIDI en el Plugin Host (mismo path que el arrange). */
function playWithAudioEngine(
  trackId: string,
  slotId: string,
  notes: PreviewMidiNote[],
  bpm: number,
  maxNotes = 64,
): AuditionHandle {
  const sample = notes.slice(0, maxNotes)
  const midiClips = [
    {
      id: 'chat-preview-clip',
      trackId,
      notes: sample.map((n) => ({
        pitch: n.pitch,
        velocity: n.velocidad ?? 80,
        startSec: beatsASegundos(n.inicio, bpm),
        durationSec: Math.max(0.05, beatsASegundos(n.duracion, bpm)),
      })),
    },
  ]
  audioEngine.playClips(
    0,
    [],
    [
      {
        id: trackId,
        volumen: 0.9,
        paneo: 0,
        silenciada: false,
        soloActiva: false,
        vstInstrumentSlotId: slotId,
      },
    ],
    midiClips,
    bpm,
  )
  return {
    stop: () => {
      try {
        audioEngine.stopAllSources()
      } catch {
        /* ignore */
      }
    },
  }
}

async function playWithVstNotePulse(
  trackId: string,
  notes: PreviewMidiNote[],
  bpm: number,
  maxNotes = 32,
): Promise<AuditionHandle> {
  setPreferredVstPreviewTrack(trackId)
  setTrackChannelAudible(trackId, true)
  await ensureHostMidiAudible()
  let cancelled = false
  const sample = notes.slice(0, maxNotes)
  const run = (async () => {
    for (const n of sample) {
      if (cancelled) break
      routeMidiToTrack(trackId, true, n.pitch, Math.min(110, n.velocidad ?? 80), { ignoreMute: true })
      await new Promise((r) =>
        setTimeout(r, Math.min(450, Math.max(70, beatsASegundos(n.duracion, bpm) * 1000))),
      )
      routeMidiToTrack(trackId, false, n.pitch, 0, { ignoreMute: true })
      if (cancelled) break
      await new Promise((r) => setTimeout(r, 20))
    }
  })()
  return {
    stop: () => {
      cancelled = true
      for (const n of sample) {
        routeMidiToTrack(trackId, false, n.pitch, 0, { ignoreMute: true })
      }
      void run
    },
  }
}

async function playWithWebAudio(
  notes: PreviewMidiNote[],
  bpm: number,
  maxNotes = 48,
): Promise<AuditionHandle> {
  const ctx = getPreviewAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  const master = ctx.createGain()
  master.gain.value = 0.22
  master.connect(ctx.destination)
  const t0 = ctx.currentTime + 0.04
  const sample = notes.slice(0, maxNotes)
  for (const n of sample) {
    const start = t0 + beatsASegundos(n.inicio, bpm)
    const dur = Math.max(0.06, beatsASegundos(n.duracion, bpm))
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = 440 * Math.pow(2, (n.pitch - 69) / 12)
    const vel = Math.max(0.05, Math.min(1, (n.velocidad ?? 80) / 127))
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(vel * 0.35, start + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    osc.connect(g)
    g.connect(master)
    osc.start(start)
    osc.stop(start + dur + 0.05)
  }
  return {
    stop: () => {
      try {
        master.gain.setValueAtTime(0, ctx.currentTime)
        master.disconnect()
      } catch {
        /* ignore */
      }
    },
  }
}

/**
 * Reproduce borrador MIDI.
 * Orden: Plugin Host (instrumento elegido / Roles) → VST de pista del proyecto → Web Audio.
 */
export async function playMidiPreviewAudition(opts: {
  notes: PreviewMidiNote[]
  bpm: number
  trackId?: string | null
  candidateTrackIds?: string[]
  /** Instrumento elegido en la tarjeta (pluginId del catálogo). */
  pluginId?: string | null
  pluginNombre?: string | null
  rol?: string | null
  /** Preferir motor host aunque haya Web Audio. Default true. */
  preferHost?: boolean
  onEnded?: () => void
}): Promise<{ mode: 'host' | 'vst' | 'web'; stop: () => void }> {
  stopMidiPreviewAudition()
  const notes = opts.notes.filter((n) => Number.isFinite(n.pitch))
  if (!notes.length) {
    opts.onEnded?.()
    return { mode: 'web', stop: () => undefined }
  }
  const bpm = Math.max(40, Math.min(240, opts.bpm || 120))
  const preferHost = opts.preferHost !== false

  let handle: AuditionHandle
  let mode: 'host' | 'vst' | 'web' = 'web'

  if (preferHost) {
    const host = await ensurePreviewHostInstrument({
      pluginId: opts.pluginId,
      pluginNombre: opts.pluginNombre,
      rol: opts.rol,
    })
    if (host) {
      handle = playWithAudioEngine(host.trackId, host.slotId, notes, bpm)
      mode = 'host'
    } else {
      const vstTrack = findAudibleTrackId(opts.trackId, opts.candidateTrackIds)
      if (vstTrack) {
        const slot = getLoadedInstrumentForTrack(vstTrack)?.slotId
        if (slot) {
          handle = playWithAudioEngine(vstTrack, slot, notes, bpm)
          mode = 'host'
        } else {
          handle = await playWithVstNotePulse(vstTrack, notes, bpm)
          mode = 'vst'
        }
      } else {
        handle = await playWithWebAudio(notes, bpm)
        mode = 'web'
      }
    }
  } else {
    handle = await playWithWebAudio(notes, bpm)
    mode = 'web'
  }

  const endMs = Math.min(
    60_000,
    Math.max(
      900,
      ...notes.slice(0, 48).map((n) => (beatsASegundos(n.inicio + n.duracion, bpm) + 0.4) * 1000),
    ),
  )
  const endTimer = setTimeout(() => {
    handle.stop()
    if (active === wrapped) active = null
    opts.onEnded?.()
  }, endMs)
  const wrapped: AuditionHandle = {
    stop: () => {
      clearTimeout(endTimer)
      handle.stop()
    },
  }
  active = wrapped
  return {
    mode,
    stop: () => {
      wrapped.stop()
      if (active === wrapped) active = null
    },
  }
}
