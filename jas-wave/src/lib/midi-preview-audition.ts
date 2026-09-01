/**
 * Audición MIDI en chat/preview vía Plugin Host (sonido real del VST).
 * Usa el mismo path que el piano roll: noteOn/Off live → slot en el mix ASIO.
 */

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
  allNotesOffSlot,
  ensureHostMidiAudible,
  ensureTrackVstPlugin,
  findTrackPlaybackInstrument,
  flushProjectGraphResync,
  getLastVstLoadError,
  getLoadedInstrumentForTrack,
  listLoadedSlots,
} from '@/src/lib/plugin/track-vst-runtime'
import {
  routeMidiToTrack,
  setActiveVstVoiceTarget,
  setPreferredVstPreviewTrack,
  setTrackChannelAudible,
} from '@/src/lib/plugin/vst-voice-router'
import { setEditorPreviewTrackId } from '@/src/lib/plugin/editor-preview-focus'
import { openPluginEditor } from '@/src/lib/plugin/plugin-editor-store'
import type { PluginInfo } from '../../../shared/src/types/entidades'
import type { InstrumentRole } from '@/src/lib/plugin-knowledge'

export type PreviewMidiNote = {
  pitch: number
  inicio: number
  duracion: number
  velocidad: number
}

export type AuditionMode = 'host' | 'web'

type AuditionHandle = { stop: () => void }

export const PREVIEW_AUDITION_TRACK_ID = '__chat_midi_preview__'

let active: AuditionHandle | null = null
let sharedCtx: AudioContext | null = null
let lastPrepared: {
  trackId: string
  plugin: PluginInfo
  slotId: string
} | null = null

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
}

export function getLastPreviewInstrument(): {
  trackId: string
  plugin: PluginInfo
  slotId: string
} | null {
  return lastPrepared
}

function sliceNotes(
  notes: PreviewMidiNote[],
  startBeat: number,
  endBeat?: number,
): PreviewMidiNote[] {
  const end = endBeat ?? Number.POSITIVE_INFINITY
  return notes
    .filter((n) => Number.isFinite(n.pitch))
    .filter((n) => n.inicio < end && n.inicio + n.duracion > startBeat)
    .map((n) => {
      const start = Math.max(0, n.inicio - startBeat)
      const noteEnd = n.inicio + n.duracion - startBeat
      return {
        ...n,
        inicio: start,
        duracion: Math.max(0.05, noteEnd - start),
      }
    })
}

export function resolvePreviewDescriptor(opts: {
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

function pluginInfoFromLoaded(
  loaded: { pluginId: string; path: string },
  opts: { pluginId?: string | null; pluginNombre?: string | null },
): PluginInfo {
  const desc = resolvePreviewDescriptor(opts)
  if (desc) return descriptorToPluginInfo(desc)
  return {
    id: loaded.pluginId,
    nombre: opts.pluginNombre || loaded.pluginId,
    fabricante: '',
    tipo: 'instrumento',
    bypass: false,
    parametros: [],
    estado: 'cargado',
    version: '',
    wet: 1,
    latencia: 0,
    categoria: 'instrumento',
    autor: '',
    licencia: '',
    descripcion: loaded.path,
    ui: { ancho: 0, alto: 0, personalizable: false },
  } as unknown as PluginInfo
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '')
}

function resolveTargetTrackId(opts: {
  trackId?: string | null
  pluginId?: string | null
  pluginNombre?: string | null
  rol?: string | null
  candidateTrackIds?: string[]
}): string | null {
  if (opts.trackId && !opts.trackId.startsWith('__')) return opts.trackId

  const loaded = listLoadedSlots().filter((s) => s.instrument && !s.trackId.startsWith('__'))
  const pluginId = opts.pluginId ? String(opts.pluginId) : ''
  const pluginNombre = opts.pluginNombre ? norm(String(opts.pluginNombre)) : ''
  const rol = String(opts.rol ?? '').toLowerCase()

  if (pluginId) {
    const byId = loaded.find((s) => s.pluginId === pluginId)
    if (byId) return byId.trackId
  }
  if (pluginNombre) {
    const byName = loaded.find(
      (s) => norm(s.path).includes(pluginNombre) || norm(s.pluginId).includes(pluginNombre),
    )
    if (byName) return byName.trackId
  }

  if (rol === 'drums') {
    const drum = loaded.find((s) => /drum|bater|powerdrum|bfd|kit/i.test(`${s.path} ${s.pluginId}`))
    if (drum) return drum.trackId
  }

  for (const id of opts.candidateTrackIds ?? []) {
    if (!id.startsWith('__') && getLoadedInstrumentForTrack(id)?.slotId) return id
  }
  return loaded[0]?.trackId ?? null
}

function resolvePluginForTarget(opts: {
  pluginId?: string | null
  pluginNombre?: string | null
  rol?: string | null
  trackPlugins?: PluginInfo[] | null
}): PluginInfo | null {
  const fromTrack = opts.trackPlugins?.length
    ? findTrackPlaybackInstrument(opts.trackPlugins)?.plugin ?? null
    : null
  if (fromTrack) return fromTrack
  const desc = resolvePreviewDescriptor(opts)
  return desc ? descriptorToPluginInfo(desc) : null
}

function bindAudible(trackId: string, plugin: PluginInfo, slotId: string): void {
  setTrackChannelAudible(trackId, true)
  setPreferredVstPreviewTrack(trackId, [plugin])
  setEditorPreviewTrackId(trackId)
  setActiveVstVoiceTarget({
    slotId,
    path: typeof plugin.descripcion === 'string' ? plugin.descripcion : '',
    trackId,
    pluginId: plugin.id,
  })
  flushProjectGraphResync()
  lastPrepared = { trackId, plugin, slotId }
}

/** Carga el VST elegido y lo enlaza al mix del host. */
export async function ensurePreviewHostInstrument(opts: {
  pluginId?: string | null
  pluginNombre?: string | null
  rol?: string | null
  trackId?: string | null
  candidateTrackIds?: string[]
  trackPlugins?: PluginInfo[] | null
}): Promise<{ trackId: string; slotId: string; plugin: PluginInfo } | null> {
  await ensureHostMidiAudible()

  const plugin = resolvePluginForTarget(opts)
  if (!plugin) return null

  let targetTrackId = resolveTargetTrackId(opts) ?? PREVIEW_AUDITION_TRACK_ID
  const ok = await ensureTrackVstPlugin(targetTrackId, plugin)
  if (!ok && targetTrackId !== PREVIEW_AUDITION_TRACK_ID) {
    targetTrackId = PREVIEW_AUDITION_TRACK_ID
    if (!(await ensureTrackVstPlugin(targetTrackId, plugin))) return null
  } else if (!ok) {
    return null
  }

  const desc = resolvePreviewDescriptor(opts)
  if (desc && isJasWaveRolesDescriptor(desc)) {
    try {
      await applyJasWaveRolesParameter(targetTrackId, plugin, (opts.rol as InstrumentRole) || 'keys')
    } catch {
      /* ignore */
    }
  }

  const loaded = getLoadedInstrumentForTrack(targetTrackId)
  if (!loaded?.slotId) return null

  const info =
    plugin ??
    pluginInfoFromLoaded(loaded, {
      pluginId: opts.pluginId,
      pluginNombre: opts.pluginNombre,
    })

  bindAudible(targetTrackId, info, loaded.slotId)
  // Esperar IPC setTrackGraph antes del primer noteOn.
  await new Promise((r) => setTimeout(r, 80))
  return { trackId: targetTrackId, slotId: loaded.slotId, plugin: info }
}

export async function openPreviewPluginEditor(opts: {
  pluginId?: string | null
  pluginNombre?: string | null
  rol?: string | null
  trackId?: string | null
  candidateTrackIds?: string[]
  trackPlugins?: PluginInfo[] | null
}): Promise<{ ok: boolean; message: string }> {
  const prepared = await ensurePreviewHostInstrument(opts)
  if (!prepared) {
    return {
      ok: false,
      message: getLastVstLoadError() || 'No se pudo cargar el instrumento en el Plugin Host.',
    }
  }
  openPluginEditor({
    trackId: prepared.trackId,
    pluginId: prepared.plugin.id,
    pluginName: prepared.plugin.nombre,
    pluginSnapshot: prepared.plugin,
    zone: 'right',
  })
  return { ok: true, message: `Editor · ${prepared.plugin.nombre}` }
}

/**
 * Piano-roll path: noteOn/Off en tiempo real hacia el slot del host.
 * El audio sale por ASIO (mismo VST que el arrange).
 */
function playWithLiveVst(
  trackId: string,
  slotId: string,
  plugins: PluginInfo[],
  notes: PreviewMidiNote[],
  bpm: number,
  maxNotes = 128,
): AuditionHandle {
  setPreferredVstPreviewTrack(trackId, plugins)
  setTrackChannelAudible(trackId, true)
  setEditorPreviewTrackId(trackId)
  flushProjectGraphResync()

  const sample = notes.slice(0, maxNotes)
  const timers: Array<ReturnType<typeof setTimeout>> = []
  const leadMs = 60

  const routeOpts = { ignoreMute: true as const, plugins }

  for (const n of sample) {
    const onMs = leadMs + beatsASegundos(n.inicio, bpm) * 1000
    const offMs = onMs + Math.max(50, beatsASegundos(n.duracion, bpm) * 1000)
    const vel = Math.min(127, Math.max(1, n.velocidad ?? 90))

    timers.push(
      setTimeout(() => {
        routeMidiToTrack(trackId, true, n.pitch, vel, routeOpts)
      }, Math.max(0, onMs)),
    )
    timers.push(
      setTimeout(() => {
        routeMidiToTrack(trackId, false, n.pitch, 0, routeOpts)
      }, Math.max(0, offMs)),
    )
  }

  return {
    stop: () => {
      for (const t of timers) clearTimeout(t)
      allNotesOffSlot(slotId)
      for (const n of sample) {
        routeMidiToTrack(trackId, false, n.pitch, 0, routeOpts)
      }
    },
  }
}

async function playWithWebAudio(
  notes: PreviewMidiNote[],
  bpm: number,
  maxNotes = 96,
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

export async function playMidiPreviewAudition(opts: {
  notes: PreviewMidiNote[]
  bpm: number
  startBeat?: number
  endBeat?: number
  trackId?: string | null
  candidateTrackIds?: string[]
  pluginId?: string | null
  pluginNombre?: string | null
  rol?: string | null
  trackPlugins?: PluginInfo[] | null
  forceWeb?: boolean
  preferHost?: boolean
  /** Solo si el VST no carga. Default false — preview = sonido real. */
  webMonitor?: boolean
  onEnded?: () => void
}): Promise<{
  mode: AuditionMode
  stop: () => void
  message: string
  durationBeats: number
  startBeat: number
}> {
  stopMidiPreviewAudition()
  const startBeat = Math.max(0, opts.startBeat ?? 0)
  const sliced = sliceNotes(opts.notes, startBeat, opts.endBeat)
  if (!sliced.length) {
    opts.onEnded?.()
    return {
      mode: 'web',
      stop: () => undefined,
      message: 'No hay notas en este tramo.',
      durationBeats: 0,
      startBeat,
    }
  }
  const bpm = Math.max(40, Math.min(240, opts.bpm || 120))
  const durationBeats = Math.max(0.25, ...sliced.map((n) => n.inicio + n.duracion))

  let handle: AuditionHandle
  let mode: AuditionMode = 'web'
  let message = 'Sonido de prueba (Web Audio)'

  const preferHost = opts.preferHost !== false && !opts.forceWeb

  if (preferHost) {
    const host = await ensurePreviewHostInstrument({
      pluginId: opts.pluginId,
      pluginNombre: opts.pluginNombre,
      rol: opts.rol,
      trackId: opts.trackId,
      candidateTrackIds: opts.candidateTrackIds,
      trackPlugins: opts.trackPlugins,
    })

    if (host) {
      const plugins = opts.trackPlugins?.length
        ? opts.trackPlugins
        : [host.plugin]
      handle = playWithLiveVst(host.trackId, host.slotId, plugins, sliced, bpm)
      mode = 'host'
      const via = host.trackId.startsWith('__') ? 'audición' : 'pista del proyecto'
      message = `${host.plugin.nombre} · ${via}`
    } else if (opts.webMonitor) {
      handle = await playWithWebAudio(sliced, bpm)
      message =
        (getLastVstLoadError() ? `${getLastVstLoadError()} · ` : '') +
        'Sonido de prueba (VST no disponible)'
    } else {
      opts.onEnded?.()
      return {
        mode: 'web',
        stop: () => undefined,
        message:
          getLastVstLoadError() ||
          'No se pudo cargar el VST. Elige instrumento en la tarjeta o crea la pista primero.',
        durationBeats,
        startBeat,
      }
    }
  } else {
    handle = await playWithWebAudio(sliced, bpm)
    mode = 'web'
  }

  const endMs = Math.min(90_000, beatsASegundos(durationBeats, bpm) * 1000 + 400)
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
    message,
    durationBeats,
    startBeat,
    stop: () => {
      wrapped.stop()
      if (active === wrapped) active = null
    },
  }
}
