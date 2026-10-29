/**
 * Motor de Audio Web Audio API para Jaswave DAW.
 * 
 * Permite la carga de archivos de audio (WAV, MP3, OGG, WebM, FLAC),
 * la síntesis de clips de demostración (batería, bajo, sintetizador),
 * la reproducción sincronizada con la timeline y el control de ganancia,
 * paneo y medición en tiempo real para el mixer.
 */

import { routeMidiToActiveVst } from '@/src/lib/plugin/vst-voice-router'
import { allNotesOffAllTracks, allNotesOffSlot, sendVstCc, sendVstNote, setHostTransportPlaying } from '@/src/lib/plugin/track-vst-runtime'
import { MidiLookahead, MIDI_TICK_MS, type VoiceKeys, noteVoiceKey } from './midi-lookahead'
import {
  getNativeMasterMetering,
  getNativeMasterPeak,
  getNativeMaxStemPeak,
  getNativeTrackPeak,
  getNativeTrackPeakStereo,
  hasFreshNativeMeters,
  isNativeMeterHostAvailable,
  setMixMeterTrackOrder,
} from '@/src/lib/plugin/native-mix-meters'
import {
  getCachedHostTransportClock,
  isHostTransportClockStalled,
  hostClipLoadPath,
  hostClipEnsureBuffer,
  hostClipSchedule,
  hostClipStopAll,
  sendHostMetronomeSet,
  startHostTransportClockPoll,
  stopHostTransportClockPoll,
  curvaFadeAHost,
} from '@/src/lib/plugin/host-transport'
import pcmTapProcessorUrl from './pcm-tap-processor.js?url'
import { WebSynthPistas, usarWebSynth, type PresetWebSynth } from './web-synth/web-synth'
import { peakFromByteTimeDomain } from './audio-dsp'
import { synthDemoSamples } from './demo-synth'
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
  /** Capas: otros instrumentos VST de la pista que reciben el mismo MIDI. */
  vstLayerSlotIds?: string[]
  /** Preset del WebSynth para escuchar la pista en la web (sin plugin host). */
  instrumentoWeb?: PresetWebSynth
}

export interface AudioClipPlaybackInfo {
  id: string
  trackId: string
  inicio: number // en segundos
  duracion: number // en segundos
  sourcePathOrId: string
  clipInicio?: number // offset dentro del clip de audio en segundos
  name?: string
  nombre?: string
  /** Clip silenciado: no se programa. */
  silenciado?: boolean
  /** Ganancia del clip (dB). */
  gananciaDb?: number
  /** Fundidos en segundos y su curva ('lineal' | 'exponencial' | 'logaritmica'). */
  fadeInSec?: number
  fadeOutSec?: number
  fadeInCurva?: string
  fadeOutCurva?: string
  /** Audio al revés (la región del clip se lee de atrás hacia delante). */
  inverso?: boolean
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
  /** Se alcanzó MAX_CAPTURE_SECONDS: el resto de la toma no se guardó. */
  truncated?: boolean
}

/** Tope de una toma en memoria (float estéreo 48 kHz ≈ 690 MB a 30 min). */
const MAX_CAPTURE_SECONDS = 30 * 60
/** `lastArmError` cuando otra instancia de JasWave tiene el motor de audio. */
export const ARM_ERROR_MOTOR_OCUPADO = 'audio-engine-busy'

/** dB → factor lineal (sin valor = 0 dB). */
function dbALineal(db: number | undefined): number {
  return db == null || !Number.isFinite(db) ? 1 : Math.pow(10, db / 20)
}

/** Clips que empiezan en esta ventana desde el playhead se suben antes de arrancar el transporte. */
const PLAY_PRELOAD_WINDOW_SEC = 2
/** Espera máxima por esa subida previa: después se arranca igual y el resto entra en cuanto llegue. */
const PLAY_PRELOAD_MAX_WAIT_MS = 4000

type ClipJob = {
  clip: AudioClipPlaybackInfo
  cfg: (TrackAudioConfig & { stemIndex: number }) | undefined
  buffer: AudioBuffer | undefined
  /** Segundos desde el playhead hasta que empieza a sonar (0 si ya empezó). */
  delay: number
  /** Posición de lectura dentro del audio de origen (segundos). */
  offset: number
  remainingDuration: number
}

export class WebAudioEngine {
  private audioCtx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private monitorGain: GainNode | null = null
  private monitorLevel = 1
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
  /** Aviso a la UI cuando un clip no se pudo cargar en el host (antes fallaba en silencio). */
  public onClipLoadFailed?: (clipId: string) => void
  /** Se incrementa en cada stop/play: invalida subidas y programaciones de la reproducción anterior. */
  private playGeneration = 0
  private activeSources = new Map<string, AudioBufferSourceNode>()
  private midiScheduleTimer: ReturnType<typeof setInterval> | null = null
  /** W2: sintetizador de respaldo en la web (sin plugin host). */
  private webSynth = new WebSynthPistas(
    () => this.ensureContext(),
    (trackId) => this.getTrackNode(trackId).gain,
  )
  private recSessions = new Map<string, InputCaptureSession>()
  private recTrackDevice = new Map<string, string>()
  private pendingTracksConfig: TrackAudioConfig[] = []
  /** Planificador MIDI por ventanas (lógica pura en ./midi-lookahead, probada con node:test). */
  private midiLookahead = new MidiLookahead({
    note: (slot, pitch, vel, whenSec, durSec, now) => this.scheduleVstMidiNote(slot, pitch, vel, whenSec, durSec, now),
    cc: (slot, cc, value, timeSec, now) => {
      const sr = this.getSampleRate()
      sendVstCc(slot, cc, value, Math.max(0, Math.round((timeSec - now + this.nativePathAheadSec()) * sr)))
    },
    nonVstClip: (clip, cfg, ws, we, now, voices, start) => {
      if (usarWebSynth()) this.scheduleWebSynthClip(clip, cfg as TrackAudioConfig, ws, we, now, voices, start)
    },
    panicSlot: (slot) => allNotesOffSlot(slot),
    warn: (msg, err) => console.warn(msg, err),
  })
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

  public getIsPlaying(): boolean {
    return this.isPlaying
  }

  public getSampleRate(): number {
    const host = getCachedHostTransportClock().sampleRate
    if (host >= 8000) return host
    return this.audioCtx?.sampleRate ?? this.preferredSampleRate
  }

  private wallClockSec(): number {
    if (this.playWallEpochMs > 0) {
      return this.playheadStartSec + Math.max(0, (performance.now() - this.playWallEpochMs) / 1000)
    }
    return this.playheadStartSec
  }

  /**
   * Fija la posición de timeline (p.ej. W / seek en pause) sin arrancar audio.
   * Evita que al reanudar play se republicque la posición anterior al undock.
   */
  public seekTimeline(sec: number): void {
    const t = Math.max(0, sec)
    this.playheadStartSec = t
    if (this.isPlaying) {
      this.playWallEpochMs = performance.now()
    } else {
      this.playWallEpochMs = 0
    }
  }

  /**
   * Reloj monotónico (pared) para sync a ventanas undock.
   * No alterna host/wall (eso tambalea el playhead remoto).
   */
  public getMonotonicTimelineSeconds(): number {
    if (!this.isPlaying) return this.playheadStartSec
    return this.wallClockSec()
  }

  /**
   * Playhead UI — host samples; wall solo si el clock está congelado o aún no aplicó seek.
   * No usar para programar MIDI (ver getMidiTimelineSeconds).
   */
  public getTimelineSeconds(): number {
    if (!this.isPlaying) return this.playheadStartSec
    const wall = this.wallClockSec()
    const host = getCachedHostTransportClock()
    if (host.playing && host.timelineSec >= 0) {
      // Tras seek: host puede reportar timeline vieja por encima del wall.
      if (host.timelineSec > wall + 0.35) return wall
      if (isHostTransportClockStalled() && wall - host.timelineSec > 0.15) return wall
      return Math.max(0, host.timelineSec)
    }
    return wall
  }

  /**
   * Reloj MIDI = pared en play. El RPC getTransportClock comparte stdin con noteOn/load;
   * si se atasca, un lookahead ligado al host deja de emitir notas para siempre mientras
   * el playhead UI (wall) sigue. Delays noteOn son relativos al instante de envío.
   */
  private getMidiTimelineSeconds(): number {
    if (!this.isPlaying) return this.playheadStartSec
    return this.wallClockSec()
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
      ])) as { ok?: boolean; code?: string; audio?: { sampleRate?: number; bufferSize?: number } } | null
      // Otra instancia tiene el motor de audio: reintentar aquí no sirve (el puente reintenta solo).
      if (raw?.code === 'AudioEngineBusy') {
        this.lastArmError = ARM_ERROR_MOTOR_OCUPADO
        this.nativeOutput = false
        return false
      }
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
   * En navegador web (sin plugin-host nativo): AudioContext real conectado a altavoces.
   * En Electron: contexto Offline/auxiliar para decode, el path live va por C++ Plugin Host a ASIO.
   */
  public ensureContext(): AudioContext {
    if (this.audioCtx && (this.audioCtx as AudioContext).state !== 'closed') {
      if (!this.nativeOutput && this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume().catch(() => {})
      }
      return this.audioCtx
    }
    const hasElectronHost = typeof window !== 'undefined' && Boolean(window.electron?.pluginHostSend)
    if (!hasElectronHost) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AudioCtxClass) {
        const ctx = new AudioCtxClass({ sampleRate: this.preferredSampleRate })
        this.audioCtx = ctx
        this.masterGain = ctx.createGain()
        this.masterPanner = ctx.createStereoPanner()
        this.masterAnalyser = ctx.createAnalyser()
        this.masterAnalyser.fftSize = 256
        this.masterAnalyser.smoothingTimeConstant = 0.8
        this.masterMeterData = new Uint8Array(this.masterAnalyser.frequencyBinCount)

        this.masterGain.connect(this.masterPanner)
        this.masterPanner.connect(this.masterAnalyser)
        // Monitorización: después del medidor del master, solo hacia el dispositivo.
        this.monitorGain = ctx.createGain()
        this.monitorGain.gain.value = this.monitorLevel
        this.masterAnalyser.connect(this.monitorGain)
        this.monitorGain.connect(ctx.destination)

        this.applyMasterGain()
        return this.audioCtx
      }
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
    this.monitorGain = null
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

  /** Volumen hacia los altavoces (0–1). No cambia el master ni lo que se exporta; el medidor del master lo ignora. */
  public setMonitorGain(level: number): void {
    this.monitorLevel = Math.max(0, Math.min(1, level))
    const ctx = this.audioCtx
    if (ctx && this.monitorGain) this.monitorGain.gain.setTargetAtTime(this.monitorLevel, ctx.currentTime, 0.02)
    else if (this.monitorGain) this.monitorGain.gain.value = this.monitorLevel
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
    // En play: mute/solo/slot cambiados invalidan lo ya encolado en el host (horizonte largo).
    if (this.isPlaying) this.midiLookahead.retargetTracks(tracksConfig, this.getMidiTimelineSeconds())
    else this.midiLookahead.setTracks(tracksConfig)
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

  /** Preview MIDI: solo VST de la pista preferida / activa (en la web, WebSynth). */
  public noteOn(pitch: number, velocity = 90): void {
    if (usarWebSynth()) {
      void this.webSynth.preparar().then(() => this.webSynth.inmediata('__preview__', this.presetPreview, true, pitch, velocity))
      return
    }
    routeMidiToActiveVst(true, pitch, velocity)
  }

  /** Preview MIDI: nota apagada. */
  public noteOff(pitch: number, _releaseSec = 0.25): void {
    if (usarWebSynth()) {
      this.webSynth.inmediata('__preview__', this.presetPreview, false, pitch, 0)
      return
    }
    routeMidiToActiveVst(false, pitch, 0)
  }

  private presetPreview: PresetWebSynth = 'piano'
  /** Preset de la previsualización web (la pista seleccionada). */
  public setPresetPreviewWeb(preset: PresetWebSynth): void {
    this.presetPreview = preset
  }

  /**
   * Panic MIDI global desde la UI (cierre de panel, blur, audición). Vacía la cola del
   * host, incluidas las notas de reproducción ya enviadas por adelantado; por eso, si
   * está sonando, se olvida lo enviado y se reprograma YA desde la posición actual
   * (sin ello el audio se cortaba hasta el horizonte completo).
   */
  public allNotesOff(): void {
    allNotesOffAllTracks()
    if (this.isPlaying) {
      this.midiLookahead.rewindAll()
      this.scheduleMidiLookahead()
    }
  }

  /** Panic de un slot desde la UI; ver `allNotesOff`. */
  public allNotesOffSlot(slotId: string): void {
    allNotesOffSlot(slotId)
    if (this.isPlaying && this.midiLookahead.rewindSlot(slotId)) this.scheduleMidiLookahead()
  }

  /**
   * Sintetizador procedural para generar pistas de demo con sonido real.
   * DSP determinista en lib/demo-synth.ts (fase integrada, envolventes a cero,
   * pico <= 0.92) → sin clicks ni recortes.
   */
  public generateDemoBuffer(type: 'drums' | 'bass' | 'chords' | 'lead' | 'synth', durationSec = 16): AudioBuffer {
    const sampleRate = this.audioCtx?.sampleRate ?? this.preferredSampleRate
    const { left, right } = synthDemoSamples(type, sampleRate, durationSec)
    const buffer = new AudioBuffer({ numberOfChannels: 2, length: left.length, sampleRate })
    buffer.getChannelData(0).set(left)
    buffer.getChannelData(1).set(right)
    return buffer
  }

  /**
   * Inicia la reproduccion de clips de audio + MIDI en la timeline desde `startSec`.
   * Audio clips → Plugin Host; MIDI → noteOn/Off con delay en samples del host.
   */
  public async playClips(
    startSec: number,
    clips: AudioClipPlaybackInfo[],
    tracksConfig: TrackAudioConfig[],
    midiClips: MidiClipPlaybackInfo[] = [],
    projectBpm?: number,
  ): Promise<void> {
    this.stopAllSources()
    // Cada play/seek abre una generación nueva: subidas de una reproducción anterior que terminan
    // tarde ya no programan audio (era la "ráfaga" al reanudar tras una pausa).
    const gen = this.playGeneration

    this.isPlaying = true
    this.playheadStartSec = Math.max(0, startSec)
    this.startTime = 0
    this.resetPcmPace()
    const sr = this.getSampleRate()
    const tempo =
      projectBpm != null && projectBpm > 0
        ? projectBpm
        : getCachedHostTransportClock().tempo || 120

    const haySolos = tracksConfig.some((t) => t.soloActiva)
    const cfgById = new Map(tracksConfig.map((t, i) => [t.id, { ...t, stemIndex: t.stemIndex ?? i }]))
    for (const trk of tracksConfig) {
      this.updateTrackControls(trk.id, trk.volumen, trk.paneo, trk.silenciada, haySolos, trk.soloActiva)
    }

    const jobs = this.planClipJobs(clips, cfgById, haySolos)
    const hasHost = typeof window !== 'undefined' && Boolean(window.electron?.pluginHostSend)
    // Una subida por clip, compartida entre la fase previa y la programación.
    const uploads = new Map<string, Promise<boolean>>()
    const upload = (job: ClipJob): Promise<boolean> => {
      let p = uploads.get(job.clip.id)
      if (!p) {
        p = this.uploadClipToHost(job, hasHost).catch(() => false)
        uploads.set(job.clip.id, p)
      }
      return p
    }

    // Antes de arrancar el transporte se suben los clips que suenan en los primeros segundos: sin esto el
    // playhead y el metrónomo corrían con el audio mudo hasta que terminaba la subida.
    const urgent = jobs.filter((j) => j.delay < PLAY_PRELOAD_WINDOW_SEC)
    if (hasHost && urgent.length) {
      await Promise.race([
        Promise.all(urgent.map(upload)),
        new Promise((r) => setTimeout(r, PLAY_PRELOAD_MAX_WAIT_MS)),
      ])
      if (gen !== this.playGeneration) return
    }

    this.playWallEpochMs = performance.now()
    startHostTransportClockPoll()
    setHostTransportPlaying(true, tempo, (this.playheadStartSec * tempo) / 60)
    hostClipStopAll()

    void (async () => {
      for (const job of jobs) {
        try {
          const loaded = await upload(job)
          if (gen !== this.playGeneration) return
          if (!loaded) {
            this.startClipInWebAudio(job)
            continue
          }
          const { clip, cfg, delay, offset, remainingDuration } = job
          const stem = cfg?.stemIndex ?? 0
          // El host reproduce desde la posición correcta aunque la programación llegue tarde.
          const startSample = Math.round((this.playheadStartSec + delay) * sr)
          const durationSamples = Math.round(remainingDuration * sr)
          const sourceOffsetSamples = Math.round(offset * sr)
          // En modo stem el gain/pan viven únicamente en el graph del host
          // (applyTrackGainPan). Pasar gain/pan aquí además los duplicaría.
          // Solo en el path legacy (sin stem) el clip lleva su propio fader.
          const trackGain = this.stemMode ? 1 : cfg?.silenciada && !haySolos ? 0 : cfg?.volumen ?? 1
          const clipPan = this.stemMode ? 0 : cfg?.paneo ?? 0
          hostClipSchedule({
            clipId: clip.id,
            trackIndex: stem,
            startSample,
            durationSamples,
            sourceOffsetSamples,
            gain: trackGain * dbALineal(clip.gananciaDb),
            pan: clipPan,
            fades: {
              clipStartSample: Math.round(clip.inicio * sr),
              clipEndSample: Math.round((clip.inicio + clip.duracion) * sr),
              inSamples: Math.round(Math.max(0, clip.fadeInSec ?? 0) * sr),
              outSamples: Math.round(Math.max(0, clip.fadeOutSec ?? 0) * sr),
              inCurve: curvaFadeAHost(clip.fadeInCurva),
              outCurve: curvaFadeAHost(clip.fadeOutCurva),
              reverse: clip.inverso === true,
              regionStartSample: Math.round((clip.clipInicio ?? 0) * sr),
              regionLenSamples: Math.round(clip.duracion * sr),
            },
          })
        } catch (err) {
          console.warn('[audio-engine] host clip start failed', job.clip.id, err)
        }
      }
    })()

    try {
      this.beginMidiScheduler(midiClips, tracksConfig, haySolos)
    } catch (err) {
      console.warn('[audio-engine] midi schedule failed', err)
    }
  }

  /**
   * Pico absoluto (0..1) del audio decodificado de un clip en la región [desdeSec, desdeSec+durSec).
   * null si el audio aún no está decodificado en esta ventana.
   */
  public getClipPeak(keys: string[], desdeSec: number, durSec: number): number | null {
    let buffer: AudioBuffer | undefined
    for (const k of keys) {
      if (!k) continue
      buffer = this.audioBuffers.get(k) ?? this.audioBuffers.get(k.replace(/^.*[\\/]/, ''))
      if (buffer) break
    }
    if (!buffer) return null
    const sr = buffer.sampleRate
    const ini = Math.max(0, Math.floor(desdeSec * sr))
    const fin = Math.min(buffer.length, Math.ceil((desdeSec + durSec) * sr))
    let pico = 0
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c)
      for (let i = ini; i < fin; i++) {
        const v = Math.abs(d[i]!)
        if (v > pico) pico = v
      }
    }
    return pico
  }

  /** Clips que deben sonar desde el playhead, ordenados por cuándo empiezan. */
  private planClipJobs(
    clips: AudioClipPlaybackInfo[],
    cfgById: Map<string, TrackAudioConfig & { stemIndex: number }>,
    haySolos: boolean,
  ): ClipJob[] {
    const jobs: ClipJob[] = []
    for (const clip of clips) {
      if (clip.silenciado) continue
      const cfg = cfgById.get(clip.trackId)
      if (haySolos) {
        if (!cfg?.soloActiva) continue
      } else if (cfg?.silenciada) {
        continue
      }
      let buffer = this.audioBuffers.get(clip.sourcePathOrId) || this.audioBuffers.get(clip.id)
      const clipNombre = clip.name || clip.nombre
      if (!buffer && clipNombre) {
        buffer = this.audioBuffers.get(clipNombre)
      }
      if (!buffer && clip.sourcePathOrId) {
        const baseName = clip.sourcePathOrId.replace(/^.*[\\/]/, '')
        buffer = this.audioBuffers.get(baseName)
      }
      const clipStart = clip.inicio
      const clipDuration = clip.duracion || buffer?.duration || 0
      const clipEnd = clipStart + clipDuration
      if (this.playheadStartSec >= clipEnd || clipDuration <= 0) continue

      let offset = clip.clipInicio || 0
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
      jobs.push({ clip, cfg, buffer, delay, offset, remainingDuration })
    }
    return jobs.sort((a, b) => a.delay - b.delay)
  }

  /**
   * Con el audio ya decodificado se sube por trozos y se reutiliza entre play/seek (sin base64
   * gigante). Solo se pide al host que lea el archivo si no hay buffer y la ruta es absoluta
   * (una ruta relativa `media/x.wav` el host no la resuelve).
   */
  private async uploadClipToHost(job: ClipJob, hasHost: boolean): Promise<boolean> {
    if (!hasHost) return false
    if (job.buffer) return hostClipEnsureBuffer(job.clip.id, job.buffer)
    if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(job.clip.sourcePathOrId)) {
      return hostClipLoadPath(job.clip.id, job.clip.sourcePathOrId)
    }
    return false
  }

  /** Modo Web Audio (navegador o host nativo no disponible), alineado con el tiempo ya transcurrido. */
  private startClipInWebAudio(job: ClipJob): void {
    const { clip, buffer } = job
    if (!buffer) {
      console.warn('[audio-engine] el clip no se pudo cargar en el host ni en Web Audio', clip.id)
      this.onClipLoadFailed?.(clip.id)
      return
    }
    const elapsed =
      this.playWallEpochMs > 0 ? Math.max(0, (performance.now() - this.playWallEpochMs) / 1000) : 0
    const late = Math.max(0, elapsed - job.delay)
    const remaining = job.remainingDuration - late
    if (remaining <= 0.001) return
    const ctx = this.ensureContext()
    const trackNode = this.getTrackNode(clip.trackId)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    // Ganancia y fundidos del clip (rampas lineales: en Web Audio basta para evitar clics).
    const clipGain = ctx.createGain()
    const g = dbALineal(clip.gananciaDb)
    const t0 = ctx.currentTime + Math.max(0, job.delay - elapsed)
    // Posición dentro del clip (s) en la que empieza a sonar.
    const desde = this.playheadStartSec + elapsed + Math.max(0, job.delay - elapsed) - clip.inicio
    const fin = clip.duracion
    const fi = Math.max(0, clip.fadeInSec ?? 0)
    const fo = Math.max(0, clip.fadeOutSec ?? 0)
    const nivel = (pos: number) =>
      g * (fi > 0 && pos < fi ? Math.max(0, pos / fi) : 1) * (fo > 0 && pos > fin - fo ? Math.max(0, (fin - pos) / fo) : 1)
    clipGain.gain.setValueAtTime(nivel(desde), t0)
    if (fi > 0 && desde < fi) clipGain.gain.linearRampToValueAtTime(nivel(fi), t0 + (fi - desde))
    if (fo > 0) {
      const ini = Math.max(desde, fin - fo)
      clipGain.gain.setValueAtTime(nivel(ini), t0 + (ini - desde))
      clipGain.gain.linearRampToValueAtTime(0, t0 + (fin - desde))
    }
    source.connect(clipGain)
    clipGain.connect(trackNode.gain)
    source.start(t0, job.offset + late, remaining)
    this.activeSources.set(clip.id, source)
  }

  private beginMidiScheduler(
    midiClips: MidiClipPlaybackInfo[],
    tracksConfig: TrackAudioConfig[],
    _haySolos: boolean,
  ) {
    this.stopMidiScheduler()
    this.pendingTracksConfig = tracksConfig
    this.midiLookahead.begin(midiClips, tracksConfig, this.playheadStartSec)

    this.scheduleMidiLookahead()
    this.midiScheduleTimer = setInterval(() => {
      if (!this.isPlaying) {
        this.stopMidiScheduler()
        return
      }
      this.scheduleMidiLookahead()
    }, MIDI_TICK_MS)
  }

  /** Hot-patch: slot VST confirmado en runtime. No borrar si viene undefined (ensure fallido). */
  public patchTrackVstInstrument(trackId: string, slotId: string | undefined, capas?: string[]): void {
    if (!slotId) return
    const anterior = this.pendingTracksConfig.find((t) => t.id === trackId)?.vstInstrumentSlotId
    // Una capa nueva entra desde las siguientes notas: rebobinar duplicaría las ya encoladas en el principal.
    this.pendingTracksConfig = this.pendingTracksConfig.map((t) =>
      t.id === trackId
        ? { ...t, vstInstrumentSlotId: slotId, ...(capas ? { vstLayerSlotIds: capas.length > 0 ? capas : undefined } : {}) }
        : t,
    )
    this.midiLookahead.setTracks(this.pendingTracksConfig)
    // Solo si el slot CAMBIÓ hay que reenviar: las notas ya encoladas iban a otro slot. Con el mismo slot,
    // rebobinar reenviaba las notas ya encoladas en el host y la primera nota del play sonaba dos veces
    // (este aviso llega para todas las pistas al confirmar los slots justo al arrancar). Tras un reinicio
    // del host (mismo slot, proceso nuevo) el reenvío lo hace rescheduleMidiAfterHostRestart().
    if (this.isPlaying && anterior !== slotId) {
      this.midiLookahead.rewindTrack(trackId)
      this.scheduleMidiLookahead()
    }
  }

  /** Tras restart del Plugin Host: reenviar MIDI vivo (mismos slotIds, proceso nuevo). */
  public rescheduleMidiAfterHostRestart(): void {
    if (!this.isPlaying) return
    this.midiLookahead.rewindAll()
    this.scheduleMidiLookahead()
  }

  /** W2: programa en el WebSynth las notas del clip que caen en la ventana. */
  private scheduleWebSynthClip(
    clip: MidiClipPlaybackInfo,
    cfg: TrackAudioConfig,
    windowStart: number,
    windowEnd: number,
    nowTimeline: number,
    voices: VoiceKeys,
    playheadStartSec: number,
  ) {
    if (!this.webSynth.listo) {
      void this.webSynth.preparar()
      return
    }
    const ctxAhora = this.ensureContext().currentTime
    const preset = cfg.instrumentoWeb ?? 'piano'
    clip.notes.forEach((note, ni) => {
      const inicio = Math.max(note.startSec, playheadStartSec)
      const fin = note.startSec + Math.max(0.03, note.durationSec)
      if (inicio < windowStart || inicio >= windowEnd || fin - inicio <= 0.02) return
      const key = noteVoiceKey(clip.id, ni, note.pitch, note.startSec)
      if (voices.has(key)) return
      const cuando = ctxAhora + Math.max(0, inicio - nowTimeline)
      if (this.webSynth.nota(clip.trackId, preset, note.pitch, note.velocity, cuando, fin - inicio)) voices.add(key)
    })
  }

  private stopMidiScheduler() {
    if (this.midiScheduleTimer) {
      clearInterval(this.midiScheduleTimer)
      this.midiScheduleTimer = null
    }
    for (const t of this.vstMidiTimers) clearTimeout(t)
    this.vstMidiTimers = []
    allNotesOffAllTracks()
    this.webSynth.silenciarTodo()
  }

  /**
   * Programa MIDI por ventanas sin AudioContext (reloj host). Horizonte largo
   * (MIDI_HORIZON_SEC): un bloqueo del hilo principal del renderer menor que el
   * horizonte no deja al host sin notas.
   */
  private scheduleMidiLookahead() {
    if (!this.isPlaying) return
    this.midiLookahead.tick(this.getMidiTimelineSeconds())
  }

  /** Playback MIDI → Plugin Host (slot ya loaded/prepared). */
  private scheduleVstMidiNote(
    slotId: string,
    pitch: number,
    velocity: number,
    whenSec: number,
    durationSec: number,
    nowTimeline = this.getMidiTimelineSeconds(),
    sr = this.getSampleRate(),
  ) {
    const delayOn = Math.max(
      0,
      Math.round((whenSec - nowTimeline + this.nativePathAheadSec()) * sr),
    )
    const lengthSamples = Math.max(32, Math.round(durationSec * sr))
    const delayOff = delayOn + lengthSamples
    sendVstNote(slotId, true, pitch, velocity, delayOn, lengthSamples)
    sendVstNote(slotId, false, pitch, 0, delayOff)
  }

  /**
   * Detiene todos los nodos de fuente activos
   */
  /**
   * Stop (no pausa): además de parar voces y clips, el host vacía en el acto el DSP de todos los plugins,
   * incluidas las colas de reverb y delay. En pausa las colas caen solas (solo stopAllSources).
   */
  public async hardStop(): Promise<void> {
    this.stopAllSources()
    if (typeof window === 'undefined' || !window.electron?.pluginHostSend) return
    try {
      await window.electron.pluginHostSend({ type: 'hardStop' })
    } catch {
      /* host caído: no hay nada sonando */
    }
  }

  public stopAllSources() {
    this.playGeneration += 1
    // Primero panic MIDI (antes de parar transport) para vaciar colas delaySamples.
    try {
      allNotesOffAllTracks()
    } catch {
      /* ignore */
    }
    this.stopMidiScheduler()
    setHostTransportPlaying(false)
    // Segundo panic tras setTransport(false): VSTs cortan al ver !kPlaying.
    try {
      allNotesOffAllTracks()
    } catch {
      /* ignore */
    }
    hostClipStopAll()
    stopHostTransportClockPoll()
    this.midiLookahead.clear()
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
    if (isNativeMeterHostAvailable()) {
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

  /**
   * Picos L/R lineales (0..1, sin curva) post-fader de la pista: VU estéreo con escala en dB.
   * El nodo Web Audio solo da un pico mono, que se reparte a ambos canales.
   */
  public getStereoMeterPeaks(trackId: string): { l: number; r: number } {
    let l = 0
    let r = 0
    if (isNativeMeterHostAvailable()) {
      const p = getNativeTrackPeakStereo(trackId)
      if (p) {
        l = p.l
        r = p.r
      }
    }
    const node = this.trackNodes.get(trackId)
    if (node) {
      node.analyser.getByteTimeDomainData(node.dataArray)
      const web = peakFromByteTimeDomain(node.dataArray)
      if (web > l) l = web
      if (web > r) r = web
    }
    return { l, r }
  }

  /** Picos L/R lineales del master (mismo criterio que {@link getMasterMeterLevel}). */
  public getMasterStereoPeaks(): { l: number; r: number } {
    let l = 0
    let r = 0
    if (isNativeMeterHostAvailable()) {
      if (hasFreshNativeMeters()) {
        const m = getNativeMasterMetering()
        l = m.peakL
        r = m.peakR
        if (l === 0 && r === 0) l = r = getNativeMasterPeak()
      } else if (!hasFreshNativeMeters(Number.POSITIVE_INFINITY)) {
        // El host aún no ha reportado nunca: el máximo de los stems es la única referencia.
        l = r = getNativeMaxStemPeak()
      }
      // Reporte viejo (host ocupado): no se repite una lectura congelada; manda la parte Web Audio.
    }
    if (this.masterAnalyser && this.masterMeterData) {
      this.masterAnalyser.getByteTimeDomainData(this.masterMeterData)
      const web = peakFromByteTimeDomain(this.masterMeterData)
      if (web > l) l = web
      if (web > r) r = web
    }
    return { l, r }
  }

  public getMasterMeterLevel(): number {
    let native = 0
    if (isNativeMeterHostAvailable()) {
      // El master mide su propia salida (post-fader y post-mute). Solo si el host aún no reporta se
      // recurre al máximo de stems; si no, un master silenciado se vería moviéndose.
      native = hasFreshNativeMeters() ? getNativeMasterPeak() : getNativeMaxStemPeak()
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
    const maxFrames = Math.floor(this.getSampleRate() * MAX_CAPTURE_SECONDS)
    if (session.frames + n > maxFrames) {
      if (!session.truncated) {
        session.truncated = true
        const msg = `Grabación detenida al llegar a ${MAX_CAPTURE_SECONDS / 60} min por toma (límite de memoria).`
        console.warn(`[audio-engine] ${msg}`)
        window.electron?.logError?.('recording', msg)
      }
      return
    }
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
