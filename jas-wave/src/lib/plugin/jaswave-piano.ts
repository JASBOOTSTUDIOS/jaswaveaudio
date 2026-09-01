/**
 * JasWave Piano Synth VST3 (Karplus-Strong) — piano nativo dedicado.
 */

import type { PluginDescriptor } from './types'
import { pluginRegistry } from './registry'
import { descriptorToPluginInfo } from './plugin-info-adapter'
import { ensureTrackVstInstrument, slotIdForTrackPlugin } from './track-vst-runtime'
import type { PluginInfo } from '../../../../shared/src/types/entidades'

export const JASWAVE_PIANO_NAME = 'JasWave Piano Synth'
export const JASWAVE_PIANO_VENDOR = 'JasWave'

export function defaultJasWavePianoPath(): string {
  if (typeof process !== 'undefined') {
    const env = process.env?.LOCALAPPDATA?.trim()
    if (env) return `${env.replace(/[/\\]+$/, '')}\\Programs\\Common\\VST3\\JasWave\\JasWavePiano.vst3`
    const profile = process.env?.USERPROFILE?.trim()
    if (profile) {
      return `${profile.replace(/[/\\]+$/, '')}\\AppData\\Local\\Programs\\Common\\VST3\\JasWave\\JasWavePiano.vst3`
    }
  }
  try {
    const sync = (window as unknown as { electron?: { localAppDataSync?: string } })?.electron
      ?.localAppDataSync
    if (sync && String(sync).trim()) {
      return `${String(sync).trim().replace(/[/\\]+$/, '')}\\Programs\\Common\\VST3\\JasWave\\JasWavePiano.vst3`
    }
  } catch {
    /* ignore */
  }
  return 'C:\\Program Files\\Common Files\\VST3\\JasWave\\JasWavePiano.vst3'
}

try {
  ;(globalThis as unknown as { __jaswavePianoPath?: () => string }).__jaswavePianoPath =
    defaultJasWavePianoPath
} catch {
  /* ignore */
}

export function isJasWavePianoDescriptor(d: PluginDescriptor): boolean {
  const blob = `${d.name} ${d.vendor} ${d.path ?? ''} ${d.pluginId}`.toLowerCase()
  return /jaswave\s*piano|jaswavepiano/.test(blob) || (d.vendor === 'JasWave' && /piano/.test(blob))
}

export function ensureJasWavePianoRegistered(explicitPath?: string): PluginDescriptor | undefined {
  const path = (explicitPath || defaultJasWavePianoPath()).trim()
  const existing = findJasWavePianoDescriptor()
  if (existing?.path) {
    if (path && existing.path !== path && /AppData\\Local/i.test(path)) {
      existing.path = path
      pluginRegistry.register(existing)
    }
    return existing
  }
  if (!path) return undefined
  let hash = 0
  for (let i = 0; i < path.length; i++) hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0
  const d: PluginDescriptor = {
    pluginId: `vst3.piano.${(hash >>> 0).toString(16)}`,
    format: 'vst3',
    vendor: JASWAVE_PIANO_VENDOR,
    name: JASWAVE_PIANO_NAME,
    version: '1.0.0',
    path,
    category: 'instrumento',
    isInstrument: true,
    isEffect: false,
    supportsMidiInput: true,
    supportsMidiOutput: false,
    supportsAudioInput: false,
    supportsAudioOutput: true,
    supportsSidechain: false,
    supportsEditor: false,
    parameterCount: 5,
    scanStatus: 'ok',
    hostReady: true,
    isolation: 'out-of-process',
  }
  pluginRegistry.register(d)
  return d
}

export function findJasWavePianoDescriptor(
  catalog: PluginDescriptor[] = pluginRegistry.list(),
): PluginDescriptor | undefined {
  return catalog.find((d) => isJasWavePianoDescriptor(d) && d.hostReady && !!d.path)
}

export function jasWavePianoPluginInfo(): PluginInfo | null {
  const d = ensureJasWavePianoRegistered() ?? findJasWavePianoDescriptor()
  if (!d) return null
  return descriptorToPluginInfo(d)
}

export async function insertJasWavePianoOnTrack(
  executeInsert: (plugin: PluginInfo) => Promise<unknown>,
  trackId: string,
): Promise<PluginInfo | null> {
  const info = jasWavePianoPluginInfo()
  if (!info) return null
  await executeInsert(info)
  const ok = await ensureTrackVstInstrument(trackId, info)
  if (!ok) return null
  void slotIdForTrackPlugin(trackId, info.id)
  return info
}
