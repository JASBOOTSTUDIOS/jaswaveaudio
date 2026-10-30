/**
 * Espectro de una pista para los módulos (V4): un AnalyserNode de 8192 puntos colgado de la salida de
 * la pista en el motor Web Audio. Solo se crea mientras alguien lo lee (un editor abierto) y se suelta
 * al cerrar: con el editor cerrado no cuesta nada.
 */

import { audioEngine } from '../../lib/audio-engine'

export type EspectroPista = {
  readonly sampleRate: number
  readonly fftSize: number
  /** dB por bin (getFloatFrequencyData); false si la pista no tiene audio aún. */
  leer: (destino: Float32Array) => boolean
  liberar: () => void
}

export function espectroDePista(trackId: string): EspectroPista | null {
  try {
    const nodo = audioEngine.getTrackNode(trackId)
    const ctx = nodo.analyser.context as AudioContext
    const analizador = ctx.createAnalyser()
    analizador.fftSize = 8192
    analizador.smoothingTimeConstant = 0
    analizador.minDecibels = -140
    analizador.maxDecibels = 0
    nodo.panner.connect(analizador)
    let libre = false
    return {
      sampleRate: ctx.sampleRate,
      fftSize: analizador.fftSize,
      leer: (destino) => {
        if (libre || ctx.state !== 'running') return false
        analizador.getFloatFrequencyData(destino as Float32Array<ArrayBuffer>)
        return true
      },
      liberar: () => {
        if (libre) return
        libre = true
        try {
          nodo.panner.disconnect(analizador)
        } catch {
          /* la pista ya no existe */
        }
      },
    }
  } catch {
    return null
  }
}
