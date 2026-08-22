/**
 * Runtime VST3 por pista: load en Plugin Host + MIDI (preview / playback).
 */

import type { PluginInfo } from '../../../../shared/src/types/entidades'
import { createElectronPluginHostBridge } from './electron-bridge-client'
import { guessIsInstrument } from './plugin-info-adapter'
import { setActiveVstVoiceTarget, getActiveVstVoiceTarget } from './vst-voice-router'

export function extractVst3Path(descripcion: string): string {
  const raw = (descripcion || '').trim()
  if (!raw) return ''
  const cut = raw.split(' · ')[0]?.trim() ?? raw
  if (cut.toLowerCase().endsWith('.vst3')) return cut
  return raw.toLowerCase().includes('.vst3') ? cut : ''
}

export function isBuiltinInstrument(plugin: PluginInfo): boolean {
  return (
    plugin.licencia === 'interno' ||
    plugin.licencia === 'JasWave' ||
    plugin.nombre.includes('Soft Pad')
  )
}

/** Instrumento de playback: VST gana si hay uno; si no, Soft Pad. */
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
    const isInst =
      p.tipo === 'instrumento' ||
      p.categoria === 'instrumento' ||
      p.categoria === 'synth' ||
      guessIsInstrument(p.nombre, path)
    if (isInst) return { kind: 'vst', plugin: p, path }
  }
  return builtin ? { kind: 'builtin', plugin: builtin } : null
}

/** Primer instrumento VST3 no bypass de la cadena. */
export function findTrackVstInstrument(plugins: PluginInfo[] | undefined): PluginInfo | null {
  const hit = findTrackPlaybackInstrument(plugins)
  return hit?.kind === 'vst' ? hit.plugin : null
}

export function slotIdForTrackPlugin(trackId: string, pluginId: string): string {
  return `${trackId}:${pluginId}`
}

type LoadedInst = {
  trackId: string
  pluginId: string
  path: string
  slotId: string
}

const byTrack = new Map<string, LoadedInst>()
const loadPromises = new Map<string, Promise<boolean>>()

export function getLoadedInstrumentForTrack(trackId: string): LoadedInst | null {
  return byTrack.get(trackId) ?? null
}

export async function releaseSlot(slotId: string): Promise<void> {
  try {
    await window.electron?.pluginHostSend?.({ type: 'closeEditor', slotId })
    await window.electron?.pluginHostSend?.({ type: 'unload', slotId })
  } catch {
    /* ignore */
  }
  for (const [trackId, inst] of [...byTrack.entries()]) {
    if (inst.slotId === slotId) byTrack.delete(trackId)
  }
  const active = getActiveVstVoiceTarget()
  if (active?.slotId === slotId) setActiveVstVoiceTarget(null)
}

export async function releaseTrackPlugin(trackId: string, pluginId: string): Promise<void> {
  const slotId = slotIdForTrackPlugin(trackId, pluginId)
  await releaseSlot(slotId)
  const existing = byTrack.get(trackId)
  if (existing?.pluginId === pluginId) byTrack.delete(trackId)
}

/** Sincroniza slots cargados con el proyecto (quita huérfanos). */
export async function syncLoadedSlotsWithProject(
  tracks: Array<{ id: string; plugins?: PluginInfo[] }>,
): Promise<void> {
  const live = new Set<string>()
  for (const t of tracks) {
    for (const p of t.plugins ?? []) {
      if (isBuiltinInstrument(p)) continue
      if (extractVst3Path(p.descripcion)) live.add(slotIdForTrackPlugin(t.id, p.id))
    }
  }
  for (const [trackId, inst] of [...byTrack.entries()]) {
    if (!live.has(inst.slotId)) {
      await releaseSlot(inst.slotId)
      byTrack.delete(trackId)
    }
  }
}

export async function ensureTrackVstInstrument(
  trackId: string,
  plugin: PluginInfo,
): Promise<boolean> {
  const path = extractVst3Path(plugin.descripcion)
  if (!path) return false
  const slotId = slotIdForTrackPlugin(trackId, plugin.id)
  const existing = byTrack.get(trackId)
  if (existing?.slotId === slotId && existing.path === path) return true

  if (existing && existing.slotId !== slotId) {
    await releaseSlot(existing.slotId)
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
      byTrack.set(trackId, { trackId, pluginId: plugin.id, path, slotId })
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

export async function ensureProjectVstInstruments(
  tracks: Array<{ id: string; plugins?: PluginInfo[] }>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  await Promise.all(
    tracks.map(async (t) => {
      const hit = findTrackPlaybackInstrument(t.plugins)
      if (!hit || hit.kind !== 'vst') return
      const ok = await ensureTrackVstInstrument(t.id, hit.plugin)
      if (ok) {
        map.set(t.id, slotIdForTrackPlugin(t.id, hit.plugin.id))
      } else {
        console.warn('[track-vst] no se pudo cargar instrumento VST para pista', t.id, hit.plugin.nombre)
      }
    }),
  )
  return map
}

export function sendVstNote(
  slotId: string,
  on: boolean,
  pitch: number,
  velocity = 100,
): void {
  void (async () => {
    try {
      if (!window.electron?.pluginHostSend) return
      if (!createElectronPluginHostBridge().isAvailable()) {
        await window.electron.pluginHostEnsure?.()
      }
      await window.electron.pluginHostSend(
        on
          ? { type: 'noteOn', slotId, pitch, velocity }
          : { type: 'noteOff', slotId, pitch },
      )
    } catch {
      /* ignore */
    }
  })()
}

export function allNotesOffSlot(slotId: string): void {
  void window.electron?.pluginHostSend?.({ type: 'allNotesOff', slotId })
}

export function allNotesOffAllTracks(): void {
  for (const inst of byTrack.values()) {
    allNotesOffSlot(inst.slotId)
  }
}
