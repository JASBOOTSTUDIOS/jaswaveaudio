/**
 * WebSynth por pista (W2): en el navegador no hay plugin host, así que las pistas MIDI con instrumento
 * VST suenan con un sintetizador AudioWorklet. Cada pista tiene su nodo conectado a la entrada de su
 * canal (volumen, paneo y medidores del DAW siguen aplicando).
 */

import procesadorUrl from './web-synth-processor.js?url'

export type PresetWebSynth = 'pad' | 'bajo' | 'lead' | 'cuerdas' | 'fm' | 'piano' | 'bateria'

const REGLAS: ReadonlyArray<[RegExp, PresetWebSynth]> = [
  [/bater|drum|perc|kit|beat|roles.*bater|worship.*drum/i, 'bateria'],
  [/bajo|bass|sub\b|electric.*bass/i, 'bajo'],
  [/piano|keys|teclad|rhodes|epiano|grand.*piano/i, 'piano'],
  [/cuerda|string|violin|cello|orquest|strings.*section/i, 'cuerdas'],
  [/lead|melod|solo|synth lead|sierra|guitar|guitarra|electric.*guitar/i, 'lead'],
  [/fm|bell|campana|pluck|arpa/i, 'fm'],
  [/pad|ambient|atmos|coro|choir|shimmer/i, 'pad'],
]

/** Elige el preset a partir del nombre de la pista, sus etiquetas y los nombres de sus plugins. */
export function presetParaPista(textos: ReadonlyArray<string | undefined>): PresetWebSynth {
  const blob = textos.filter(Boolean).join(' ')
  return REGLAS.find(([re]) => re.test(blob))?.[1] ?? 'piano'
}

/** True en el cliente web (sin plugin host): ahí se usa el WebSynth. */
export function usarWebSynth(): boolean {
  return typeof window !== 'undefined' && !window.electron?.pluginHostSend
}

type NodoPista = { nodo: AudioWorkletNode; preset: PresetWebSynth; destino: AudioNode }

export class WebSynthPistas {
  private nodos = new Map<string, NodoPista>()
  private carga: Promise<void> | null = null
  private ctxCargado: BaseAudioContext | null = null

  constructor(
    private readonly ctx: () => AudioContext,
    private readonly destino: (trackId: string) => AudioNode,
  ) {}

  /** Carga el módulo del worklet una vez por AudioContext. */
  preparar(): Promise<void> {
    const ctx = this.ctx()
    if (this.carga && this.ctxCargado === ctx) return this.carga
    this.ctxCargado = ctx
    this.nodos.clear()
    this.carga = ctx.audioWorklet.addModule(procesadorUrl)
    return this.carga
  }

  get listo(): boolean {
    return !!this.carga && this.ctxCargado === this.ctx()
  }

  private nodoDe(trackId: string, preset: PresetWebSynth): AudioWorkletNode | null {
    if (!this.listo) return null
    const ctx = this.ctx()
    const destino = this.destino(trackId)
    let p = this.nodos.get(trackId)
    if (p && p.destino !== destino) {
      p.nodo.disconnect()
      p = undefined
    }
    if (!p) {
      const nodo = new AudioWorkletNode(ctx, 'jaswave-websynth', { numberOfOutputs: 1, outputChannelCount: [2] })
      nodo.connect(destino)
      p = { nodo, preset: '' as PresetWebSynth, destino }
      this.nodos.set(trackId, p)
    }
    if (p.preset !== preset) {
      p.nodo.port.postMessage({ tipo: 'preset', preset })
      p.preset = preset
    }
    return p.nodo
  }

  /** Programa una nota con inicio/fin en tiempo del AudioContext (sample-accurate en el worklet). */
  nota(trackId: string, preset: PresetWebSynth, pitch: number, velocidad: number, inicioCtx: number, duracionSec: number): boolean {
    const nodo = this.nodoDe(trackId, preset)
    if (!nodo) return false
    nodo.port.postMessage({ tipo: 'on', nota: pitch, vel: velocidad, cuando: inicioCtx })
    nodo.port.postMessage({ tipo: 'off', nota: pitch, cuando: inicioCtx + Math.max(0.02, duracionSec) })
    return true
  }

  /** Previsualización inmediata (teclas del piano roll, MIDI en vivo). */
  inmediata(trackId: string, preset: PresetWebSynth, on: boolean, pitch: number, velocidad: number): void {
    const nodo = this.nodoDe(trackId, preset)
    if (!nodo) return
    nodo.port.postMessage({ tipo: on ? 'on' : 'off', nota: pitch, vel: velocidad, cuando: this.ctx().currentTime })
  }

  /** Corta todo (stop, cambio de proyecto). */
  silenciarTodo(): void {
    for (const p of this.nodos.values()) p.nodo.port.postMessage({ tipo: 'panico' })
  }
}
