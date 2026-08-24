/**
 * Motor de Audio Web Audio API para Jaswave DAW.
 * 
 * Permite la carga de archivos de audio (WAV, MP3, OGG, WebM, FLAC),
 * la síntesis de clips de demostración (batería, bajo, sintetizador),
 * la reproducción sincronizada con la timeline y el control de ganancia,
 * paneo y medición en tiempo real para el mixer.
 */

import { preferredTrackPlaysSoftPad, routeMidiToActiveVst, getPreferredPreviewTrackId, trackChannelIsAudible } from '@/src/lib/plugin/vst-voice-router'
import { allNotesOffAllTracks, sendVstCc, sendVstNote, setHostTransportPlaying } from '@/src/lib/plugin/track-vst-runtime'
import {
  getNativeMasterPeak,
  getNativeMaxStemPeak,
  getNativeTrackPeak,
  setMixMeterTrackOrder,
} from '@/src/lib/plugin/native-mix-meters'
import pcmTapProcessorUrl from './pcm-tap-processor.js?url'
import {
  encodeStemPacket,
  JASWAVE_MIX_DAW_BUS,
} from '@/src/lib/plugin/track-graph-encoding'
import { peakFromByteTimeDomain } from './audio-dsp'
import { ensureMicPermission, listAudioInputs, refreshAudioInputs } from '@/src/lib/audio-inputs'
import { normalizeSoftPadRole, scheduleRoleVoice, type SoftPadRole } from './role-voice'

export interface TrackAudioConfig {
  id: string
  volumen: number // 0.0 a 1.0 (o dB convertido)
  paneo: number // -1.0 (izquierda) a 1.0 (derecha)
  silenciada: boolean
  soloActiva: boolean
  /** Slot del Plugin Host para el instrumento VST3 de esta pista. */
  vstInstrumentSlotId?: string
  /** true = Soft Pad insertado en esta pista (no es fallback genérico). */
  softPadFallback?: boolean
  /** Soft Pad + VST a la vez (audibilidad garantizada si el VST no tiene kit/preset). */
  softPadDual?: boolean
  /** Rol de pista → timbre Soft Pad (drums/bass/guitar/…). */
  softPadRole?: SoftPadRole | string
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
  private dawBusTap: AudioWorkletNode | ScriptProcessorNode | null = null
  private dawBusSilent: GainNode | null = null
  private stemScratch = new Map<string, Float32Array>()
  private audioBuffers = new Map<string, AudioBuffer>()
  private activeSources = new Map<string, AudioBufferSourceNode>()
  /** Voces programadas de reproducción MIDI (timeline Soft Pad). */
  private activeMidiNodes: Array<{ stop: (when: number, releaseSec?: number) => void }> = []
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
  /** Voces del sintetizador de prueba (MIDI preview). */
  private synthVoices = new Map<
    number,
    { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode }
  >()
  private synthMaster: GainNode | null = null

  private isPlaying = false
  private startTime = 0
  private playheadStartSec = 0

  public setPreferredSampleRate(sr: number): void {
    if (sr >= 8000 && sr <= 192000) this.preferredSampleRate = sr
  }

  public usesNativeOutput(): boolean {
    return this.nativeOutput
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

  /** Mantiene el grafo Web Audio vivo aunque la salida vaya a gain 0 (stems → pipe). */
  private mixKeepAlive: { osc: OscillatorNode; gain: GainNode } | null = null
  private ensureMixGraphKeepAlive(): void {
    const ctx = this.audioCtx
    if (!ctx || this.mixKeepAlive) return
    try {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      gain.gain.value = 0
      osc.frequency.value = 20
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      this.mixKeepAlive = { osc, gain }
    } catch {
      /* ignore */
    }
  }

  private onPcmTap(e: AudioProcessingEvent): void {
    const input = e.inputBuffer
    const n = input.length
    const l = input.getChannelData(0)
    const r = input.numberOfChannels > 1 ? input.getChannelData(1) : l
    if (!this.tapScratch || this.tapScratch.length !== n * 2) {
      this.tapScratch = new Float32Array(n * 2)
    }
    const interleaved = this.tapScratch
    for (let i = 0; i < n; i++) {
      interleaved[i * 2] = l[i]
      interleaved[i * 2 + 1] = r[i]
    }
    window.electron?.pluginHostPushPcm?.(interleaved)
    e.outputBuffer.getChannelData(0).fill(0)
    if (e.outputBuffer.numberOfChannels > 1) e.outputBuffer.getChannelData(1).fill(0)
  }

  private onWorkletPcm(data: unknown): void {
    let pcm: Float32Array | null = null
    let stem = -1
    if (data instanceof Float32Array) {
      pcm = data
    } else if (data && typeof data === 'object' && 'pcm' in data) {
      const d = data as { pcm?: unknown; stemIndex?: number }
      if (d.pcm instanceof Float32Array) pcm = d.pcm
      if (typeof d.stemIndex === 'number') stem = d.stemIndex
    }
    if (!pcm || pcm.length === 0) return
    if (stem >= 0) {
      window.electron?.pluginHostPushPcm?.(encodeStemPacket(stem, pcm))
      return
    }
    window.electron?.pluginHostPushPcm?.(pcm)
  }

  public getSampleRate(): number {
    return this.audioCtx?.sampleRate ?? this.preferredSampleRate
  }

  /** Playhead de generación (AudioContext). No restar latencia: el MIDI/clips se programan aquí. */
  public getTimelineSeconds(): number {
    if (!this.audioCtx || !this.isPlaying) return this.playheadStartSec
    return this.playheadStartSec + Math.max(0, this.audioCtx.currentTime - this.startTime)
  }

  /** Retraso estimado Web Audio tap → pipe → ASIO (doble buffer). */
  public nativePathAheadSec(): number {
    const sr = this.audioCtx?.sampleRate ?? this.preferredSampleRate
    const tap = 256
    const buf = this.nativeBufferSize > 0 ? this.nativeBufferSize : 512
    return (tap + buf * 2) / sr + 0.008
  }

  /** Playhead audible (UI): coincide con lo que sale del device, no con Chromium. */
  public getAudibleTimelineSeconds(): number {
    const raw = this.getTimelineSeconds()
    if (!this.isPlaying) return raw
    const ctx = this.audioCtx
    const chromeLat = ctx ? (ctx.baseLatency || 0) + ((ctx as AudioContext & { outputLatency?: number }).outputLatency || 0) : 0
    const lat = this.nativeOutput ? this.nativePathAheadSec() : chromeLat
    return Math.max(this.playheadStartSec, raw - lat)
  }

  private disconnectTapGraph() {
    this.masterAnalyser?.disconnect()
    this.pcmTap?.disconnect()
    this.pcmWorklet?.disconnect()
    this.silentGain?.disconnect()
  }

  private attachTapGraph() {
    if (!this.audioCtx || !this.masterAnalyser) return
    const tap = this.pcmWorklet ?? this.pcmTap
    const silent = this.silentGain
    if (!tap || !silent) {
      this.masterAnalyser.connect(this.audioCtx.destination)
      return
    }
    this.masterAnalyser.connect(tap)
    tap.connect(silent)
    silent.connect(this.audioCtx.destination)
  }

  private async installPcmTap(): Promise<void> {
    const ctx = this.audioCtx
    if (!ctx) return
    if (this.pcmWorklet || this.pcmTap) return
    if (!this.silentGain) {
      this.silentGain = ctx.createGain()
      this.silentGain.gain.value = 0
    }
    try {
      if (!this.workletModuleReady) {
        await ctx.audioWorklet.addModule(pcmTapProcessorUrl)
        this.workletModuleReady = true
      }
      const node = new AudioWorkletNode(ctx, 'jaswave-pcm-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
      })
      node.port.onmessage = (ev: MessageEvent) => this.onWorkletPcm(ev.data)
      node.onprocessorerror = () => {
        if (this.pcmTap) return
        this.pcmTap = ctx.createScriptProcessor(512, 2, 2)
        this.pcmTap.onaudioprocess = (ev) => this.onPcmTap(ev)
        if (this.nativeOutput && !this.stemMode) this.attachTapGraph()
      }
      this.pcmWorklet = node
    } catch {
      this.pcmTap = ctx.createScriptProcessor(512, 2, 2)
      this.pcmTap.onaudioprocess = (ev) => this.onPcmTap(ev)
    }
  }

  /** Silencia Chromium y envía el mix DAW al plugin-host (un solo device). */
  public setNativeOutput(on: boolean, force = false): void {
    if (!this.audioCtx || !this.masterAnalyser) return
    const hasTap = !!(this.pcmWorklet || this.pcmTap || this.dawBusTap || this.stemMode)
    const enable = on && this.canPushNativePcm() && (hasTap || this.stemMode)
    if (!force && enable === this.nativeOutput) return
    this.nativeOutput = enable
    this.disconnectTapGraph()
    try {
      this.dawBusTap?.disconnect()
      this.dawBusSilent?.disconnect()
    } catch {
      /* ignore */
    }
    this.dawBusTap = null
    this.dawBusSilent = null
    if (enable) {
      if (this.stemMode) this.rewireTrackGraphForStemMode()
      else this.attachTapGraph()
    } else {
      this.masterAnalyser.connect(this.audioCtx.destination)
      for (const [, node] of this.trackNodes) {
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
        if (this.masterGain) node.analyser.connect(this.masterGain)
      }
      this.stemMode = false
    }
  }

  private disposeLiveContext() {
    this.stopAllSources()
    this.stopMetronome()
    void this.abortInputCapture()
    this.disconnectTapGraph()
    this.nativeOutput = false
    if (this.mixKeepAlive) {
      try {
        this.mixKeepAlive.osc.stop()
        this.mixKeepAlive.osc.disconnect()
        this.mixKeepAlive.gain.disconnect()
      } catch {
        /* ignore */
      }
      this.mixKeepAlive = null
    }
    try {
      this.pcmWorklet?.port.close()
    } catch {
      /* ignore */
    }
    this.pcmWorklet = null
    this.pcmTap = null
    this.silentGain = null
    try {
      this.dawBusTap?.disconnect()
      this.dawBusSilent?.disconnect()
    } catch {
      /* ignore */
    }
    this.dawBusTap = null
    this.dawBusSilent = null
    this.workletModuleReady = false
    this.tapInstalling = null
    this.trackNodes.clear()
    this.synthMaster = null
    this.synthVoices.clear()
    if (this.metronomeGain) {
      try {
        this.metronomeGain.disconnect()
      } catch {
        /* ignore */
      }
      this.metronomeGain = null
    }
    const ctx = this.audioCtx
    this.audioCtx = null
    this.masterGain = null
    this.masterPanner = null
    this.masterLimiter = null
    this.masterAnalyser = null
    this.masterMeterData = null
    if (ctx) {
      try {
        void ctx.close()
      } catch {
        /* ignore */
      }
    }
  }

  /** Tras cambio de driver / sample rate: nuevo AudioContext + tap PCM. */
  public async rearmAfterDeviceChange(sampleRate?: number): Promise<boolean> {
    if (sampleRate && sampleRate >= 8000 && sampleRate <= 192000) {
      this.preferredSampleRate = sampleRate
    }
    // Siempre recrear el grafo: el tap puede quedar muerto tras stop/start del device.
    this.disposeLiveContext()
    return this.armNativeMixOutput()
  }

  private notifyMixInputRate() {
    const sr = this.audioCtx?.sampleRate
    if (!sr || !window.electron?.pluginHostSend) return
    void window.electron.pluginHostSend({ type: 'setMixInputRate', sampleRate: Math.round(sr) })
  }

  /**
   * Arranca el device nativo y redirige el mix Web Audio (clips / Soft Pad / metrónomo)
   * al named pipe. Si falla, deja los altavoces de Chromium.
   */
  public async armNativeMixOutput(): Promise<boolean> {
    const api = typeof window !== 'undefined' ? window.electron : undefined
    if (typeof window !== 'undefined') {
      try {
        const q = new URLSearchParams(window.location.search)
        if (q.get('undock') || window.location.hash.replace(/^#/, '').startsWith('undock/')) {
          this.setNativeOutput(false)
          return false
        }
      } catch {
        /* ignore */
      }
    }
    if (!api?.pluginHostEnsure || !api.pluginHostSend || !api.pluginHostPushPcm) {
      this.setNativeOutput(false)
      return false
    }
    try {
      const ens = await api.pluginHostEnsure()
      const st = ens as { backend?: string; mixPipeConnected?: boolean } | undefined
      if (st?.backend && st.backend !== 'native') {
        this.setNativeOutput(false)
        return false
      }
      if (!st?.mixPipeConnected) {
        this.setNativeOutput(false)
        return false
      }
      const raw = (await Promise.race([
        api.pluginHostSend({ type: 'ensureAudio' }),
        new Promise<null>((r) => setTimeout(() => r(null), 4000)),
      ])) as { ok?: boolean; audio?: { sampleRate?: number; backend?: string } } | null
      if (!raw || raw.ok === false) {
        this.setNativeOutput(false)
        return false
      }
      if (raw.audio?.sampleRate) this.setPreferredSampleRate(raw.audio.sampleRate)
      const bufSz = (raw.audio as { bufferSize?: number } | undefined)?.bufferSize
      if (bufSz && bufSz >= 16 && bufSz <= 8192) this.nativeBufferSize = bufSz
      this.pendingChromiumSink = await this.preferredChromiumSink(raw.audio?.backend)
      if (this.audioCtx && raw.audio?.backend === 'asio') this.disposeLiveContext()
      this.ensureContext()
      await this.releaseInterfaceFromChromium(raw.audio?.backend)
      const installing =
        this.tapInstalling ??
        (this.tapInstalling = this.installPcmTap().finally(() => {
          this.tapInstalling = null
        }))
      await installing
      this.setNativeOutput(true, true)
      if (this.trackStemIndex.size > 0) {
        const ids = [...this.trackStemIndex.entries()]
          .sort((a, b) => a[1] - b[1])
          .map(([id]) => id)
        this.setTrackStemLayout(ids)
      }
      this.ensureMixGraphKeepAlive()
      this.notifyMixInputRate()
      if (this.audioCtx?.state === 'suspended') {
        try {
          await this.audioCtx.resume()
        } catch {
          /* ignore */
        }
      }
      return this.nativeOutput
    } catch {
      this.setNativeOutput(false, true)
      return false
    }
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

  public ensureContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = this.createLiveContext(this.preferredSampleRate)

      this.masterGain = this.audioCtx.createGain()
      this.masterGain.gain.value = this.masterMuted ? 0 : this.masterVolume

      this.masterPanner = this.audioCtx.createStereoPanner()
      this.masterPanner.pan.value = 0

      this.masterAnalyser = this.audioCtx.createAnalyser()
      this.masterAnalyser.fftSize = 256
      this.masterAnalyser.smoothingTimeConstant = 0
      this.masterMeterData = new Uint8Array(this.masterAnalyser.fftSize)

      this.masterGain.connect(this.masterPanner)
      this.masterPanner.connect(this.masterAnalyser)
      this.masterAnalyser.connect(this.audioCtx.destination)
    }

    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume()
    }

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
      } else {
        analyser.connect(this.masterGain!)
      }

      this.trackNodes.set(trackId, created)
    }
    const node = this.trackNodes.get(trackId)!
    if (this.stemMode && this.nativeOutput && !node.stemTap) {
      try {
        node.analyser.disconnect(this.masterGain!)
      } catch {
        /* ignore */
      }
      this.attachStemTap(trackId, node)
    }
    return node
  }

  private attachStemTap(trackId: string, node: TrackAudioNode) {
    const ctx = this.audioCtx
    if (!ctx) return
    const idx = this.trackStemIndex.get(trackId)
    if (idx == null || idx < 0) {
      node.analyser.connect(this.masterGain!)
      return
    }
    const silent = ctx.createGain()
    silent.gain.value = 0
    const tap = this.makePcmTap(ctx, idx)
    node.analyser.connect(tap)
    tap.connect(silent)
    silent.connect(ctx.destination)
    node.stemTap = tap
    node.stemSilent = silent
    node.stemIndex = idx
  }

  private makePcmTap(ctx: AudioContext, stemIndex: number): AudioWorkletNode | ScriptProcessorNode {
    if (this.workletModuleReady) {
      const node = new AudioWorkletNode(ctx, 'jaswave-pcm-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        processorOptions: { stemIndex },
      })
      node.port.onmessage = (ev: MessageEvent) => this.onWorkletPcm(ev.data)
      return node
    }
    const tap = ctx.createScriptProcessor(512, 2, 2)
    tap.onaudioprocess = (ev) => {
      const input = ev.inputBuffer
      const n = input.length
      const l = input.getChannelData(0)
      const r = input.numberOfChannels > 1 ? input.getChannelData(1) : l
      const key = `stem-${stemIndex}`
      let scratch = this.stemScratch.get(key)
      if (!scratch || scratch.length !== n * 2) {
        scratch = new Float32Array(n * 2)
        this.stemScratch.set(key, scratch)
      }
      for (let i = 0; i < n; i++) {
        scratch[i * 2] = l[i]
        scratch[i * 2 + 1] = r[i]
      }
      window.electron?.pluginHostPushPcm?.(encodeStemPacket(stemIndex, scratch))
      ev.outputBuffer.getChannelData(0).fill(0)
      if (ev.outputBuffer.numberOfChannels > 1) ev.outputBuffer.getChannelData(1).fill(0)
    }
    return tap
  }

  /** Asigna índices de stem y activa el modo Reaper (dry por pista → host). */
  public setTrackStemLayout(trackIds: string[]): void {
    this.trackStemIndex.clear()
    trackIds.forEach((id, i) => {
      if (i < 64) this.trackStemIndex.set(id, i)
    })
    setMixMeterTrackOrder(trackIds)
    const wantStem = this.nativeOutput && trackIds.length > 0
    if (wantStem === this.stemMode) {
      // Re-wire existing nodes if indices changed
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
    this.disconnectTapGraph()
    if (this.nativeOutput) {
      if (this.stemMode) this.attachDawBusTap()
      else this.attachTapGraph()
    } else if (this.masterAnalyser) {
      this.masterAnalyser.connect(this.audioCtx.destination)
    }
  }

  private attachDawBusTap() {
    if (!this.audioCtx || !this.masterAnalyser) return
    if (this.dawBusTap) {
      this.masterAnalyser.connect(this.dawBusTap)
      return
    }
    const silent = this.audioCtx.createGain()
    silent.gain.value = 0
    const tap = this.makePcmTap(this.audioCtx, JASWAVE_MIX_DAW_BUS)
    this.masterAnalyser.connect(tap)
    tap.connect(silent)
    silent.connect(this.audioCtx.destination)
    this.dawBusTap = tap
    this.dawBusSilent = silent
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

  private ensureSynthBus(): GainNode {
    const ctx = this.ensureContext()
    if (!this.synthMaster) {
      this.synthMaster = ctx.createGain()
      this.synthMaster.gain.value = 0.35
      this.synthMaster.connect(this.masterGain!)
    }
    return this.synthMaster
  }

  public setSynthGain(value: number): void {
    const bus = this.ensureSynthBus()
    bus.gain.value = Math.max(0, Math.min(1, value))
  }

  /** Preview MIDI: VST de la pista, o Soft Pad solo si está insertado. */
  public noteOn(pitch: number, velocity = 90): void {
    if (routeMidiToActiveVst(true, pitch, velocity)) return
    if (!preferredTrackPlaysSoftPad()) return
    const trackId = getPreferredPreviewTrackId()
    if (trackId && !trackChannelIsAudible(trackId)) return
    const ctx = this.ensureContext()
    const dest = trackId ? this.getTrackNode(trackId).gain : this.ensureSynthBus()
    const start = () => {
      this.noteOff(pitch, 0.02)
      const freq = 440 * Math.pow(2, (pitch - 69) / 12)
      const vel = Math.max(0.05, Math.min(1, velocity / 127))

      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = freq

      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 900 + vel * 2400
      filter.Q.value = 0.7

      const gain = ctx.createGain()
      const now = ctx.currentTime
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.22 * vel, now + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.14 * vel, now + 0.18)

      osc.connect(filter)
      filter.connect(gain)
      gain.connect(dest)
      osc.start(now)

      this.synthVoices.set(pitch, { osc, gain, filter })
    }
    if (ctx.state === 'suspended') {
      void ctx.resume().then(start)
      return
    }
    start()
  }

  /** Preview MIDI: nota apagada. */
  public noteOff(pitch: number, releaseSec = 0.25): void {
    if (routeMidiToActiveVst(false, pitch, 0)) return
    const voice = this.synthVoices.get(pitch)
    if (!voice) return
    const ctx = this.ensureContext()
    const now = ctx.currentTime
    try {
      voice.gain.gain.cancelScheduledValues(now)
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now)
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseSec)
      voice.osc.stop(now + releaseSec + 0.02)
    } catch {
      /* ignore */
    }
    this.synthVoices.delete(pitch)
  }

  public allNotesOff(): void {
    for (const pitch of Array.from(this.synthVoices.keys())) {
      this.noteOff(pitch, 0.05)
    }
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
   */
  public playClips(
    startSec: number,
    clips: AudioClipPlaybackInfo[],
    tracksConfig: TrackAudioConfig[],
    midiClips: MidiClipPlaybackInfo[] = [],
  ) {
    this.stopAllSources()
    const ctx = this.ensureContext()

    this.isPlaying = true
    this.startTime = ctx.currentTime
    this.playheadStartSec = Math.max(0, startSec)
    setHostTransportPlaying(true)

    const haySolos = tracksConfig.some((t) => t.soloActiva)
    for (const trk of tracksConfig) {
      this.updateTrackControls(trk.id, trk.volumen, trk.paneo, trk.silenciada, haySolos, trk.soloActiva)
    }

    for (const clip of clips) {
      try {
        const buffer = this.audioBuffers.get(clip.sourcePathOrId) || this.audioBuffers.get(clip.id)
        if (!buffer) continue

        const clipStart = clip.inicio
        const clipDuration = clip.duracion || buffer.duration
        const clipEnd = clipStart + clipDuration
        if (this.playheadStartSec >= clipEnd) continue

        let offset = 0
        let delay = 0
        let consumed = 0

        if (this.playheadStartSec > clipStart) {
          consumed = this.playheadStartSec - clipStart
          offset = consumed + (clip.clipInicio || 0)
        } else {
          delay = clipStart - this.playheadStartSec
        }

        // Evitar IndexSizeError en source.start (mata el resto del playback)
        if (offset >= buffer.duration) continue
        offset = Math.max(0, offset)
        const remainingDuration = Math.min(
          Math.max(0, clipDuration - consumed),
          buffer.duration - offset,
        )
        if (remainingDuration <= 0.001) continue

        const trackNode = this.getTrackNode(clip.trackId)
        const sourceNode = ctx.createBufferSource()
        sourceNode.buffer = buffer
        sourceNode.connect(trackNode.gain)

        const clipRemain = Math.max(0, clipDuration - consumed)
        // Si el clip de timeline es mas largo que el buffer, loopear hasta cubrir
        if (clipRemain > buffer.duration - offset + 0.01) {
          sourceNode.loop = true
          sourceNode.loopStart = clip.clipInicio || 0
          sourceNode.loopEnd = buffer.duration
          sourceNode.start(this.startTime + delay, offset, clipRemain)
        } else {
          sourceNode.start(this.startTime + delay, offset, remainingDuration)
        }
        this.activeSources.set(clip.id, sourceNode)
      } catch (err) {
        console.warn('[audio-engine] clip start failed', clip.id, err)
      }
    }

    try {
      this.beginMidiScheduler(midiClips, tracksConfig, haySolos)
    } catch (err) {
      console.warn('[audio-engine] midi schedule failed', err)
    }
  }

  private beginMidiScheduler(
    midiClips: MidiClipPlaybackInfo[],
    tracksConfig: TrackAudioConfig[],
    haySolos: boolean,
  ) {
    this.stopMidiScheduler()
    this.midiVoiceKeys.clear()
    this.midiCcKeys.clear()
    this.pendingMidiClips = midiClips
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
    }, 40)
  }

  /** Hot-patch: slot VST confirmado. Soft Pad si está insertado (solo o dual con VST). */
  public patchTrackVstInstrument(
    trackId: string,
    slotId: string | undefined,
    insertedSoftPad = false,
  ): void {
    const prev = this.pendingTracksConfig.find((t) => t.id === trackId)
    const slotChanged = Boolean(slotId) && slotId !== prev?.vstInstrumentSlotId
    this.pendingTracksConfig = this.pendingTracksConfig.map((t) =>
      t.id === trackId
        ? {
            ...t,
            vstInstrumentSlotId: slotId,
            softPadFallback: insertedSoftPad && !slotId,
            softPadDual: insertedSoftPad && Boolean(slotId),
          }
        : t,
    )
    // Notas saltadas mientras el slot no existía: reabrir la ventana actual.
    if (slotChanged && this.isPlaying && this.audioCtx) {
      const wallElapsed = this.audioCtx.currentTime - this.startTime
      const nowTimeline = this.playheadStartSec + Math.max(0, wallElapsed)
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

  /** Programa MIDI por ventanas sin tocar las fuentes de audio. */
  private scheduleMidiLookahead() {
    const ctx = this.audioCtx
    if (!ctx || !this.isPlaying) return
    const horizon = 0.85
    const from = this.midiScheduledUntilSec
    const wallElapsed = ctx.currentTime - this.startTime
    const nowTimeline = this.playheadStartSec + Math.max(0, wallElapsed)
    const windowStart = Math.max(from, nowTimeline - 0.05)
    const windowEnd = nowTimeline + horizon
    if (windowEnd <= windowStart) return

    this.scheduleMidiClipsInWindow(windowStart, windowEnd)
    this.midiScheduledUntilSec = windowEnd
  }

  private scheduleMidiClipsInWindow(windowStart: number, windowEnd: number) {
    const ctx = this.audioCtx
    if (!ctx) return

    const cfgById = new Map(this.pendingTracksConfig.map((t) => [t.id, t]))

    for (const clip of this.pendingMidiClips) {
      const cfg = cfgById.get(clip.trackId)
      // Solo > mute (igual que audio)
      if (this.midiHaySolos) {
        if (!cfg?.soloActiva) continue
      } else if (cfg?.silenciada) {
        continue
      }

      const trackNode = this.getTrackNode(clip.trackId)
      const vstSlot = cfg?.vstInstrumentSlotId

      for (let ni = 0; ni < clip.notes.length; ni++) {
        const note = clip.notes[ni]!
        const noteStart = note.startSec
        const durRaw = Math.max(0.03, note.durationSec)
        const noteEnd = noteStart + durRaw
        if (noteEnd <= windowStart) continue
        if (noteStart > windowEnd) continue
        const key = clip.id + ':' + ni + ':' + note.pitch + ':' + noteStart.toFixed(4)
        if (this.midiVoiceKeys.has(key)) continue

        let when = this.startTime + (noteStart - this.playheadStartSec)
        let dur = durRaw
        if (noteStart < this.playheadStartSec) {
          dur = noteEnd - this.playheadStartSec
          when = this.startTime
        }
        if (when < ctx.currentTime - 0.02) {
          dur -= ctx.currentTime - when
          when = ctx.currentTime
        }
        if (dur <= 0.02) continue

        try {
          const wantPad = Boolean(cfg?.softPadFallback || (vstSlot && cfg?.softPadDual))
          if (vstSlot) {
            this.scheduleVstMidiNote(vstSlot, note.pitch, note.velocity, when, dur)
          }
          if (wantPad || (!vstSlot && cfg?.softPadFallback)) {
            const padVel =
              vstSlot && cfg?.softPadDual
                ? Math.max(1, Math.round(note.velocity * 0.55))
                : note.velocity
            this.scheduleMidiVoice(
              ctx,
              trackNode.gain,
              note.pitch,
              padVel,
              when,
              dur,
              normalizeSoftPadRole(cfg?.softPadRole),
            )
          } else if (!vstSlot) {
            continue
          }
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
        let when = this.startTime + (ev.timeSec - this.playheadStartSec)
        if (when < ctx.currentTime - 0.02) when = ctx.currentTime
        if (!vstSlot) continue
        const delay = Math.max(
          0,
          Math.round(
            (when - ctx.currentTime + (this.nativeOutput ? this.nativePathAheadSec() : 0)) *
              ctx.sampleRate,
          ),
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
    when: number,
    durationSec: number,
  ) {
    const ctx = this.audioCtx
    if (!ctx) return
    const delayOn = Math.max(
      0,
      Math.round(
        (when - ctx.currentTime + (this.nativeOutput ? this.nativePathAheadSec() : 0)) * ctx.sampleRate,
      ),
    )
    const delayOff = delayOn + Math.max(32, Math.round(durationSec * ctx.sampleRate))
    sendVstNote(slotId, true, pitch, velocity, delayOn)
    sendVstNote(slotId, false, pitch, 0, delayOff)
  }

  private scheduleMidiVoice(
    ctx: AudioContext,
    destination: AudioNode,
    pitch: number,
    velocity: number,
    when: number,
    durationSec: number,
    role: SoftPadRole = 'default',
  ) {
    const handle = scheduleRoleVoice(
      ctx,
      destination,
      pitch,
      velocity,
      Math.max(when, ctx.currentTime),
      Math.max(0.04, durationSec),
      role,
    )
    this.activeMidiNodes.push(handle)
  }

  /**
   * Detiene todos los nodos de fuente activos
   */
  public stopAllSources() {
    this.stopMidiScheduler()
    setHostTransportPlaying(false)
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

    const now = this.audioCtx?.currentTime ?? 0
    for (const voice of this.activeMidiNodes) {
      try {
        voice.stop(now, 0.03)
      } catch {
        /* ignore */
      }
    }
    this.activeMidiNodes = []
    try {
      this.allNotesOff()
    } catch {
      /* ignore */
    }
    if (this.isPlaying && this.audioCtx) {
      this.playheadStartSec = this.getTimelineSeconds()
    }
    this.isPlaying = false
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
    // Preferir lo que se mueva: VST vive en el host; clips/Soft Pad en Web Audio.
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

  // ── Metrónomo ────────────────────────────────────────────────

  private metronomeInterval: ReturnType<typeof setInterval> | null = null
  private metronomeGain: GainNode | null = null
  private metronomeVolumen = 0.8
  private metronomeStartTime = 0
  private metronomeBeatOffset = 0
  private metronomeNextBeat = 0
  private metronomeBpm = 120
  private metronomeBeatsPerBar = 4

  /**
   * Genera un click sintetizado en el AudioContext.
   * `accent` = true para el primer beat del compás (más agudo y fuerte).
   */
  private playClick(ctx: AudioContext, time: number, accent: boolean) {
    const dest = this.metronomeGain
    if (!dest || dest.context !== ctx) return

    const osc = ctx.createOscillator()
    const env = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.value = accent ? 1800 : 1000

    env.gain.setValueAtTime(this.metronomeVolumen * (accent ? 1.0 : 0.6), time)
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.05)

    osc.connect(env)
    env.connect(dest)

    osc.start(time)
    osc.stop(time + 0.06)
  }

  /**
   * Programa clicks pendientes usando Web Audio API scheduling.
   * Usa `metronomeStartTime` (su propio reloj) en vez de `this.startTime` del playback.
   */
  private scheduleMetronomeTicks() {
    const ctx = this.audioCtx
    if (!ctx || ctx.state === 'closed') return

    const secPerBeat = 60 / this.metronomeBpm
    // Lookahead amplio para no cortar clicks bajo carga del hilo principal
    const scheduleWindow = 0.35

    while (true) {
      const beatOffset = this.metronomeNextBeat - this.metronomeBeatOffset
      const clickTime = this.metronomeStartTime + beatOffset * secPerBeat

      if (clickTime > ctx.currentTime + scheduleWindow) break

      if (clickTime >= ctx.currentTime - 0.05) {
        const beatInBar = ((this.metronomeNextBeat % this.metronomeBeatsPerBar) + this.metronomeBeatsPerBar) % this.metronomeBeatsPerBar
        const accent = beatInBar === 0
        this.playClick(ctx, Math.max(clickTime, ctx.currentTime + 0.001), accent)
      }

      this.metronomeNextBeat++
    }
  }

  /**
   * Inicia el metrónomo alineado al siguiente beat (estilo Reaper).
   */
  public startMetronome(bpm: number, beatsPerBar: number, currentBeat: number) {
    this.stopMetronome()
    const ctx = this.ensureContext()
    this.ensureMetronomeGain(ctx)

    this.metronomeBpm = Math.max(20, Math.min(400, bpm))
    this.metronomeBeatsPerBar = Math.max(1, Math.min(32, Math.floor(beatsPerBar)))

    const secPerBeat = 60 / this.metronomeBpm
    // Empezar en el próximo beat (o el actual si estamos casi encima)
    const nextBeat = Math.ceil(currentBeat - 1e-6)
    const beatsUntilNext = Math.max(0, nextBeat - currentBeat)
    const delaySec = beatsUntilNext * secPerBeat

    this.metronomeStartTime = ctx.currentTime + delaySec
    this.metronomeBeatOffset = nextBeat
    this.metronomeNextBeat = nextBeat

    const tick = () => this.scheduleMetronomeTicks()
    this.metronomeInterval = setInterval(tick, 25)
    tick()
  }

  /** Actualiza BPM/compás en caliente sin reiniciar el intervalo si ya corre. */
  public updateMetronomeGrid(bpm: number, beatsPerBar: number, currentBeat: number) {
    if (!this.metronomeInterval) {
      this.startMetronome(bpm, beatsPerBar, currentBeat)
      return
    }
    this.startMetronome(bpm, beatsPerBar, currentBeat)
  }

  /**
   * Detiene el metrónomo.
   */
  public stopMetronome() {
    if (this.metronomeInterval) {
      clearInterval(this.metronomeInterval)
      this.metronomeInterval = null
    }
  }

  /**
   * Establece el volumen del metrónomo (0.0 a 1.0).
   */
  public setMetronomeVolume(vol: number) {
    this.metronomeVolumen = Math.max(0, Math.min(1, vol))
    if (this.metronomeGain) {
      this.metronomeGain.gain.value = this.metronomeVolumen
    }
  }

  /** Recrea el gain del metrónomo si el AudioContext se regeneró (device / native mix). */
  private ensureMetronomeGain(ctx: AudioContext) {
    const master = this.masterGain
    if (!master || master.context !== ctx) return
    if (this.metronomeGain && this.metronomeGain.context === ctx) {
      try {
        this.metronomeGain.connect(master)
      } catch {
        /* already connected */
      }
      this.metronomeGain.gain.value = this.metronomeVolumen
      return
    }
    if (this.metronomeGain) {
      try {
        this.metronomeGain.disconnect()
      } catch {
        /* ignore */
      }
      this.metronomeGain = null
    }
    this.metronomeGain = ctx.createGain()
    this.metronomeGain.gain.value = this.metronomeVolumen
    this.metronomeGain.connect(master)
  }
}

export const audioEngine = new WebAudioEngine()
