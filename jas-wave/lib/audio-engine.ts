/**
 * Motor de Audio Web Audio API para Jaswave DAW.
 * 
 * Permite la carga de archivos de audio (WAV, MP3, OGG, WebM, FLAC),
 * la síntesis de clips de demostración (batería, bajo, sintetizador),
 * la reproducción sincronizada con la timeline y el control de ganancia,
 * paneo y medición en tiempo real para el mixer.
 */

import { routeMidiToActiveVst } from '@/src/lib/plugin/vst-voice-router'
import { allNotesOffAllTracks, sendVstCc, sendVstNote, setHostTransportPlaying } from '@/src/lib/plugin/track-vst-runtime'
import {
  getNativeMasterPeak,
  getNativeMaxStemPeak,
  getNativeTrackPeak,
  setMixMeterTrackOrder,
} from '@/src/lib/plugin/native-mix-meters'
import {
  getCachedHostTransportClock,
  hostClipLoadPath,
  hostClipLoadPcm,
  hostClipSchedule,
  hostClipStopAll,
  sendHostMetronomeSet,
  startHostTransportClockPoll,
  stopHostTransportClockPoll,
} from '@/src/lib/plugin/host-transport'
import pcmTapProcessorUrl from './pcm-tap-processor.js?url'
import { peakFromByteTimeDomain } from './audio-dsp'
import { ensureMicPermission, listAudioInputs, refreshAudioInputs } from '@/src/lib/audio-inputs'

export interface TrackAudioConfig {
  id: string
  volumen: number // 0.0 a 1.0 (o dB convertido)
  paneo: number // -1.0 (izquierda) a 1.0 (derecha)
  silenciada: boolean
  soloActiva: boolean
  /** Índice de stem en el graph del host (orden de pistas). */
  stemIndex?: number
  /** Slot del Plugin Host para el instrumento VST3 de esta pista. */
  vstInstrumentSlotId?: string
}

export interface AudioClipPlaybackInfo {
  id: string
  trackId: string
  inicio: number // en segundos
  duracion: number // en segundos
  sourcePathOrId: string
  clipInicio?: number // offset dentro del clip de audio en segundos
}

export interface MidiNotePlaybackInfo {
  pitch: number
  velocity: number
  /** Inicio absoluto en la timeline (segundos). */
  startSec: number
  /** Duración en segundos. */
  durationSec: number
}

export interface MidiClipPlaybackInfo {
  id: string
  trackId: string
  notes: MidiNotePlaybackInfo[]
  ccs?: Array<{ cc: number; timeSec: number; value: number }>
}

type TrackAudioNode = {
  gain: GainNode
  panner: StereoPannerNode
  analyser: AnalyserNode
  dataArray: Uint8Array<ArrayBuffer>
  stemTap?: AudioWorkletNode | ScriptProcessorNode
  stemSilent?: GainNode
  stemIndex?: number
}

type InputCaptureSession = {
  deviceKey: string
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  tap: AudioWorkletNode | ScriptProcessorNode
  silent: GainNode
  chunksL: Float32Array[]
  chunksR: Float32Array[]
  frames: number
  peak: number
  capturing: boolean
  monitors: Set<string>
}

export class WebAudioEngine {
  private audioCtx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private masterPanner: StereoPannerNode | null = null
  private masterAnalyser: AnalyserNode | null = null
  private masterMeterData: Uint8Array<ArrayBuffer> | null = null
  private masterVolume = 1.0
  private masterMuted = false
  private preferredSampleRate = 48000
  private nativeOutput = false
  private nativeBufferSize = 512
  private lastArmError: string | null = null
  /** Serializa armNative (scrub/play concurrentes rompían AudioContext). */
  private armInFlight: Promise<boolean> | null = null
  private pcmTap: ScriptProcessorNode | null = null
  private pcmWorklet: AudioWorkletNode | null = null
  private workletModuleReady = false
  private silentGain: GainNode | null = null
  private masterLimiter: DynamicsCompressorNode | null = null
  private tapScratch: Float32Array | null = null
  private tapInstalling: Promise<void> | null = null
  private trackNodes = new Map<string, TrackAudioNode>()
  private trackStemIndex = new Map<string, number>()
  private stemMode = false
  /**
   * Stems por pista desincronizan el named pipe bajo carga.
   * Clips / metrónomo van por mix master (1 stream); VSTs siguen en ASIO.
   */
  private allowStemMode = false
  private dawBusTap: AudioWorkletNode | ScriptProcessorNode | null = null
  private dawBusSilent: GainNode | null = null
  private stemScratch = new Map<string, Float32Array>()
  private audioBuffers = new Map<string, AudioBuffer>()
  private activeSources = new Map<string, AudioBufferSourceNode>()
  private midiScheduleTimer: ReturnType<typeof setInterval> | null = null
  private recSessions = new Map<string, InputCaptureSession>()
  private recTrackDevice = new Map<string, string>()
  private pendingMidiClips: MidiClipPlaybackInfo[] = []
  private pendingTracksConfig: TrackAudioConfig[] = []
  private midiScheduledUntilSec = 0
  private midiHaySolos = false
  private midiVoiceKeys = new Set<string>()
  private midiCcKeys = new Set<string>()
  /** Timers de noteOn/noteOff hacia el Plugin Host (playback VST). */
  private vstMidiTimers: ReturnType<typeof setTimeout>[] = []

  private isPlaying = false
  private startTime = 0
  private playheadStartSec = 0
  /** Epoch de pared para UI cuando sink none congela AudioContext.currentTime. */
  private playWallEpochMs = 0

  public setPreferredSampleRate(sr: number): void {
    if (sr >= 8000 && sr <= 192000) this.preferredSampleRate = sr
  }

  public usesNativeOutput(): boolean {
    return this.nativeOutput
  }

  public getSampleRate(): number {
    const host = getCachedHostTransportClock().sampleRate
    if (host >= 8000) return host
    return this.audioCtx?.sampleRate ?? this.preferredSampleRate
  }

  /** Playhead — reloj de samples del Plugin Host. */
  public getTimelineSeconds(): number {
    if (this.isPlaying) {
      const host = getCachedHostTransportClock()
      if (host.playing || host.timelineSec > 0) return Math.max(0, host.timelineSec)
      if (this.playWallEpochMs > 0) {
        return this.playheadStartSec + Math.max(0, (performance.now() - this.playWallEpochMs) / 1000)
      }
    }
    return this.playheadStartSec
  }

  public getAudibleTimelineSeconds(): number {
    return this.getTimelineSeconds()
  }

  public nativePathAheadSec(): number {
    const sr = this.getSampleRate()
    const buf = this.nativeBufferSize > 0 ? this.nativeBufferSize : 512
    return (buf * 2) / sr
  }

  private resetPcmPace(): void {
    /* no-op: PCM pace was for Web→pipe; live path is host-only */
  }

  public async rearmAfterDeviceChange(sampleRate?: number): Promise<boolean> {
    if (sampleRate && sampleRate >= 8000) this.setPreferredSampleRate(sampleRate)
    this.nativeOutput = false
    return this.armNativeMixOutput()
  }

  public getMasterSpectrum(out?: Uint8Array): Uint8Array {
    const buf = out ?? new Uint8Array(128)
    if (this.masterAnalyser) {
      try {
        this.masterAnalyser.getByteFrequencyData(buf as Uint8Array<ArrayBuffer>)
        return buf
      } catch {
        /* ignore */
      }
    }
    buf.fill(0)
    return buf
  }

  public getMasterTimeDomain(out?: Uint8Array): Uint8Array {
    const buf = out ?? new Uint8Array(256)
    if (this.masterAnalyser) {
      try {
        this.masterAnalyser.getByteTimeDomainData(buf as Uint8Array<ArrayBuffer>)
        return buf
      } catch {
        /* ignore */
      }
    }
    buf.fill(128)
    return buf
  }

  public getTimingDiagnostics(): {
    sampleRate: number
    bufferSize: number
    nativeOutput: boolean
    pathAheadSec: number
    pathAheadMs: number
    timelineSec: number
    audibleSec: number
    skewMs: number
    playing: boolean
    lastArmError: string | null
  } {
    const ahead = this.nativeOutput ? this.nativePathAheadSec() : 0
    const timeline = this.getTimelineSeconds()
    return {
      sampleRate: this.getSampleRate(),
      bufferSize: this.nativeBufferSize || 512,
      nativeOutput: this.nativeOutput,
      pathAheadSec: ahead,
      pathAheadMs: ahead * 1000,
      timelineSec: timeline,
      audibleSec: timeline,
      skewMs: 0,
      playing: this.isPlaying,
      lastArmError: this.lastArmError,
    }
  }

  private notifyMixInputRate(): void {
    try {
      const sr = this.getSampleRate()
      void window.electron?.pluginHostSend?.({ type: 'setMixInputRate', sampleRate: sr })
    } catch {
      /* ignore */
    }
  }

  public setNativeOutput(on: boolean, _force = false): void {
    this.nativeOutput = on && typeof window !== 'undefined' && !!window.electron?.pluginHostSend
  }

  public async armNativeMixOutput(): Promise<boolean> {
    if (this.armInFlight) return this.armInFlight
    this.armInFlight = this.armNativeMixOutputUnlocked().finally(() => {
      this.armInFlight = null
    })
    return this.armInFlight
  }

  private async armNativeMixOutputUnlocked(): Promise<boolean> {
    this.lastArmError = null
    const api = typeof window !== 'undefined' ? window.electron : undefined
    if (typeof window !== 'undefined') {
      try {
        const q = new URLSearchParams(window.location.search)
        if (q.get('undock') || window.location.hash.replace(/^#/, '').startsWith('undock/')) {
          this.lastArmError = 'undock-window'
          this.nativeOutput = false
          return false
        }
      } catch {
        /* ignore */
      }
    }
    if (!api?.pluginHostEnsure || !api.pluginHostSend) {
      this.lastArmError = 'no-plugin-host-api'
      this.nativeOutput = false
      return false
    }
    if (this.nativeOutput) return true
    try {
      let ens = await api.pluginHostEnsure()
      let st = ens as { backend?: string } | undefined
      if (!st || st.backend === 'none' || !st.backend) {
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 100 + i * 80))
          ens = await api.pluginHostEnsure()
          st = ens as { backend?: string } | undefined
          if (st?.backend === 'native') break
        }
      }
      if (st?.backend && st.backend !== 'native') {
        this.lastArmError = `host-backend=${st.backend}`
        this.nativeOutput = false
        return false
      }
      let raw = (await Promise.race([
        api.pluginHostSend({ type: 'ensureAudio' }),
        new Promise<null>((r) => setTimeout(() => r(null), 4000)),
      ])) as { ok?: boolean; audio?: { sampleRate?: number; bufferSize?: number } } | null
      if (!raw || raw.ok === false) {
        await new Promise((r) => setTimeout(r, 250))
        raw = (await Promise.race([
          api.pluginHostSend({ type: 'ensureAudio' }),
          new Promise<null>((r) => setTimeout(() => r(null), 4000)),
        ])) as { ok?: boolean; audio?: { sampleRate?: number; bufferSize?: number } } | null
      }
      if (!raw || raw.ok === false) {
        this.lastArmError = 'ensureAudio-failed'
        this.nativeOutput = false
        return false
      }
      if (raw.audio?.sampleRate) this.setPreferredSampleRate(raw.audio.sampleRate)
      const bufSz = raw.audio?.bufferSize
      if (bufSz && bufSz >= 16 && bufSz <= 8192) this.nativeBufferSize = bufSz
      this.nativeOutput = true
      this.notifyMixInputRate()
      startHostTransportClockPoll()
      return true
    } catch (err) {
      this.lastArmError = err instanceof Error ? err.message : 'arm-exception'
      this.nativeOutput = false
      return false
    }
  }

  private canPushNativePcm(): boolean {
    return typeof window !== 'undefined' && typeof window.electron?.pluginHostPushPcm === 'function'
  }

  private pendingChromiumSink: string | { type: string } | undefined

  private createLiveContext(sampleRate: number): AudioContext {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext
    const sink = this.pendingChromiumSink
    const attempts: unknown[] = sink
      ? [
          { latencyHint: 'interactive', sampleRate, sinkId: sink },
          { latencyHint: 'interactive', sinkId: sink },
          { latencyHint: 'interactive', sampleRate },
          { latencyHint: 'interactive' },
        ]
      : [
          { latencyHint: 'interactive', sampleRate },
          { latencyHint: 'interactive' },
        ]
    for (const opts of attempts) {
      try {
        return new AudioCtxClass(opts as AudioContextOptions)
      } catch {
        /* siguiente */
      }
    }
    return new AudioCtxClass()
  }

  /** Mantiene el grafo Web Audio vivo aunque la salida vaya a gain≈0 (stems → pipe).
   * Gain exactamente 0 puede hacer que Chromium deje de procesar el grafo. */
  private mixKeepAlive: { osc: OscillatorNode; gain: GainNode } | null = null
  private ensureMixGraphKeepAlive(): void {
    /* live path = host only; no Web Audio keep-alive */
  }


  private async preferredChromiumSink(
    backend?: string,
  ): Promise<string | { type: string } | undefined> {
    if (!backend) return undefined
    // Un solo reloj: Chromium no debe abrir otro device (ni la UMC). El grafo sigue vivo con sink none.
    return { type: 'none' }
  }

  private async releaseInterfaceFromChromium(backend?: string): Promise<void> {
    if (!backend) return
    const ctx = this.audioCtx as
      | (AudioContext & { setSinkId?: (id: string | { type: string }) => Promise<void> })
      | null
    if (!ctx?.setSinkId) return
    try {
      await ctx.setSinkId({ type: 'none' })
    } catch {
      /* Chromium sin sink none */
    }
  }

  /**
   * Contexto solo para decode/createBuffer (Offline). No conecta a speakers.
   * El path live es 100% Plugin Host.
   */
  public ensureContext(): AudioContext {
    if (this.audioCtx && (this.audioCtx as AudioContext).state !== 'closed') {
      return this.audioCtx
    }
    const Offline =
      typeof OfflineAudioContext !== 'undefined'
        ? OfflineAudioContext
        : (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
            .webkitOfflineAudioContext
    if (!Offline) {
      // Último recurso: AudioContext sin usar destination para decode.
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext
      this.audioCtx = new AudioCtxClass({ sampleRate: this.preferredSampleRate })
      try {
        this.audioCtx.suspend()
      } catch {
        /* ignore */
      }
      return this.audioCtx
    }
    const offline = new Offline(2, 128, this.preferredSampleRate) as unknown as AudioContext
    this.audioCtx = offline
    this.masterGain = null
    this.masterPanner = null
    this.masterAnalyser = null
    this.masterMeterData = null
    return this.audioCtx
  }

  public getContext(): AudioContext | null {
    return this.audioCtx
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume))
    this.applyMasterGain()
  }

  public setMasterPan(pan: number): void {
    const clamped = Math.max(-1, Math.min(1, pan))
    const ctx = this.audioCtx
    if (ctx && this.masterPanner) {
      this.masterPanner.pan.setTargetAtTime(clamped, ctx.currentTime, 0.02)
    } else if (this.masterPanner) {
      this.masterPanner.pan.value = clamped
    }
  }

  public setMasterMuted(muted: boolean): void {
    this.masterMuted = muted
    this.applyMasterGain()
  }

  private applyMasterGain(): void {
    const effectiveGain = this.masterMuted ? 0 : this.masterVolume
    const ctx = this.audioCtx
    if (ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(effectiveGain, ctx.currentTime, 0.02)
    } else if (this.masterGain) {
      this.masterGain.gain.value = effectiveGain
    }
  }

  public getTrackNode(trackId: string) {
    const ctx = this.ensureContext()
    const existing = this.trackNodes.get(trackId)
    if (existing && existing.analyser.context !== ctx) {
      this.trackNodes.delete(trackId)
    }
    if (!this.trackNodes.has(trackId)) {
      const gain = ctx.createGain()
      const panner = ctx.createStereoPanner()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0
      const dataArray = new Uint8Array(analyser.fftSize)

      gain.connect(panner)
      panner.connect(analyser)
      const created: TrackAudioNode = { gain, panner, analyser, dataArray }
      if (this.stemMode && this.nativeOutput) {
        this.attachStemTap(trackId, created)
      } else if (this.masterGain && this.masterGain.context === ctx) {
        analyser.connect(this.masterGain)
      }

      this.trackNodes.set(trackId, created)
    }
    const node = this.trackNodes.get(trackId)!
    if (this.stemMode && this.nativeOutput && !node.stemTap) {
      try {
        if (this.masterGain) node.analyser.disconnect(this.masterGain)
      } catch {
        /* ignore */
      }
      this.attachStemTap(trackId, node)
    }
    return node
  }

  private attachStemTap(_trackId: string, node: TrackAudioNode) {
    /* stem PCM tap removed — audio live = host */
    void node
  }

  private makePcmTap(
    _ctx: AudioContext,
    _stemIndex: number,
  ): AudioWorkletNode | ScriptProcessorNode {
    throw new Error('PCM tap removed')
  }

  private onWorkletPcm(_data: unknown): void {}
  private onPcmTap(_ev: AudioProcessingEvent): void {}
  private attachTapGraph(): void {}
  private disconnectTapGraph(): void {}
  private attachDawBusTap(): void {}

  /** Asigna índices de stem y, si allowStemMode, activa dry por pista → host. */
  public setTrackStemLayout(trackIds: string[]): void {
    this.trackStemIndex.clear()
    trackIds.forEach((id, i) => {
      if (i < 64) this.trackStemIndex.set(id, i)
    })
    setMixMeterTrackOrder(trackIds)
    const wantStem = this.allowStemMode && this.nativeOutput && trackIds.length > 0
    if (wantStem === this.stemMode) {
      if (wantStem) {
        for (const [id, node] of this.trackNodes) {
          if (node.stemTap) {
            try {
              node.analyser.disconnect(node.stemTap)
              node.stemTap.disconnect()
              node.stemSilent?.disconnect()
            } catch {
              /* ignore */
            }
            node.stemTap = undefined
            node.stemSilent = undefined
          }
          this.attachStemTap(id, node)
        }
      } else if (this.nativeOutput) {
        // Master-mix: limpiar taps de stem huérfanos y asegurar tap del master.
        for (const [, node] of this.trackNodes) {
          if (!node.stemTap) continue
          try {
            node.analyser.disconnect(node.stemTap)
            node.stemTap.disconnect()
            node.stemSilent?.disconnect()
          } catch {
            /* ignore */
          }
          node.stemTap = undefined
          node.stemSilent = undefined
          if (this.masterGain) {
            try {
              node.analyser.connect(this.masterGain)
            } catch {
              /* ignore */
            }
          }
        }
        this.attachTapGraph()
      }
      return
    }
    this.stemMode = wantStem
    this.rewireTrackGraphForStemMode()
  }

  private rewireTrackGraphForStemMode() {
    if (!this.audioCtx || !this.masterGain) return
    for (const [id, node] of this.trackNodes) {
      try {
        node.analyser.disconnect()
      } catch {
        /* ignore */
      }
      if (node.stemTap) {
        try {
          node.stemTap.disconnect()
          node.stemSilent?.disconnect()
        } catch {
          /* ignore */
        }
        node.stemTap = undefined
        node.stemSilent = undefined
      }
      if (this.stemMode && this.nativeOutput) {
        this.attachStemTap(id, node)
      } else {
        node.analyser.connect(this.masterGain)
      }
    }
    // En stem mode el master suele ir vacío; no bombear silencio al bus DAW.
    this.disconnectTapGraph()
  }

  public updateTrackControls(trackId: string, volumen: number, paneo: number, silenciada: boolean, haySolosActivos: boolean, soloActiva: boolean) {
    const node = this.getTrackNode(trackId)
    const ctx = this.audioCtx

    // En modo stem Reaper el fader/pan viven en el host; aquí solo mute temprano.
    let effectiveGain = Math.max(0, Math.min(1, volumen))
    let effectivePan = Math.max(-1, Math.min(1, paneo))
    if (haySolosActivos) {
      if (!soloActiva) effectiveGain = 0
    } else if (silenciada) {
      effectiveGain = 0
    }
    if (this.stemMode && this.nativeOutput) {
      effectiveGain = effectiveGain <= 0 ? 0 : 1
      effectivePan = 0
    }

    if (ctx) {
      node.gain.gain.setTargetAtTime(effectiveGain, ctx.currentTime, 0.02)
      node.panner.pan.setTargetAtTime(effectivePan, ctx.currentTime, 0.02)
    } else {
      node.gain.gain.value = effectiveGain
      node.panner.pan.value = effectivePan
    }
  }

  /**
   * Aplica mute/solo/volumen/paneo en caliente sin reiniciar fuentes.
   * Actualiza también el scheduler MIDI pendiente.
   */
  public applyTracksConfig(tracksConfig: TrackAudioConfig[]) {
    const haySolos = tracksConfig.some((t) => t.soloActiva)
    this.pendingTracksConfig = tracksConfig
    this.midiHaySolos = haySolos
    for (const trk of tracksConfig) {
      this.updateTrackControls(trk.id, trk.volumen, trk.paneo, trk.silenciada, haySolos, trk.soloActiva)
    }
  }

  public async decodeAudioFile(key: string, file: File): Promise<{ buffer: AudioBuffer; duration: number }> {
    const ctx = this.ensureContext()
    const arrayBuffer = await file.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    this.audioBuffers.set(key, audioBuffer)
    return { buffer: audioBuffer, duration: audioBuffer.duration }
  }

  public async decodeArrayBuffer(key: string, arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensureContext()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    this.audioBuffers.set(key, audioBuffer)
    return audioBuffer
  }

  public setAudioBuffer(key: string, buffer: AudioBuffer) {
    this.audioBuffers.set(key, buffer)
  }

  public getAudioBuffer(key: string): AudioBuffer | undefined {
    return this.audioBuffers.get(key)
  }

  public listAudioBufferKeys(): string[] {
    return Array.from(this.audioBuffers.keys())
  }

  /** Serializa buffers en memoria para persistencia (IndexedDB / sesión). */
  public exportAudioBuffersForPersist(): Record<
    string,
    { sampleRate: number; length: number; numberOfChannels: number; channels: ArrayBuffer[] }
  > {
    const out: Record<
      string,
      { sampleRate: number; length: number; numberOfChannels: number; channels: ArrayBuffer[] }
    > = {}
    const maxTotal = 12 * 1024 * 1024
    const maxOne = 8 * 1024 * 1024
    let total = 0
    for (const [key, buf] of this.audioBuffers) {
      if (key.startsWith('demo-')) continue
      const bytes = buf.length * Math.max(1, buf.numberOfChannels) * 4
      if (bytes > maxOne || total + bytes > maxTotal) continue
      const channels: ArrayBuffer[] = []
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const copy = new Float32Array(buf.length)
        copy.set(buf.getChannelData(c))
        channels.push(copy.buffer)
      }
      out[key] = {
        sampleRate: buf.sampleRate,
        length: buf.length,
        numberOfChannels: buf.numberOfChannels,
        channels,
      }
      total += bytes
    }
    return out
  }

  public restoreAudioBuffersFromPersist(
    data: Record<
      string,
      { sampleRate: number; length: number; numberOfChannels: number; channels: ArrayBuffer[] }
    >,
  ): void {
    const ctx = this.ensureContext()
    for (const [key, meta] of Object.entries(data)) {
      if (!meta?.channels?.length) continue
      const buffer = ctx.createBuffer(meta.numberOfChannels, meta.length, meta.sampleRate)
      for (let c = 0; c < meta.numberOfChannels; c++) {
        const src = new Float32Array(meta.channels[c])
        buffer.copyToChannel(src, c)
      }
      this.audioBuffers.set(key, buffer)
    }
  }

  public setSynthGain(_value: number): void {
    /* Soft Pad Web Audio eliminado — JasWave Roles VST. */
  }

  /** Preview MIDI: solo VST de la pista preferida / activa. */
  public noteOn(pitch: number, velocity = 90): void {
    routeMidiToActiveVst(true, pitch, velocity)
  }

  /** Preview MIDI: nota apagada. */
  public noteOff(pitch: number, _releaseSec = 0.25): void {
    routeMidiToActiveVst(false, pitch, 0)
  }

  public allNotesOff(): void {
    allNotesOffAllTracks()
  }

  /**
   * Sintetizador procedural para generar pistas de demo con sonido real (Drums, Bass, Chords, Lead)
   */
  public generateDemoBuffer(type: 'drums' | 'bass' | 'chords' | 'lead' | 'synth', durationSec = 16): AudioBuffer {
    const sampleRate = this.audioCtx?.sampleRate ?? this.preferredSampleRate
    const length = Math.floor(sampleRate * durationSec)
    const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate })
    const left = buffer.getChannelData(0)
    const right = buffer.getChannelData(1)

    const bpm = 134
    const secondsPerBeat = 60 / bpm

    if (type === 'drums') {
      // Bombo (Kick), Tarola (Snare), HiHat
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate
        const beatPosition = (t / secondsPerBeat) % 4
        
        let kick = 0
        const kickSubBeat = beatPosition % 1
        if (kickSubBeat < 0.25) {
          const freq = 120 * Math.exp(-kickSubBeat * 30)
          kick = Math.sin(2 * Math.PI * freq * kickSubBeat) * Math.exp(-kickSubBeat * 15) * 0.8
        }

        let snare = 0
        const snareBeat = (beatPosition + 3) % 2
        if (snareBeat < 0.2) {
          const noise = (Math.random() * 2 - 1) * Math.exp(-snareBeat * 20)
          const tone = Math.sin(2 * Math.PI * 220 * snareBeat) * Math.exp(-snareBeat * 30)
          snare = (noise * 0.6 + tone * 0.4) * 0.6
        }

        let hihat = 0
        const hihatSub = (t / secondsPerBeat) % 0.5
        if (hihatSub < 0.05) {
          hihat = (Math.random() * 2 - 1) * Math.exp(-hihatSub * 60) * 0.2
        }

        const out = kick + snare + hihat
        left[i] = out
        right[i] = out
      }
    } else if (type === 'bass') {
      const notes = [55, 55, 65, 58, 55, 62, 58, 60]
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate
        const step = Math.floor((t / (secondsPerBeat / 2)) % notes.length)
        const noteFreq = notes[step]
        const subBeat = (t / (secondsPerBeat / 2)) % 1
        
        const env = Math.exp(-subBeat * 4)
        const phase = (t * noteFreq) % 1
        const saw = (phase * 2 - 1) * env * 0.5
        
        left[i] = saw
        right[i] = saw
      }
    } else if (type === 'chords') {
      const chords = [
        [220, 261.63, 329.63],
        [174.61, 220, 261.63],
        [261.63, 329.63, 392],
        [196, 246.94, 293.66],
      ]
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate
        const chordIndex = Math.floor((t / (secondsPerBeat * 4)) % chords.length)
        const currentChord = chords[chordIndex]
        let chordOut = 0

        for (const freq of currentChord) {
          chordOut += Math.sin(2 * Math.PI * freq * t) * 0.15
        }

        const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * (t / (secondsPerBeat * 2)))
        left[i] = chordOut * env
        right[i] = chordOut * env
      }
    } else {
      const arpeggio = [440, 523.25, 659.25, 783.99, 659.25, 523.25]
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate
        const step = Math.floor((t / (secondsPerBeat / 4)) % arpeggio.length)
        const freq = arpeggio[step]
        const subBeat = (t / (secondsPerBeat / 4)) % 1
        const env = Math.exp(-subBeat * 6)
        const val = Math.sin(2 * Math.PI * freq * t) * env * 0.3

        left[i] = val
        right[i] = val
      }
    }

    return buffer
  }

  /**
   * Inicia la reproduccion de clips de audio + MIDI en la timeline desde `startSec`.
   * Audio clips → Plugin Host; MIDI → noteOn/Off con delay en samples del host.
   */
  public playClips(
    startSec: number,
    clips: AudioClipPlaybackInfo[],
    tracksConfig: TrackAudioConfig[],
    midiClips: MidiClipPlaybackInfo[] = [],
  ) {
    this.stopAllSources()

    this.isPlaying = true
    this.playheadStartSec = Math.max(0, startSec)
    this.playWallEpochMs = performance.now()
    this.startTime = 0
    this.resetPcmPace()
    startHostTransportClockPoll()
    const sr = this.getSampleRate()
    const tempoGuess = getCachedHostTransportClock().tempo || 120
    setHostTransportPlaying(true, tempoGuess, (this.playheadStartSec * tempoGuess) / 60)
    hostClipStopAll()

    const haySolos = tracksConfig.some((t) => t.soloActiva)
    const cfgById = new Map(tracksConfig.map((t, i) => [t.id, { ...t, stemIndex: t.stemIndex ?? i }]))
    for (const trk of tracksConfig) {
      this.updateTrackControls(trk.id, trk.volumen, trk.paneo, trk.silenciada, haySolos, trk.soloActiva)
    }

    void (async () => {
      for (const clip of clips) {
        try {
          const cfg = cfgById.get(clip.trackId)
          if (haySolos) {
            if (!cfg?.soloActiva) continue
          } else if (cfg?.silenciada) {
            continue
          }
          const buffer = this.audioBuffers.get(clip.sourcePathOrId) || this.audioBuffers.get(clip.id)
          const clipStart = clip.inicio
          const clipDuration = clip.duracion || buffer?.duration || 0
          const clipEnd = clipStart + clipDuration
          if (this.playheadStartSec >= clipEnd || clipDuration <= 0) continue

          let offset = 0
          let delay = 0
          let consumed = 0
          if (this.playheadStartSec > clipStart) {
            consumed = this.playheadStartSec - clipStart
            offset = consumed + (clip.clipInicio || 0)
          } else {
            delay = clipStart - this.playheadStartSec
          }
          const remainingDuration = Math.max(0, clipDuration - consumed)
          if (remainingDuration <= 0.001) continue

          const pathLike =
            clip.sourcePathOrId.includes('\\') ||
            clip.sourcePathOrId.includes('/') ||
            /\.(wav|flac|mp3|ogg|aiff?)$/i.test(clip.sourcePathOrId)
          let loaded = false
          if (pathLike) {
            loaded = await hostClipLoadPath(clip.id, clip.sourcePathOrId)
          }
          if (!loaded && buffer) {
            const ch = Math.min(2, buffer.numberOfChannels)
            const frames = buffer.length
            const interleaved = new Float32Array(frames * 2)
            const L = buffer.getChannelData(0)
            const R = ch > 1 ? buffer.getChannelData(1) : L
            for (let i = 0; i < frames; i++) {
              interleaved[i * 2] = L[i] ?? 0
              interleaved[i * 2 + 1] = R[i] ?? 0
            }
            loaded = await hostClipLoadPcm(clip.id, interleaved, frames, 2, buffer.sampleRate)
          }
          if (!loaded) continue

          const stem = cfg?.stemIndex ?? 0
          const startSample = Math.round((this.playheadStartSec + delay) * sr)
          const durationSamples = Math.round(remainingDuration * sr)
          const sourceOffsetSamples = Math.round(offset * sr)
          const gain = cfg?.silenciada && !haySolos ? 0 : cfg?.volumen ?? 1
          const pan = cfg?.paneo ?? 0
          hostClipSchedule({
            clipId: clip.id,
            trackIndex: stem,
            startSample,
            durationSamples,
            sourceOffsetSamples,
            gain,
            pan,
          })
        } catch (err) {
          console.warn('[audio-engine] host clip start failed', clip.id, err)
        }
      }
    })()

    try {
      this.beginMidiScheduler(midiClips, tracksConfig, haySolos)
    } catch (err) {
      console.warn('[audio-engine] midi schedule failed', err)
    }
  }

  private midiClipNoteCursor = new Map<string, number>()

  private beginMidiScheduler(
    midiClips: MidiClipPlaybackInfo[],
    tracksConfig: TrackAudioConfig[],
    haySolos: boolean,
  ) {
    this.stopMidiScheduler()
    this.midiVoiceKeys.clear()
    this.midiCcKeys.clear()
    this.midiClipNoteCursor.clear()
    // Ordenar notas una vez para el cursor O(ventana).
    this.pendingMidiClips = midiClips.map((c) => ({
      ...c,
      notes: [...c.notes].sort((a, b) => a.startSec - b.startSec || a.pitch - b.pitch),
    }))
    this.pendingTracksConfig = tracksConfig
    this.midiHaySolos = haySolos
    this.midiScheduledUntilSec = this.playheadStartSec

    this.scheduleMidiLookahead()
    this.midiScheduleTimer = setInterval(() => {
      if (!this.isPlaying) {
        this.stopMidiScheduler()
        return
      }
      this.scheduleMidiLookahead()
    }, 80)
  }

  /** Hot-patch: slot VST confirmado en runtime. */
  public patchTrackVstInstrument(trackId: string, slotId: string | undefined): void {
    const prev = this.pendingTracksConfig.find((t) => t.id === trackId)
    const slotChanged = Boolean(slotId) && slotId !== prev?.vstInstrumentSlotId
    this.pendingTracksConfig = this.pendingTracksConfig.map((t) =>
      t.id === trackId ? { ...t, vstInstrumentSlotId: slotId } : t,
    )
    // Notas saltadas mientras el slot no existía: reabrir la ventana actual.
    if (slotChanged && this.isPlaying) {
      const nowTimeline = this.getTimelineSeconds()
      this.midiScheduledUntilSec = Math.min(this.midiScheduledUntilSec, nowTimeline)
      this.scheduleMidiLookahead()
    }
  }

  private stopMidiScheduler() {
    if (this.midiScheduleTimer) {
      clearInterval(this.midiScheduleTimer)
      this.midiScheduleTimer = null
    }
    for (const t of this.vstMidiTimers) clearTimeout(t)
    this.vstMidiTimers = []
    allNotesOffAllTracks()
  }

  /** Programa MIDI por ventanas sin AudioContext (reloj host). */
  private scheduleMidiLookahead() {
    if (!this.isPlaying) return
    const horizon = 0.85
    const from = this.midiScheduledUntilSec
    const nowTimeline = this.getTimelineSeconds()
    const windowStart = Math.max(from, nowTimeline - 0.05)
    const windowEnd = nowTimeline + horizon
    if (windowEnd <= windowStart) return

    this.scheduleMidiClipsInWindow(windowStart, windowEnd)
    this.midiScheduledUntilSec = windowEnd
  }

  private scheduleMidiClipsInWindow(windowStart: number, windowEnd: number) {
    const sr = this.getSampleRate()
    const nowTimeline = this.getTimelineSeconds()
    const cfgById = new Map(this.pendingTracksConfig.map((t) => [t.id, t]))

    for (const clip of this.pendingMidiClips) {
      const cfg = cfgById.get(clip.trackId)
      if (this.midiHaySolos) {
        if (!cfg?.soloActiva) continue
      } else if (cfg?.silenciada) {
        continue
      }

      const vstSlot = cfg?.vstInstrumentSlotId
      if (!vstSlot) continue

      let ni = this.midiClipNoteCursor.get(clip.id) ?? 0
      while (ni < clip.notes.length) {
        const early = clip.notes[ni]!
        const earlyEnd = early.startSec + Math.max(0.03, early.durationSec)
        if (earlyEnd > windowStart) break
        ni += 1
      }
      this.midiClipNoteCursor.set(clip.id, ni)

      for (; ni < clip.notes.length; ni++) {
        const note = clip.notes[ni]!
        const noteStart = note.startSec
        if (noteStart > windowEnd) break
        const durRaw = Math.max(0.03, note.durationSec)
        const noteEnd = noteStart + durRaw
        if (noteEnd <= windowStart) continue
        const key = clip.id + ':' + ni + ':' + note.pitch + ':' + noteStart.toFixed(4)
        if (this.midiVoiceKeys.has(key)) continue

        let dur = durRaw
        let whenSec = noteStart
        if (noteStart < this.playheadStartSec) {
          dur = noteEnd - this.playheadStartSec
          whenSec = this.playheadStartSec
        }
        if (dur <= 0.02) continue

        try {
          this.scheduleVstMidiNote(vstSlot, note.pitch, note.velocity, whenSec, dur, nowTimeline, sr)
          this.midiVoiceKeys.add(key)
        } catch (err) {
          console.warn('[audio-engine] midi voice failed', err)
        }
      }

      const ccs = clip.ccs ?? []
      for (let ci = 0; ci < ccs.length; ci++) {
        const ev = ccs[ci]!
        if (ev.timeSec < windowStart - 0.02 || ev.timeSec > windowEnd) continue
        const key = clip.id + ':cc:' + ev.cc + ':' + ev.timeSec.toFixed(4)
        if (this.midiCcKeys.has(key)) continue
        const delay = Math.max(
          0,
          Math.round((ev.timeSec - nowTimeline + this.nativePathAheadSec()) * sr),
        )
        sendVstCc(vstSlot, ev.cc, ev.value, delay)
        this.midiCcKeys.add(key)
      }
    }
  }

  /** Playback MIDI → Plugin Host (slot ya loaded/prepared). */
  private scheduleVstMidiNote(
    slotId: string,
    pitch: number,
    velocity: number,
    whenSec: number,
    durationSec: number,
    nowTimeline = this.getTimelineSeconds(),
    sr = this.getSampleRate(),
  ) {
    const delayOn = Math.max(
      0,
      Math.round((whenSec - nowTimeline + this.nativePathAheadSec()) * sr),
    )
    const delayOff = delayOn + Math.max(32, Math.round(durationSec * sr))
    sendVstNote(slotId, true, pitch, velocity, delayOn)
    sendVstNote(slotId, false, pitch, 0, delayOff)
  }

  /**
   * Detiene todos los nodos de fuente activos
   */
  public stopAllSources() {
    // Primero panic MIDI (antes de parar transport) para vaciar colas delaySamples.
    try {
      this.allNotesOff()
    } catch {
      /* ignore */
    }
    this.stopMidiScheduler()
    setHostTransportPlaying(false)
    // Segundo panic tras setTransport(false): VSTs cortan al ver !kPlaying.
    try {
      this.allNotesOff()
    } catch {
      /* ignore */
    }
    hostClipStopAll()
    stopHostTransportClockPoll()
    this.pendingMidiClips = []
    this.midiVoiceKeys.clear()
    this.midiCcKeys.clear()
    for (const source of this.activeSources.values()) {
      try {
        source.stop()
        source.disconnect()
      } catch {
        // Ignorar
      }
    }
    this.activeSources.clear()

    if (this.isPlaying) {
      this.playheadStartSec = this.getTimelineSeconds()
    }
    this.isPlaying = false
    this.playWallEpochMs = 0
  }

  public getMeterLevel(trackId: string): number {
    let native = 0
    if (this.usesNativeOutput()) {
      const p = getNativeTrackPeak(trackId)
      if (p != null) native = p
    }
    const node = this.trackNodes.get(trackId)
    let web = 0
    if (node) {
      node.analyser.getByteTimeDomainData(node.dataArray)
      web = peakFromByteTimeDomain(node.dataArray)
    }
    // Preferir lo que se mueva: VST vive en el host; clips en Web Audio.
    const peak = Math.max(native, web)
    // Curva suave para VU legible a niveles bajos (-24 dB ≈ visible).
    if (peak <= 0) return 0
    return Math.min(1, Math.pow(peak, 0.6))
  }

  public getMasterMeterLevel(): number {
    let native = 0
    if (this.usesNativeOutput()) {
      native = Math.max(getNativeMasterPeak(), getNativeMaxStemPeak())
    }
    let web = 0
    if (this.masterAnalyser && this.masterMeterData) {
      this.masterAnalyser.getByteTimeDomainData(this.masterMeterData)
      web = peakFromByteTimeDomain(this.masterMeterData)
    }
    const peak = Math.max(native, web)
    if (peak <= 0) return 0
    return Math.min(1, Math.pow(peak, 0.6))
  }

  public getInputMeterLevel(deviceOrTrackId?: string): number {
    if (!deviceOrTrackId) {
      let max = 0
      for (const s of this.recSessions.values()) if (s.peak > max) max = s.peak
      return max
    }
    const byTrack = this.recTrackDevice.get(deviceOrTrackId)
    const session = this.recSessions.get(byTrack ?? deviceOrTrackId) ?? this.recSessions.get(deviceOrTrackId)
    return session?.peak ?? 0
  }

  public isCapturingInput(deviceKey?: string): boolean {
    if (deviceKey == null) {
      for (const s of this.recSessions.values()) if (s.capturing) return true
      return false
    }
    return Boolean(this.recSessions.get(deviceKey)?.capturing)
  }

  public listAudioInputs() {
    return listAudioInputs()
  }

  public async ensureMicPermission(): Promise<boolean> {
    return ensureMicPermission()
  }

  public async refreshAudioInputs() {
    return refreshAudioInputs()
  }

  private sessionKey(deviceId?: string | null): string {
    return (deviceId ?? '').trim()
  }

  private async ensureWorkletModule(ctx: AudioContext): Promise<boolean> {
    if (this.workletModuleReady) return true
    try {
      await ctx.audioWorklet.addModule(pcmTapProcessorUrl)
      this.workletModuleReady = true
      return true
    } catch {
      return false
    }
  }

  private connectMonitor(session: InputCaptureSession, trackId: string): void {
    if (session.monitors.has(trackId)) return
    try {
      session.source.connect(this.getTrackNode(trackId).gain)
      session.monitors.add(trackId)
      this.recTrackDevice.set(trackId, session.deviceKey)
    } catch {
      /* ignore */
    }
  }

  private disconnectMonitor(session: InputCaptureSession, trackId: string): void {
    if (!session.monitors.has(trackId)) return
    try {
      session.source.disconnect(this.getTrackNode(trackId).gain)
    } catch {
      /* ignore */
    }
    session.monitors.delete(trackId)
    if (this.recTrackDevice.get(trackId) === session.deviceKey) this.recTrackDevice.delete(trackId)
  }

  private ingestCapture(session: InputCaptureSession, l: Float32Array, r: Float32Array): void {
    const n = l.length
    let peak = session.peak * 0.98
    for (let i = 0; i < n; i++) {
      const a = Math.abs(l[i])
      const b = Math.abs(r[i])
      if (a > peak) peak = a
      if (b > peak) peak = b
    }
    session.peak = peak > 1 ? 1 : peak
    if (!session.capturing) return
    const maxFrames = Math.floor(this.getSampleRate() * 300)
    if (session.frames + n > maxFrames) return
    session.chunksL.push(Float32Array.from(l))
    session.chunksR.push(Float32Array.from(r))
    session.frames += n
  }

  private async makeCaptureTap(
    ctx: AudioContext,
    session: InputCaptureSession,
  ): Promise<AudioWorkletNode | ScriptProcessorNode> {
    const ok = await this.ensureWorkletModule(ctx)
    if (ok) {
      const node = new AudioWorkletNode(ctx, 'jaswave-pcm-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        processorOptions: { stemIndex: -1 },
      })
      node.port.onmessage = (ev: MessageEvent) => {
        const pcm = (ev.data as { pcm?: Float32Array })?.pcm
        if (!pcm || pcm.length < 2) return
        const frames = pcm.length >> 1
        const l = new Float32Array(frames)
        const r = new Float32Array(frames)
        for (let i = 0; i < frames; i++) {
          l[i] = pcm[i * 2]
          r[i] = pcm[i * 2 + 1]
        }
        this.ingestCapture(session, l, r)
      }
      return node
    }
    const tap = ctx.createScriptProcessor(1024, 2, 2)
    tap.onaudioprocess = (ev) => {
      const input = ev.inputBuffer
      const l = input.getChannelData(0)
      const r = input.numberOfChannels > 1 ? input.getChannelData(1) : l
      this.ingestCapture(session, l, r)
      ev.outputBuffer.getChannelData(0).fill(0)
      if (ev.outputBuffer.numberOfChannels > 1) ev.outputBuffer.getChannelData(1).fill(0)
    }
    return tap
  }

  private async ensureCaptureSession(deviceId?: string | null): Promise<InputCaptureSession | null> {
    const key = this.sessionKey(deviceId)
    const existing = this.recSessions.get(key)
    if (existing) return existing
    // Con salida ASIO/nativa, getUserMedia sobre la misma tarjeta produce
    // monitor hardware / eco aunque el soft-monitor esté OFF. Grabación PCM
    // vía Chromium queda deshabilitada mientras el host nativo posee el device.
    if (this.usesNativeOutput()) return null
    const ctx = this.ensureContext()
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        return null
      }
    }
    if (!navigator.mediaDevices?.getUserMedia) return null
    try {
      const audio: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
      if (key) audio.deviceId = { exact: key }
      const stream = await navigator.mediaDevices.getUserMedia({ audio })
      const source = ctx.createMediaStreamSource(stream)
      const silent = ctx.createGain()
      silent.gain.value = 0
      const session: InputCaptureSession = {
        deviceKey: key,
        stream,
        source,
        tap: ctx.createGain() as unknown as ScriptProcessorNode,
        silent,
        chunksL: [],
        chunksR: [],
        frames: 0,
        peak: 0,
        capturing: false,
        monitors: new Set(),
      }
      const tap = await this.makeCaptureTap(ctx, session)
      session.tap = tap
      source.connect(tap)
      tap.connect(silent)
      // Gain 0 → destination solo para mantener el grafo/worklet vivo; no hay señal.
      silent.connect(ctx.destination)
      this.recSessions.set(key, session)
      return session
    } catch {
      return null
    }
  }

  private teardownSession(session: InputCaptureSession): void {
    for (const id of [...session.monitors]) this.disconnectMonitor(session, id)
    try {
      session.tap.disconnect()
    } catch {
      /* ignore */
    }
    try {
      session.silent.disconnect()
    } catch {
      /* ignore */
    }
    try {
      session.source.disconnect()
    } catch {
      /* ignore */
    }
    for (const t of session.stream.getTracks()) {
      try {
        t.stop()
      } catch {
        /* ignore */
      }
    }
    this.recSessions.delete(session.deviceKey)
  }

  private maybeTeardown(session: InputCaptureSession): void {
    if (session.capturing || session.monitors.size > 0) return
    this.teardownSession(session)
  }

  public async setInputMonitor(trackId: string, deviceId: string | undefined, on: boolean): Promise<void> {
    const prevKey = this.recTrackDevice.get(trackId)
    const nextKey = this.sessionKey(deviceId)
    if (prevKey != null && prevKey !== nextKey) {
      const prev = this.recSessions.get(prevKey)
      if (prev) {
        this.disconnectMonitor(prev, trackId)
        this.maybeTeardown(prev)
      }
    }
    if (!on) {
      const session = this.recSessions.get(nextKey)
      if (session) {
        this.disconnectMonitor(session, trackId)
        this.maybeTeardown(session)
      }
      return
    }
    const session = await this.ensureCaptureSession(deviceId)
    if (!session) return
    this.connectMonitor(session, trackId)
  }

  /**
   * Abre (o reutiliza) la captura del dispositivo. Monitor opcional.
   * Tope ~5 min de PCM en RAM.
   */
  public async startInputCapture(opts?: {
    deviceId?: string | null
    monitorTrackId?: string | null
  }): Promise<boolean> {
    const session = await this.ensureCaptureSession(opts?.deviceId)
    if (!session) return false
    session.chunksL = []
    session.chunksR = []
    session.frames = 0
    session.peak = 0
    session.capturing = true
    if (opts?.monitorTrackId) this.connectMonitor(session, opts.monitorTrackId)
    return true
  }

  public async abortInputCapture(deviceId?: string | null): Promise<void> {
    if (deviceId == null) {
      for (const s of [...this.recSessions.values()]) this.teardownSession(s)
      return
    }
    const session = this.recSessions.get(this.sessionKey(deviceId))
    if (!session) return
    session.capturing = false
    session.chunksL = []
    session.chunksR = []
    session.frames = 0
    this.maybeTeardown(session)
  }

  /** Detiene acumulación y devuelve un AudioBuffer estéreo, o null si no hay audio. */
  public async stopInputCapture(
    bufferKey: string,
    deviceId?: string | null,
  ): Promise<{ buffer: AudioBuffer; duration: number } | null> {
    const session = this.recSessions.get(this.sessionKey(deviceId))
    if (!session) return null
    const frames = session.frames
    const chunksL = session.chunksL
    const chunksR = session.chunksR
    session.capturing = false
    session.chunksL = []
    session.chunksR = []
    session.frames = 0
    this.maybeTeardown(session)
    if (frames < 64) return null
    const ctx = this.ensureContext()
    const buffer = ctx.createBuffer(2, frames, ctx.sampleRate)
    const outL = buffer.getChannelData(0)
    const outR = buffer.getChannelData(1)
    let o = 0
    for (let i = 0; i < chunksL.length; i++) {
      const a = chunksL[i]
      const b = chunksR[i] ?? a
      outL.set(a, o)
      outR.set(b, o)
      o += a.length
    }
    this.audioBuffers.set(bufferKey, buffer)
    return { buffer, duration: buffer.duration }
  }


  // --- Metronomo (Plugin Host nativo) ---

  private metronomeInterval: ReturnType<typeof setInterval> | null = null
  private metronomeGain: GainNode | null = null
  private metronomeVolumen = 0.8
  private metronomeNextBeat = 0
  private metronomeBpm = 120
  private metronomeBeatsPerBar = 4
  private metronomeWallEpochMs = 0
  private metronomeFreeRunStartBeat = 0
  private metronomeHostOn = false

  /** Metronomo sample-accurate en el Plugin Host. */
  public startMetronome(bpm: number, beatsPerBar: number, currentBeat: number) {
    this.metronomeBpm = Math.max(20, Math.min(400, bpm))
    this.metronomeBeatsPerBar = Math.max(1, Math.min(32, Math.floor(beatsPerBar)))
    this.metronomeHostOn = true
    sendHostMetronomeSet({
      enabled: true,
      bpm: this.metronomeBpm,
      beatsPerBar: this.metronomeBeatsPerBar,
      volume: this.metronomeVolumen,
    })
    if (!this.isPlaying) {
      this.metronomeWallEpochMs = performance.now()
      this.metronomeFreeRunStartBeat = currentBeat
    }
  }

  public updateMetronomeGrid(bpm: number, beatsPerBar: number, currentBeat: number) {
    this.startMetronome(bpm, beatsPerBar, currentBeat)
  }

  public stopMetronome() {
    this.metronomeHostOn = false
    this.metronomeWallEpochMs = 0
    if (this.metronomeInterval) {
      clearInterval(this.metronomeInterval)
      this.metronomeInterval = null
    }
    sendHostMetronomeSet({ enabled: false })
  }

  public setMetronomeVolume(vol: number) {
    this.metronomeVolumen = Math.max(0, Math.min(1, vol))
    if (this.metronomeHostOn) {
      sendHostMetronomeSet({
        enabled: true,
        bpm: this.metronomeBpm,
        beatsPerBar: this.metronomeBeatsPerBar,
        volume: this.metronomeVolumen,
      })
    }
  }

  private ensureMetronomeGain(_ctx: AudioContext) {
    /* Web metronome removed — host-only */
  }
}

export const audioEngine = new WebAudioEngine()
