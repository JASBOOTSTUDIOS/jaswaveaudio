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

/** Frames por trozo de subida (estéreo f32 ≈ 1 MB → ~1,4 MB en base64): mensajes pequeños, UI fluida. */
export const CLIP_UPLOAD_CHUNK_FRAMES = 131_072

function f32ToBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  const parts: string[] = []
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + step) as unknown as number[]))
  }
  return btoa(parts.join(''))
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Sube PCM al host por trozos (`clip.loadBegin` → `clip.loadChunk`* → `clip.loadEnd`).
 * `fill` escribe en `dst` (interleaved, `channels` canales) los frames [offset, offset+n).
 * Nunca construye un mensaje del tamaño del clip entero: un clip largo ya no congela la UI ni
 * supera el límite de string de V8 (antes el RangeError se tragaba y el clip no sonaba).
 */
async function uploadPcmChunked(
  clipId: string,
  frames: number,
  channels: number,
  sampleRate: number,
  fill: (offset: number, n: number, dst: Float32Array) => void,
): Promise<boolean> {
  const api = electronApi()
  if (!api?.pluginHostSend || frames <= 0) return false
  const send = async (cmd: Record<string, unknown>) =>
    (await api.pluginHostSend!(cmd as never)) as { ok?: boolean }
  try {
    if (!(await send({ type: 'clip.loadBegin', clipId, frames, channels, sampleRate }))?.ok) return false
    const buf = new Float32Array(CLIP_UPLOAD_CHUNK_FRAMES * channels)
    for (let offset = 0; offset < frames; offset += CLIP_UPLOAD_CHUNK_FRAMES) {
      const n = Math.min(CLIP_UPLOAD_CHUNK_FRAMES, frames - offset)
      const view = n === CLIP_UPLOAD_CHUNK_FRAMES ? buf : buf.subarray(0, n * channels)
      fill(offset, n, view)
      const r = await send({
        type: 'clip.loadChunk',
        clipId,
        offsetFrames: offset,
        frames: n,
        pcmBase64: f32ToBase64(view),
      })
      if (!r?.ok) throw new Error('clip.loadChunk rechazado')
      await yieldToUi()
    }
    return !!(await send({ type: 'clip.loadEnd', clipId }))?.ok
  } catch (err) {
    console.warn('[host-transport] subida de clip fallida', clipId, err)
    try {
      await api.pluginHostSend({ type: 'clip.unload', clipId })
    } catch {
      /* ignore */
    }
    return false
  }
}

export function hostClipLoadPcm(
  clipId: string,
  interleaved: Float32Array,
  frames: number,
  channels: number,
  sampleRate: number,
): Promise<boolean> {
  return uploadPcmChunked(clipId, frames, channels, sampleRate, (offset, n, dst) => {
    dst.set(interleaved.subarray(offset * channels, (offset + n) * channels))
  })
}

/** Qué AudioBuffer subimos ya a cada clipId (evita reenviar el clip entero en cada play/seek). */
const uploadedBuffers = new Map<string, WeakRef<AudioBuffer>>()
const uploadsInFlight = new Map<string, Promise<boolean>>()

/**
 * Garantiza que el clip esté cargado en el host y devuelve true si se puede programar.
 * Reutiliza lo ya cargado (pregunta al host con `clip.has`, así un reinicio del host fuerza resubida).
 */
export function hostClipEnsureBuffer(clipId: string, buffer: AudioBuffer): Promise<boolean> {
  const pendiente = uploadsInFlight.get(clipId)
  if (pendiente) return pendiente
  const p = (async () => {
    const api = electronApi()
    if (!api?.pluginHostSend) return false
    if (uploadedBuffers.get(clipId)?.deref() === buffer) {
      try {
        const has = (await api.pluginHostSend({ type: 'clip.has', clipId })) as { ok?: boolean; loaded?: boolean }
        if (has?.ok && has.loaded) return true
      } catch {
        /* se resube */
      }
    }
    const ch = Math.min(2, buffer.numberOfChannels)
    const L = buffer.getChannelData(0)
    const R = ch > 1 ? buffer.getChannelData(1) : L
    const ok = await uploadPcmChunked(clipId, buffer.length, 2, buffer.sampleRate, (offset, n, dst) => {
      for (let i = 0; i < n; i++) {
        dst[i * 2] = L[offset + i] ?? 0
        dst[i * 2 + 1] = R[offset + i] ?? 0
      }
    })
    if (ok) uploadedBuffers.set(clipId, new WeakRef(buffer))
    else uploadedBuffers.delete(clipId)
    return ok
  })().finally(() => uploadsInFlight.delete(clipId))
  uploadsInFlight.set(clipId, p)
  return p
}

/** 0 lineal · 1 exponencial · 2 logarítmica (mismo código que el clip_player nativo). */
export type HostClipFades = {
  clipStartSample: number
  clipEndSample: number
  inSamples: number
  outSamples: number
  inCurve: number
  outCurve: number
  /** Clip invertido: región del audio de origen (muestras) que se lee al revés. */
  reverse?: boolean
  regionStartSample?: number
  regionLenSamples?: number
}

export function curvaFadeAHost(curva: unknown): number {
  return curva === 'exponencial' ? 1 : curva === 'logaritmica' ? 2 : 0
}

export function hostClipSchedule(opts: {
  clipId: string
  trackIndex: number
  startSample: number
  durationSamples: number
  sourceOffsetSamples?: number
  gain?: number
  pan?: number
  /** Fundidos sobre los límites del clip entero (muestras de la línea de tiempo). */
  fades?: HostClipFades
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
      ...(opts.fades
        ? {
            clipStartSample: opts.fades.clipStartSample,
            clipEndSample: opts.fades.clipEndSample,
            fadeInSamples: opts.fades.inSamples,
            fadeOutSamples: opts.fades.outSamples,
            fadeInCurve: opts.fades.inCurve,
            fadeOutCurve: opts.fades.outCurve,
            ...(opts.fades.reverse
              ? {
                  reverse: true,
                  regionStartSample: opts.fades.regionStartSample ?? 0,
                  regionLenSamples: opts.fades.regionLenSamples ?? 0,
                }
              : {}),
          }
        : {}),
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
