/**
 * Espectro como en los VST (V3 §4.3): columnas log-frecuencia 20 Hz–20 kHz en dBFS (−120..0) con
 * inclinación de 3 dB/oct respecto a 1 kHz, y balística por tiempo: ataque instantáneo y caída de
 * 14 dB/s, idéntica para IN y OUT.
 */

export const F_MIN = 20
export const F_MAX = 20000
export const DB_MIN = -120
export const DB_MAX = 0
export const INCLINACION_DB_OCT = 3
export const CAIDA_DB_S = 14

export const xDeFrecuencia = (l: number, ancho: number, f: number, fMin = F_MIN, fMax = F_MAX) => l + (Math.log(f / fMin) / Math.log(fMax / fMin)) * ancho
export const frecuenciaDeX = (l: number, ancho: number, x: number, fMin = F_MIN, fMax = F_MAX) =>
  fMin * Math.pow(fMax / fMin, Math.min(1, Math.max(0, (x - l) / ancho)))
export const yDeDbfs = (t: number, alto: number, db: number) => t + alto - Math.min(1, Math.max(0, (db - DB_MIN) / (DB_MAX - DB_MIN))) * alto

/**
 * Reduce los bins de una FFT (dB por bin, p. ej. AnalyserNode.getFloatFrequencyData) a `n` columnas
 * log-frecuencia: interpolación si la columna es más estrecha que un bin, máximo si abarca varios.
 */
export function columnasDesdeBins(bins: ArrayLike<number>, sampleRate: number, fftSize: number, n: number, salida = new Float32Array(n)): Float32Array {
  const binHz = sampleRate / fftSize
  const ultimo = bins.length - 1
  const ratio = F_MAX / F_MIN
  for (let c = 0; c < n; c++) {
    const f0 = F_MIN * Math.pow(ratio, c / n)
    const f1 = F_MIN * Math.pow(ratio, (c + 1) / n)
    const b0 = f0 / binHz, b1 = f1 / binHz
    let v: number
    if (b1 - b0 <= 1) {
      const bc = 0.5 * (b0 + b1)
      const k = Math.min(Math.max(Math.floor(bc), 0), ultimo - 1)
      const fr = Math.min(Math.max(bc - k, 0), 1)
      v = (bins[k] ?? DB_MIN) * (1 - fr) + (bins[k + 1] ?? DB_MIN) * fr
    } else {
      v = -400
      for (let k = Math.max(0, Math.ceil(b0)); k <= Math.min(ultimo, Math.floor(b1)); k++) v = Math.max(v, bins[k] ?? DB_MIN)
    }
    if (!Number.isFinite(v)) v = DB_MIN - 20
    salida[c] = v + INCLINACION_DB_OCT * Math.log2(Math.sqrt(f0 * f1) / 1000)
  }
  return salida
}

/** Balística por tiempo real: sube al instante y cae a `caidaDbS` dB/s con el dt medido. */
export class Balistica {
  readonly valores: Float32Array
  constructor(n: number, private readonly caidaDbS = CAIDA_DB_S) {
    this.valores = new Float32Array(n).fill(DB_MIN - 20)
  }
  /** `nuevos` null = sin señal nueva (el espectro cae). dt en segundos (se limita a 0.25 s). */
  actualizar(nuevos: ArrayLike<number> | null, dt: number): Float32Array {
    const caida = this.caidaDbS * Math.min(Math.max(dt, 0), 0.25)
    for (let i = 0; i < this.valores.length; i++) {
      const previo = this.valores[i]!
      const d = nuevos ? nuevos[i]! : -Infinity
      this.valores[i] = d >= previo ? d : Math.max(d, previo - caida, DB_MIN - 20)
    }
    return this.valores
  }
}
