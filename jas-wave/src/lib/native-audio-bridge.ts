/**
 * Bridge tipado hacia el motor C++ (ADR-0009).
 * En Electron: IPC → main carga N-API.
 * Si no hay addon: isAvailable() === false → WebAudio fallback.
 */

export type AudioEngineConfig = {
  sampleRate: number
  bufferSize: number
  channels?: number
}

export type PlaybackTrack = {
  id: string
  volume: number
  pan: number
  muted: boolean
  solo: boolean
}

export type PlaybackClip = {
  id: string
  trackId: string
  bufferId: string
  startSec: number
  durationSec: number
  bufferOffsetSec?: number
}

type ElectronNativeAudio = {
  nativeAudioAvailable: () => Promise<boolean>
  nativeAudioInitialize: (config: AudioEngineConfig) => Promise<void>
  nativeAudioShutdown: () => Promise<void>
  nativeAudioLoadBuffer: (
    id: string,
    samples: Float32Array,
    sampleRate: number,
    channels: number,
  ) => Promise<void>
  nativeAudioUnloadBuffer: (id: string) => Promise<void>
  nativeAudioSetGraph: (graph: { tracks: PlaybackTrack[]; clips: PlaybackClip[] }) => Promise<void>
  nativeAudioPlay: () => Promise<void>
  nativeAudioPause: () => Promise<void>
  nativeAudioStop: () => Promise<void>
  nativeAudioSeek: (seconds: number) => Promise<void>
  nativeAudioGetPlayhead: () => Promise<number>
  nativeAudioIsPlaying: () => Promise<boolean>
  nativeAudioGetMeterPeak: () => Promise<number>
}

function electronApi(): ElectronNativeAudio | null {
  if (typeof window === 'undefined') return null
  const e = (window as unknown as { electron?: ElectronNativeAudio }).electron
  if (!e?.nativeAudioAvailable) return null
  return e
}

let cachedAvailable: boolean | null = null

export const nativeAudioBridge = {
  async isAvailable(): Promise<boolean> {
    if (cachedAvailable != null) return cachedAvailable
    const api = electronApi()
    if (!api) {
      cachedAvailable = false
      return false
    }
    try {
      cachedAvailable = await api.nativeAudioAvailable()
    } catch {
      cachedAvailable = false
    }
    return cachedAvailable
  },

  async initialize(config: AudioEngineConfig): Promise<void> {
    const api = electronApi()
    if (!api || !(await this.isAvailable())) return
    await api.nativeAudioInitialize(config)
  },

  async shutdown(): Promise<void> {
    const api = electronApi()
    if (!api || !cachedAvailable) return
    await api.nativeAudioShutdown()
  },

  async loadBuffer(
    id: string,
    samples: Float32Array,
    sampleRate: number,
    channels: number,
  ): Promise<void> {
    const api = electronApi()
    if (!api || !(await this.isAvailable())) return
    await api.nativeAudioLoadBuffer(id, samples, sampleRate, channels)
  },

  async setGraph(tracks: PlaybackTrack[], clips: PlaybackClip[]): Promise<void> {
    const api = electronApi()
    if (!api || !(await this.isAvailable())) return
    await api.nativeAudioSetGraph({ tracks, clips })
  },

  async play(): Promise<void> {
    const api = electronApi()
    if (!api || !(await this.isAvailable())) return
    await api.nativeAudioPlay()
  },

  async pause(): Promise<void> {
    const api = electronApi()
    if (!api || !(await this.isAvailable())) return
    await api.nativeAudioPause()
  },

  async stop(): Promise<void> {
    const api = electronApi()
    if (!api || !(await this.isAvailable())) return
    await api.nativeAudioStop()
  },

  async seek(seconds: number): Promise<void> {
    const api = electronApi()
    if (!api || !(await this.isAvailable())) return
    await api.nativeAudioSeek(seconds)
  },

  async getPlayheadSeconds(): Promise<number> {
    const api = electronApi()
    if (!api || !(await this.isAvailable())) return 0
    return api.nativeAudioGetPlayhead()
  },
}
