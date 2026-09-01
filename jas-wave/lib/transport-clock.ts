import type { TimePosition } from '../../shared/src/types/tiempo'

const PPQ = 480

function createZeroPosition(): TimePosition {
  return {
    beats: 0,
    segundos: 0,
    samples: 0,
    ticks: 0,
    compases: 0,
    frames: 0,
    tiempoMusical: '1.1.1.0',
    porcentaje: 0,
  }
}

function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds * bpm) / 60
}

/** Conserva beats/ticks absolutos; solo deriva compases y etiqueta musical. */
function decoratePosition(pos: TimePosition, timeSignatureNumerator: number = 4): TimePosition {
  const totalBeats = Math.max(0, pos.beats)
  const totalTicks = Math.max(0, pos.ticks)
  const compases = Math.floor(totalBeats / timeSignatureNumerator)
  const beatInBar = totalBeats % timeSignatureNumerator
  const ticksInBeat = totalTicks % PPQ
  return {
    ...pos,
    beats: totalBeats,
    ticks: totalTicks,
    segundos: Math.max(0, pos.segundos),
    samples: Math.max(0, pos.samples),
    compases,
    frames: Math.round(Math.max(0, pos.segundos) * 30),
    tiempoMusical: `${compases + 1}.${Math.floor(beatInBar) + 1}.${Math.floor(ticksInBeat) + 1}.0`,
    porcentaje: pos.porcentaje ?? 0,
  }
}

export interface TransportClockOptions {
  bpm: number
  timeSignatureNumerator: number
  startPosition?: TimePosition
}

export class TransportClock {
  private bpm: number
  private timeSignatureNumerator: number
  private playing = false
  private startWallTime = 0
  private startPosition: TimePosition
  private rafId: number | null = null
  private listeners = new Set<(position: TimePosition) => void>()
  private sampleRate = 48000
  /** Si está definido, el playhead sale de esta fuente (AudioContext) en vez de performance.now. */
  private timelineSeconds: (() => number) | null = null

  constructor(options: TransportClockOptions) {
    this.bpm = options.bpm
    this.timeSignatureNumerator = options.timeSignatureNumerator
    this.startPosition = options.startPosition
      ? decoratePosition(options.startPosition, options.timeSignatureNumerator)
      : createZeroPosition()
  }

  get isPlaying(): boolean {
    return this.playing
  }

  get currentBpm(): number {
    return this.bpm
  }

  setBpm(bpm: number): void {
    this.bpm = bpm
  }

  setTimeSignature(numerator: number): void {
    this.timeSignatureNumerator = numerator
  }

  setSampleRate(sr: number): void {
    if (sr >= 8000 && sr <= 192000) this.sampleRate = sr
  }

  /** Reloj de audio: getTimelineSeconds() del engine mientras hay playback. */
  setTimelineSource(source: (() => number) | null): void {
    this.timelineSeconds = source
  }

  play(): void {
    if (this.playing) return
    this.playing = true
    this.startWallTime = performance.now()
    this.tick()
  }

  /**
   * Pausa estilo Reaper: congela el playhead en la posición actual.
   * Al volver a play() continúa desde aquí.
   */
  pause(): void {
    if (!this.playing) return
    this.startPosition = this.computeAbsolutePosition()
    this.playing = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.notifyListeners(this.startPosition)
  }

  /** Stop: vuelve a cero. */
  stop(): void {
    this.playing = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.startPosition = createZeroPosition()
    this.notifyListeners(this.startPosition)
  }

  seek(position: TimePosition): void {
    this.startPosition = decoratePosition(position, this.timeSignatureNumerator)
    if (this.playing) {
      this.startWallTime = performance.now()
    } else {
      this.notifyListeners(this.startPosition)
    }
  }

  getCurrentPosition(): TimePosition {
    if (!this.playing) {
      return this.startPosition
    }
    return this.computeAbsolutePosition()
  }

  subscribe(listener: (position: TimePosition) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private computeAbsolutePosition(): TimePosition {
    if (this.timelineSeconds) {
      const segundos = Math.max(0, this.timelineSeconds())
      const beats = secondsToBeats(segundos, this.bpm)
      return decoratePosition(
        {
          beats,
          segundos,
          samples: Math.round(segundos * this.sampleRate),
          ticks: beats * PPQ,
          compases: 0,
          frames: 0,
          tiempoMusical: '',
          porcentaje: 0,
        },
        this.timeSignatureNumerator,
      )
    }
    const elapsedSeconds = (performance.now() - this.startWallTime) / 1000
    const elapsedBeats = secondsToBeats(elapsedSeconds, this.bpm)
    const segundos = this.startPosition.segundos + elapsedSeconds
    return decoratePosition(
      {
        beats: this.startPosition.beats + elapsedBeats,
        segundos,
        samples: Math.round(segundos * this.sampleRate),
        ticks: this.startPosition.ticks + elapsedBeats * PPQ,
        compases: 0,
        frames: 0,
        tiempoMusical: '',
        porcentaje: 0,
      },
      this.timeSignatureNumerator,
    )
  }

  private tick = (): void => {
    if (!this.playing) return
    this.notifyListeners(this.getCurrentPosition())
    this.rafId = requestAnimationFrame(this.tick)
  }

  private notifyListeners(position: TimePosition): void {
    for (const listener of this.listeners) {
      listener(position)
    }
  }
}
