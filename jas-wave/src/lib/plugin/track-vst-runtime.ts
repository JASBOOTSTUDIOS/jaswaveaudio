/**
 * Runtime VST3 por pista (estilo Reaper): load de toda la cadena
 * (instrumento + efectos) en Plugin Host + MIDI.
 */

import type { PluginInfo } from '../../../../shared/src/types/entidades'
import { extractVst3Path, guessIsInstrument, isBuiltinPlugin } from './plugin-info-adapter'
import { setActiveVstVoiceTarget, getActiveVstVoiceTarget } from './vst-voice-router'
import { encodeTrackGraph } from './track-graph-encoding'
import { audioEngine } from '@/lib/audio-engine'

export { extractVst3Path }

export function isBuiltinInstrument(plugin: PluginInfo): boolean {
  return isBuiltinPlugin(plugin)
}

export function isVstInstrumentPlugin(plugin: PluginInfo, path: string): boolean {
  return (
    plugin.tipo === 'instrumento' ||
    plugin.categoria === 'instrumento' ||
    plugin.categoria === 'synth' ||
    guessIsInstrument(plugin.nombre, path)
  )
}

/** Instrumento de playback de la cadena: VST si hay uno; si no, Soft Pad solo si está insertado. */
export function findTrackPlaybackInstrument(
  plugins: PluginInfo[] | undefined,
): { kind: 'builtin'; plugin: PluginInfo } | { kind: 'vst'; plugin: PluginInfo; path: string } | null {
  let builtin: PluginInfo | null = null
  for (const p of plugins ?? []) {
    if (p.bypass) continue
    if (isBuiltinInstrument(p)) {
      if (!builtin) builtin = p
      continue
    }
    const path = extractVst3Path(p.descripcion)
    if (!path) continue
    if (isVstInstrumentPlugin(p, path)) return { kind: 'vst', plugin: p, path }
  }
  return builtin ? { kind: 'builtin', plugin: builtin } : null
}

export function trackHasInsertedSoftPad(plugins: PluginInfo[] | undefined): boolean {
  return findTrackPlaybackInstrument(plugins)?.kind === 'builtin'
}

/** Primer instrumento VST3 no bypass de la cadena. */
export function findTrackVstInstrument(plugins: PluginInfo[] | undefined): PluginInfo | null {
  const hit = findTrackPlaybackInstrument(plugins)
  return hit?.kind === 'vst' ? hit.plugin : null
}

export function slotIdForTrackPlugin(trackId: string, pluginId: string): string {
  return `${trackId}:${pluginId}`
}

type LoadedPlugin = {
  trackId: string
  pluginId: string
  path: string
  slotId: string
  instrument: boolean
}

/** Instrumento activo por pista (MIDI). */
const byTrack = new Map<string, LoadedPlugin>()
/** Todos los slots VST cargados (instrumento + efecto). */
const bySlot = new Map<string, LoadedPlugin>()
const loadPromises = new Map<string, Promise<boolean>>()
const runtimeListeners = new Set<() => void>()
let runtimeGeneration = 0

function emitRuntime() {
  runtimeGeneration += 1
  for (const l of runtimeListeners) l()
}

export function subscribeVstRuntime(listener: () => void): () => void {
  runtimeListeners.add(listener)
  return () => {
    runtimeListeners.delete(listener)
  }
}

export function getVstRuntimeGeneration(): number {
  return runtimeGeneration
}

export function isPluginAudioReady(trackId: string, pluginId: string): boolean {
  return bySlot.has(slotIdForTrackPlugin(trackId, pluginId))
}

export function getLoadedInstrumentForTrack(trackId: string): LoadedPlugin | null {
  return byTrack.get(trackId) ?? null
}

export async function releaseSlot(slotId: string): Promise<void> {
  try {
    await window.electron?.pluginHostSend?.({ type: 'closeEditor', slotId })
    await window.electron?.pluginHostSend?.({ type: 'unload', slotId })
  } catch {
    /* ignore */
  }
  bySlot.delete(slotId)
  for (const [trackId, inst] of [...byTrack.entries()]) {
    if (inst.slotId === slotId) byTrack.delete(trackId)
  }
  const active = getActiveVstVoiceTarget()
  if (active?.slotId === slotId) setActiveVstVoiceTarget(null)
  emitRuntime()
}

export async function releaseTrackPlugin(trackId: string, pluginId: string): Promise<void> {
  const slotId = slotIdForTrackPlugin(trackId, pluginId)
  await releaseSlot(slotId)
}

/** Sincroniza slots cargados con el proyecto (quita huérfanos). */
export async function syncLoadedSlotsWithProject(
  tracks: Array<{ id: string; plugins?: PluginInfo[] }>,
  masterPlugins?: PluginInfo[],
): Promise<void> {
  const live = new Set<string>()
  for (const t of tracks) {
    for (const p of t.plugins ?? []) {
      if (isBuiltinInstrument(p)) continue
      if (extractVst3Path(p.descripcion)) live.add(slotIdForTrackPlugin(t.id, p.id))
    }
  }
  for (const p of masterPlugins ?? []) {
    if (isBuiltinInstrument(p)) continue
    if (extractVst3Path(p.descripcion)) live.add(slotIdForTrackPlugin('master', p.id))
  }
  for (const slotId of [...bySlot.keys()]) {
    if (!live.has(slotId)) await releaseSlot(slotId)
  }
}

export async function ensureTrackVstPlugin(
  trackId: string,
  plugin: PluginInfo,
): Promise<boolean> {
  const path = extractVst3Path(plugin.descripcion)
  if (!path) return false
  const slotId = slotIdForTrackPlugin(trackId, plugin.id)
  const instrument = isVstInstrumentPlugin(plugin, path)
  const existing = bySlot.get(slotId)
  if (existing?.path === path) {
    if (instrument) byTrack.set(trackId, existing)
    return true
  }

  if (instrument) {
    const prevInst = byTrack.get(trackId)
    if (prevInst && prevInst.slotId !== slotId) await releaseSlot(prevInst.slotId)
  }

  const pending = loadPromises.get(slotId)
  if (pending) return pending

  const work = (async () => {
    try {
      if (!window.electron?.pluginHostEnsure || !window.electron.pluginHostSend) return false
      await window.electron.pluginHostEnsure()
      const raw = await window.electron.pluginHostSend({
        type: 'load',
        path,
        slotId,
        pluginId: plugin.id,
        sampleRate: 48000,
        blockSize: 512,
      })
      const ok = !!(raw && typeof raw === 'object' && (raw as { ok?: boolean }).ok)
      if (!ok) {
        const msg =
          raw && typeof raw === 'object' && 'message' in raw
            ? String((raw as { message: unknown }).message)
            : 'load falló'
        console.error('[track-vst] load failed', path, msg)
        return false
      }
      const loaded: LoadedPlugin = { trackId, pluginId: plugin.id, path, slotId, instrument }
      bySlot.set(slotId, loaded)
      if (instrument) {
        byTrack.set(trackId, loaded)
        setActiveVstVoiceTarget({ slotId, path, trackId, pluginId: plugin.id })
      }
      emitRuntime()
      return true
    } catch {
      return false
    } finally {
      loadPromises.delete(slotId)
    }
  })()

  loadPromises.set(slotId, work)
  return work
}

/** @deprecated usar ensureTrackVstPlugin */
export async function ensureTrackVstInstrument(
  trackId: string,
  plugin: PluginInfo,
): Promise<boolean> {
  return ensureTrackVstPlugin(trackId, plugin)
}

/** Carga instrumentos + efectos VST3 de todas las pistas (y master). */
export async function ensureProjectVstInstruments(
  tracks: Array<{ id: string; plugins?: PluginInfo[] }>,
  masterPlugins?: PluginInfo[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  await Promise.all([
    ...tracks.map(async (t) => {
      for (const p of t.plugins ?? []) {
        if (p.bypass) continue
        if (isBuiltinInstrument(p)) continue
        const path = extractVst3Path(p.descripcion)
        if (!path) continue
        const ok = await ensureTrackVstPlugin(t.id, p)
        if (ok && isVstInstrumentPlugin(p, path)) {
          map.set(t.id, slotIdForTrackPlugin(t.id, p.id))
        }
      }
    }),
    ...(masterPlugins ?? []).map(async (p) => {
      if (p.bypass || isBuiltinInstrument(p)) return
      if (!extractVst3Path(p.descripcion)) return
      await ensureTrackVstPlugin('master', p)
    }),
  ])
  return map
}

/** Publica el graph Reaper al host + layout de stems en Web Audio. */
export function syncReaperTrackGraph(
  tracks: Array<{
    id: string
    plugins?: PluginInfo[]
    volumen?: number
    paneo?: number
    silenciada?: boolean
    soloActiva?: boolean
  }>,
  masterPlugins?: PluginInfo[],
): void {
  const anySolo = tracks.some((t) => t.soloActiva)
  audioEngine.setTrackStemLayout(tracks.map((t) => t.id))

  const graphTracks = tracks.map((t, stemIndex) => {
    const muted = anySolo ? !t.soloActiva : Boolean(t.silenciada)
    const slots: Array<{ slotId: string; instrument: boolean; bypass: boolean }> = []
    for (const p of t.plugins ?? []) {
      if (isBuiltinInstrument(p)) continue
      const path = extractVst3Path(p.descripcion)
      if (!path) continue
      const slotId = slotIdForTrackPlugin(t.id, p.id)
      if (!bySlot.has(slotId)) continue
      slots.push({
        slotId,
        instrument: isVstInstrumentPlugin(p, path),
        bypass: Boolean(p.bypass),
      })
    }
    return {
      stemIndex,
      gain: typeof t.volumen === 'number' ? t.volumen : 0.8,
      pan: typeof t.paneo === 'number' ? t.paneo : 0,
      muted,
      slots,
    }
  })

  const master: Array<{ slotId: string; instrument: boolean; bypass: boolean }> = []
  for (const p of masterPlugins ?? []) {
    if (isBuiltinInstrument(p)) continue
    const path = extractVst3Path(p.descripcion)
    if (!path) continue
    const slotId = slotIdForTrackPlugin('master', p.id)
    if (!bySlot.has(slotId)) continue
    master.push({
      slotId,
      instrument: isVstInstrumentPlugin(p, path),
      bypass: Boolean(p.bypass),
    })
  }

  const encoding = encodeTrackGraph({ tracks: graphTracks, master })
  try {
    void window.electron?.pluginHostSend?.({ type: 'setTrackGraph', encoding })
  } catch {
    /* ignore */
  }
}

export function sendVstNote(
  slotId: string,
  on: boolean,
  pitch: number,
  velocity = 100,
): void {
  try {
    const api = window.electron
    if (!api) return
    const cmd = on
      ? { type: 'noteOn' as const, slotId, pitch, velocity }
      : { type: 'noteOff' as const, slotId, pitch }
    if (typeof api.pluginHostMidi === 'function') {
      void api.pluginHostMidi(cmd)
      return
    }
    void api.pluginHostSend?.(cmd)
  } catch {
    /* ignore */
  }
}

export function allNotesOffSlot(slotId: string): void {
  try {
    const api = window.electron
    if (typeof api?.pluginHostMidi === 'function') {
      void api.pluginHostMidi({ type: 'allNotesOff', slotId })
      return
    }
    void api?.pluginHostSend?.({ type: 'allNotesOff', slotId })
  } catch {
    /* ignore */
  }
}

export function allNotesOffAllTracks(): void {
  for (const inst of byTrack.values()) {
    allNotesOffSlot(inst.slotId)
  }
}
