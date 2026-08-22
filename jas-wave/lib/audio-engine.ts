/**
 * Motor de Audio Web Audio API para Jaswave DAW.
 * 
 * Permite la carga de archivos de audio (WAV, MP3, OGG, WebM, FLAC),
 * la síntesis de clips de demostración (batería, bajo, sintetizador),
 * la reproducción sincronizada con la timeline y el control de ganancia,
 * paneo y medición en tiempo real para el mixer.
 */

import { routeMidiToActiveVst } from '@/src/lib/plugin/vst-voice-router'
import { allNotesOffAllTracks, sendVstNote } from '@/src/lib/plugin/track-vst-runtime'

export interface TrackAudioConfig {
  id: string
  volumen: number // 0.0 a 1.0 (o dB convertido)
  paneo: number // -1.0 (izquierda) a 1.0 (derecha)
  silenciada: boolean
  soloActiva: boolean
  /** Slot del Plugin Host para el instrumento VST3 de esta pista. */
  vstInstrumentSlotId?: string
  /** Soft Pad / synth local aunque haya VST (VST puede ir mudo sin samples). */
  softPadFallback?: boolean
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
}

export class WebAudioEngine {
  private audioCtx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private masterPanner: StereoPannerNode | null = null
  private masterAnalyser: AnalyserNode | null = null
  private masterMeterData: Uint8Array<ArrayBuffer> | null = null
  private masterVolume = 1.0
  private masterMuted = false
  private trackNodes = new Map<
    string,
    {
      gain: GainNode
      panner: StereoPannerNode
      analyser: AnalyserNode
      dataArray: Uint8Array<ArrayBuffer>
    }
  >()
  private audioBuffers = new Map<string, AudioBuffer>()
  private activeSources = new Map<string, AudioBufferSourceNode>()
  /** Voces programadas de reproducción MIDI (timeline). */
  private activeMidiNodes: Array<{ osc: OscillatorNode; gain: GainNode }> = []
  private midiScheduleTimer: ReturnType<typeof setInterval> | null = null
  private pendingMidiClips: MidiClipPlaybackInfo[] = []
  private pendingTracksConfig: TrackAudioConfig[] = []
  private midiScheduledUntilSec = 0
  private midiHaySolos = false
  private midiVoiceKeys = new Set<string>()
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

  public ensureContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext
      // latencyHint playback: buffer mas estable, menos underruns/crackeo
      this.audioCtx = new AudioCtxClass({ latencyHint: 'playback' })

      this.masterGain = this.audioCtx.createGain()
      this.masterGain.gain.value = this.masterMuted ? 0 : this.masterVolume

      this.masterPanner = this.audioCtx.createStereoPanner()
      this.masterPanner.pan.value = 0

      // Soft limiter: evita saturacion cuando hay muchas fuentes
      const limiter = this.audioCtx.createDynamicsCompressor()
      limiter.threshold.value = -6
      limiter.knee.value = 12
      limiter.ratio.value = 8
      limiter.attack.value = 0.003
      limiter.release.value = 0.15
      ;(this as any).masterLimiter = limiter

      this.masterAnalyser = this.audioCtx.createAnalyser()
      this.masterAnalyser.fftSize = 256
      this.masterAnalyser.smoothingTimeConstant = 0.8
      this.masterMeterData = new Uint8Array(this.masterAnalyser.frequencyBinCount)

      // Cadena: gain -> panner -> limiter -> analyser -> destination
      this.masterGain.connect(this.masterPanner)
      this.masterPanner.connect(limiter)
      limiter.connect(this.masterAnalyser)
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

  public getMasterMeterLevel(): number {
    if (!this.masterAnalyser || !this.masterMeterData) return 0
    this.masterAnalyser.getByteFrequencyData(this.masterMeterData)
    let sum = 0
    for (let i = 0; i < this.masterMeterData.length; i++) {
      sum += this.masterMeterData[i]
    }
    const avg = sum / this.masterMeterData.length
    return Math.min(1, avg / 128)
  }

  public getTrackNode(trackId: string) {
    const ctx = this.ensureContext()
    if (!this.trackNodes.has(trackId)) {
      const gain = ctx.createGain()
      const panner = ctx.createStereoPanner()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      // Cadena: gain -> panner -> analyser -> masterGain
      gain.connect(panner)
      panner.connect(analyser)
      analyser.connect(this.masterGain!)

      this.trackNodes.set(trackId, { gain, panner, analyser, dataArray })
    }
    return this.trackNodes.get(trackId)!
  }

  public updateTrackControls(trackId: string, volumen: number, paneo: number, silenciada: boolean, haySolosActivos: boolean, soloActiva: boolean) {
    const node = this.getTrackNode(trackId)
    const ctx = this.audioCtx

    let effectiveGain = Math.max(0, Math.min(1, volumen))
    // Solo por encima del mute: pista en solo suena aunque esté muteada
    if (haySolosActivos) {
      if (!soloActiva) effectiveGain = 0
    } else if (silenciada) {
      effectiveGain = 0
    }

    if (ctx) {
      node.gain.gain.setTargetAtTime(effectiveGain, ctx.currentTime, 0.02)
      node.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, paneo)), ctx.currentTime, 0.02)
    } else {
      node.gain.gain.value = effectiveGain
      node.panner.pan.value = Math.max(-1, Math.min(1, paneo))
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
    for (const [key, buf] of this.audioBuffers) {
      if (key.startsWith('demo-')) continue
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

  /** Preview MIDI: nota encendida (Soft Pad in-process). */
  public noteOn(pitch: number, velocity = 90): void {
    if (routeMidiToActiveVst(true, pitch, velocity)) return
    const ctx = this.ensureContext()
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
      gain.connect(this.ensureSynthBus())
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
    const ctx = this.ensureContext()
    const sampleRate = ctx.sampleRate
    const length = Math.floor(sampleRate * durationSec)
    const buffer = ctx.createBuffer(2, length, sampleRate)
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
    }, 250)
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
    const horizon = 2.5
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
    const maxNotes = 48
    let scheduled = 0

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
        if (scheduled >= maxNotes) return
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
          if (vstSlot) {
            this.scheduleVstMidiNote(vstSlot, note.pitch, note.velocity, when, dur)
          }
          if (!vstSlot || cfg?.softPadFallback) {
            this.scheduleMidiVoice(ctx, trackNode.gain, note.pitch, note.velocity, when, dur)
          }
          this.midiVoiceKeys.add(key)
          scheduled++
        } catch (err) {
          console.warn('[audio-engine] midi voice failed', err)
        }
      }
    }
  }

  /** Playback MIDI → Plugin Host (timing por setTimeout; MVP audible). */
  private scheduleVstMidiNote(
    slotId: string,
    pitch: number,
    velocity: number,
    when: number,
    durationSec: number,
  ) {
    const ctx = this.audioCtx
    if (!ctx) return
    const delayOn = Math.max(0, (when - ctx.currentTime) * 1000)
    const delayOff = delayOn + Math.max(30, durationSec * 1000)
    const tOn = setTimeout(() => sendVstNote(slotId, true, pitch, velocity), delayOn)
    const tOff = setTimeout(() => sendVstNote(slotId, false, pitch, 0), delayOff)
    this.vstMidiTimers.push(tOn, tOff)
  }

  private scheduleMidiVoice(
    ctx: AudioContext,
    destination: AudioNode,
    pitch: number,
    velocity: number,
    when: number,
    durationSec: number,
  ) {
    const freq = 440 * Math.pow(2, (pitch - 69) / 12)
    const vel = Math.max(0.05, Math.min(1, velocity / 127))
    const dur = Math.max(0.04, durationSec)
    const attack = Math.min(0.01, dur * 0.15)
    const release = Math.min(0.08, dur * 0.3)
    const peak = Math.max(0.0002, 0.12 * vel)

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(peak, when + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur)

    osc.connect(gain)
    gain.connect(destination)

    const startAt = Math.max(when, ctx.currentTime)
    osc.start(startAt)
    osc.stop(startAt + dur + 0.02)
    this.activeMidiNodes.push({ osc, gain })
  }

  /**
   * Detiene todos los nodos de fuente activos
   */
  public stopAllSources() {
    this.stopMidiScheduler()
    this.pendingMidiClips = []
    this.midiVoiceKeys.clear()
    for (const source of this.activeSources.values()) {
      try {
        source.stop()
        source.disconnect()
      } catch {
        // Ignorar
      }
    }
    this.activeSources.clear()

    for (const voice of this.activeMidiNodes) {
      try {
        voice.osc.stop()
        voice.osc.disconnect()
        voice.gain.disconnect()
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
    this.isPlaying = false
  }

  public getMeterLevel(trackId: string): number {
    const node = this.trackNodes.get(trackId)
    if (!node) return 0

    node.analyser.getByteFrequencyData(node.dataArray)
    let sum = 0
    for (let i = 0; i < node.dataArray.length; i++) {
      sum += node.dataArray[i]
    }
    const avg = sum / node.dataArray.length
    return Math.min(1, avg / 128)
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
    if (!this.metronomeGain) return

    const osc = ctx.createOscillator()
    const env = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.value = accent ? 1800 : 1000

    env.gain.setValueAtTime(this.metronomeVolumen * (accent ? 1.0 : 0.6), time)
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.05)

    osc.connect(env)
    env.connect(this.metronomeGain)

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

    if (!this.metronomeGain) {
      this.metronomeGain = ctx.createGain()
      this.metronomeGain.gain.value = this.metronomeVolumen
      this.metronomeGain.connect(this.masterGain!)
    }

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
}

export const audioEngine = new WebAudioEngine()
