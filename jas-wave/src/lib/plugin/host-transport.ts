/**
 * Reloj + metrónomo + clips del Plugin Host (RPC).
 * Sustituye Web Audio para timeline / metro / clips live.
 */

export type HostTransportClock = {
  playing: boolean
  sampleRate: number
  samples: number
  tempo: number
  beatsPerBar: number
  ppqPos: number
  timelineSec: number
  metronome: boolean
}

let cachedClock: HostTransportClock = {
  playing: false,
  sampleRate: 48000,
  samples: 0,
  tempo: 120,
  beatsPerBar: 4,
  ppqPos: 0,
  timelineSec: 0,
  metronome: false,
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let pollInFlight = false
/** Detección de clock congelado (samples sin avanzar con playing=true). */
let lastSamplesSeen = -1
let lastSamplesAtMs = 0
let hostClockStalled = false

function electronApi(): {
  pluginHostSend?: (cmd: Record<string, unknown>) => Promise<unknown>
  pluginHostMidi?: (cmd: Record<string, unknown>) => Promise<unknown> | void
} | undefined {
  return typeof window !== 'undefined' ? window.electron : undefined
}

export function getCachedHostTransportClock(): HostTransportClock {
  return cachedClock
}

/** true si el host reporta playing pero samples no avanzan (~250ms+). */
export function isHostTransportClockStalled(): boolean {
  return hostClockStalled
}

function noteClockProgress(clock: HostTransportClock): void {
  const now = Date.now()
  if (!clock.playing) {
    hostClockStalled = false
    lastSamplesSeen = clock.samples
    lastSamplesAtMs = now
    return
  }
  if (clock.samples !== lastSamplesSeen) {
    lastSamplesSeen = clock.samples
    lastSamplesAtMs = now
    hostClockStalled = false
    return
  }
  if (lastSamplesAtMs > 0 && now - lastSamplesAtMs > 250) {
    hostClockStalled = true
  }
}

export async function fetchHostTransportClock(): Promise<HostTransportClock | null> {
  try {
    const api = electronApi()
    if (!api?.pluginHostSend) return null
    const raw = (await api.pluginHostSend({ type: 'getTransportClock' })) as Partial<HostTransportClock> & {
      ok?: boolean
    }
    if (!raw || raw.ok === false) return null
    cachedClock = {
      playing: !!raw.playing,
      sampleRate: Number(raw.sampleRate) || 48000,
      samples: Number(raw.samples) || 0,
      tempo: Number(raw.tempo) || 120,
      beatsPerBar: Number(raw.beatsPerBar) || 4,
      ppqPos: Number(raw.ppqPos) || 0,
      timelineSec: Number(raw.timelineSec) || 0,
      metronome: !!raw.metronome,
    }
    noteClockProgress(cachedClock)
    return cachedClock
  } catch {
    return null
  }
}

/** Poll suave para UI playhead (~30 Hz). */
export function startHostTransportClockPoll(intervalMs = 33): void {
  if (pollTimer) return
  void fetchHostTransportClock()
  pollTimer = setInterval(() => {
    if (pollInFlight) return
    pollInFlight = true
    void fetchHostTransportClock().finally(() => {
      pollInFlight = false
    })
  }, intervalMs)
}

export function stopHostTransportClockPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export function sendHostMetronomeSet(opts: {
  enabled: boolean
  bpm?: number
  beatsPerBar?: number
  volume?: number
}): void {
  try {
    const cmd = {
      type: 'metronome.set' as const,
      enabled: opts.enabled,
      ...(opts.bpm != null ? { bpm: opts.bpm } : {}),
      ...(opts.beatsPerBar != null ? { beatsPerBar: opts.beatsPerBar } : {}),
      ...(opts.volume != null ? { volume: opts.volume } : {}),
    }
    const api = electronApi()
    if (typeof api?.pluginHostMidi === 'function') {
      // fire-and-forget path shares stdin with MIDI for some cmds — use Send
    }
    void api?.pluginHostSend?.(cmd)
  } catch {
    /* ignore */
  }
}

export function sendHostTransport(opts: {
  playing: boolean
  tempo?: number
  ppqPos?: number
}): void {
  try {
    const cmd = {
      type: 'setTransport' as const,
      playing: opts.playing,
      ...(opts.tempo != null ? { tempo: opts.tempo } : {}),
      ...(opts.ppqPos != null ? { ppqPos: opts.ppqPos } : {}),
    }
    const api = electronApi()
    if (typeof api?.pluginHostMidi === 'function') {
      void api.pluginHostMidi(cmd)
      return
    }
    void api?.pluginHostSend?.(cmd)
  } catch {
    /* ignore */
  }
}

export async function hostClipLoadPath(clipId: string, path: string): Promise<boolean> {
  try {
    const api = electronApi()
    if (!api?.pluginHostSend) return false
    const raw = (await api.pluginHostSend({ type: 'clip.load', clipId, path })) as { ok?: boolean }
    return !!raw?.ok
  } catch {
    return false
  }
}

export async function hostClipLoadPcm(
  clipId: string,
  interleaved: Float32Array,
  frames: number,
  channels: number,
  sampleRate: number,
): Promise<boolean> {
  try {
    const api = electronApi()
    if (!api?.pluginHostSend) return false
    // base64 without Buffer (renderer)
    const bytes = new Uint8Array(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength)
    let bin = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    const pcmBase64 = btoa(bin)
    const raw = (await api.pluginHostSend({
      type: 'clip.load',
      clipId,
      pcmBase64,
      frames,
      channels,
      sampleRate,
    })) as { ok?: boolean }
    return !!raw?.ok
  } catch {
    return false
  }
}

export function hostClipSchedule(opts: {
  clipId: string
  trackIndex: number
  startSample: number
  durationSamples: number
  sourceOffsetSamples?: number
  gain?: number
  pan?: number
}): void {
  try {
    void electronApi()?.pluginHostSend?.({
      type: 'clip.schedule',
      clipId: opts.clipId,
      trackIndex: opts.trackIndex,
      startSample: opts.startSample,
      durationSamples: opts.durationSamples,
      sourceOffsetSamples: opts.sourceOffsetSamples ?? 0,
      gain: opts.gain ?? 1,
      pan: opts.pan ?? 0,
    })
  } catch {
    /* ignore */
  }
}

export function hostClipStopAll(): void {
  try {
    void electronApi()?.pluginHostSend?.({ type: 'clip.stopAll' })
  } catch {
    /* ignore */
  }
}
