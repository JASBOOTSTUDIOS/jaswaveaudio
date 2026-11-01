/**
 * Transientes: densidad de onsets por flujo espectral y tiempo de ataque medio.
 *
 * - Mezcla a mono y diezma a ≈12 kHz (promedio por bloques; suficiente para detectar ataques).
 * - STFT Hann de 512 muestras, salto 128 (≈10.7 ms a 12 kHz); dos tramas por FFT compleja.
 * - Flujo = media por bin de la diferencia positiva de log(1 + γ·|X|).
 * - Picos: máximo local, por encima de un umbral adaptativo (media local ×1.5 + mínimo absoluto),
 *   con separación mínima de 50 ms.
 * - Ataque: tiempo entre el 10 % y el 90 % del ascenso de la envolvente (pico por 16 muestras)
 *   alrededor de cada onset.
 */

import { fftEnLugar, ventanaHann } from './fft'

export type MedicionTransientes = {
  onsets: number
  /** Onsets por segundo. */
  densidadPorSeg: number
  /** Tiempo de ataque medio (ms, 10 %→90 %); null si no hay onsets. */
  ataqueMedioMs: number | null
  /** Tiempos de onset (s), como máximo los primeros 512. */
  tiemposSeg: number[]
}

const N_STFT = 512
const SALTO_STFT = 128
const GAMMA = 100
const MINIMO_FLUJO = 0.02
const FACTOR_UMBRAL = 1.5
const SEPARACION_MIN_SEG = 0.05
const RES_ENVOLVENTE = 16

function monoDiezmado(canales: ArrayLike<number>[], factor: number): Float64Array {
  const nCh = Math.max(1, canales.length)
  const frames = canales[0]?.length ?? 0
  const n = Math.floor(frames / factor)
  const out = new Float64Array(n)
  const escala = 1 / (factor * nCh)
  for (let c = 0; c < canales.length; c++) {
    const x = canales[c]!
    for (let j = 0, i = 0; j < n; j++) {
      let s = 0
      for (let k = 0; k < factor; k++, i++) s += x[i] as number
      out[j] = out[j]! + s
    }
  }
  for (let j = 0; j < n; j++) out[j] = out[j]! * escala
  return out
}

/** Flujo espectral por trama (índice t ↔ inicio t·SALTO_STFT). */
function flujoEspectral(x: Float64Array): Float64Array {
  const nTramas = x.length >= N_STFT ? Math.floor((x.length - N_STFT) / SALTO_STFT) + 1 : 0
  const flujo = new Float64Array(nTramas)
  if (nTramas === 0) return flujo
  const w = ventanaHann(N_STFT)
  let sumW = 0
  for (let i = 0; i < N_STFT; i++) sumW += w[i]!
  const norma = 2 / sumW
  const mitad = N_STFT >> 1
  const re = new Float64Array(N_STFT)
  const im = new Float64Array(N_STFT)
  let previo = new Float64Array(mitad)
  let actual = new Float64Array(mitad)
  const otro = new Float64Array(mitad)
  for (let t = 0; t < nTramas; t += 2) {
    const s0 = t * SALTO_STFT
    const hayPar = t + 1 < nTramas
    const s1 = s0 + SALTO_STFT
    for (let i = 0; i < N_STFT; i++) {
      re[i] = x[s0 + i]! * w[i]!
      im[i] = hayPar ? x[s1 + i]! * w[i]! : 0
    }
    fftEnLugar(re, im)
    for (let k = 0; k < mitad; k++) {
      const kn = k === 0 ? 0 : N_STFT - k
      const ar = re[k]!
      const ai = im[k]!
      const br = re[kn]!
      const bi = im[kn]!
      const xr = (ar + br) * 0.5
      const xi = (ai - bi) * 0.5
      const yr = (ai + bi) * 0.5
      const yi = (br - ar) * 0.5
      actual[k] = Math.log1p(GAMMA * norma * Math.sqrt(xr * xr + xi * xi))
      otro[k] = Math.log1p(GAMMA * norma * Math.sqrt(yr * yr + yi * yi))
    }
    for (let par = 0; par < (hayPar ? 2 : 1); par++) {
      const espectro = par === 0 ? actual : otro
      const idx = t + par
      if (idx > 0) {
        let f = 0
        for (let k = 1; k < mitad; k++) {
          const d = espectro[k]! - previo[k]!
          if (d > 0) f += d
        }
        flujo[idx] = f / (mitad - 1)
      }
      if (par === 0) {
        const tmp = previo
        previo = actual
        actual = tmp
      } else {
        previo.set(otro)
      }
    }
  }
  return flujo
}

function picosOnset(flujo: Float64Array, saltoSeg: number): number[] {
  const n = flujo.length
  const radio = Math.max(2, Math.round(0.1 / saltoSeg))
  const sep = Math.max(1, Math.round(SEPARACION_MIN_SEG / saltoSeg))
  // Media local por suma prefija.
  const pref = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) pref[i + 1] = pref[i]! + flujo[i]!
  const picos: number[] = []
  let ultimo = -Infinity
  for (let t = 1; t < n - 1; t++) {
    const f = flujo[t]!
    if (f < MINIMO_FLUJO) continue
    if (f < flujo[t - 1]! || f < flujo[t + 1]!) continue
    const a = Math.max(0, t - radio)
    const b = Math.min(n, t + radio + 1)
    const mediaLocal = (pref[b]! - pref[a]!) / (b - a)
    if (f < mediaLocal * FACTOR_UMBRAL) continue
    if (t - ultimo < sep) {
      // Conserva el más fuerte dentro de la separación mínima.
      if (picos.length && f > flujo[picos[picos.length - 1]!]!) {
        picos[picos.length - 1] = t
        ultimo = t
      }
      continue
    }
    picos.push(t)
    ultimo = t
  }
  return picos
}

function envolvente(x: Float64Array): Float64Array {
  const n = Math.ceil(x.length / RES_ENVOLVENTE)
  const e = new Float64Array(n)
  for (let j = 0; j < n; j++) {
    let m = 0
    const fin = Math.min(x.length, (j + 1) * RES_ENVOLVENTE)
    for (let i = j * RES_ENVOLVENTE; i < fin; i++) {
      const a = Math.abs(x[i]!)
      if (a > m) m = a
    }
    e[j] = m
  }
  return e
}

/** Tiempo 10 %→90 % (en celdas de envolvente) del ascenso que precede al pico cercano al onset. */
function ataqueEnCeldas(env: Float64Array, ini: number, fin: number, retro: number): number | null {
  let p = ini
  for (let j = ini; j < fin; j++) if (env[j]! > env[p]!) p = j
  const pico = env[p]!
  if (pico <= 1e-6) return null
  let piso = pico
  let jPiso = p
  for (let j = p; j >= Math.max(0, p - retro); j--) {
    if (env[j]! < piso) {
      piso = env[j]!
      jPiso = j
    }
  }
  const subida = pico - piso
  if (subida < pico * 0.3) return null
  const n10 = piso + 0.1 * subida
  const n90 = piso + 0.9 * subida
  const cruce = (nivel: number): number => {
    for (let j = jPiso; j < p; j++) {
      const a = env[j]!
      const b = env[j + 1]!
      if (a < nivel && b >= nivel) return j + (nivel - a) / Math.max(1e-12, b - a)
    }
    return p
  }
  return Math.max(0, cruce(n90) - cruce(n10))
}

export function medirTransientes(canales: ArrayLike<number>[], sampleRate: number): MedicionTransientes {
  const frames = canales[0]?.length ?? 0
  const duracion = sampleRate > 0 ? frames / sampleRate : 0
  const vacio: MedicionTransientes = { onsets: 0, densidadPorSeg: 0, ataqueMedioMs: null, tiemposSeg: [] }
  if (frames === 0 || sampleRate <= 0) return vacio
  const factor = Math.max(1, Math.round(sampleRate / 12000))
  const fsd = sampleRate / factor
  const x = monoDiezmado(canales, factor)
  const flujo = flujoEspectral(x)
  const saltoSeg = SALTO_STFT / fsd
  const picos = picosOnset(flujo, saltoSeg)
  const env = envolvente(x)
  const celdaSeg = RES_ENVOLVENTE / fsd
  const retro = Math.round(0.05 / celdaSeg)
  let sumaAtaque = 0
  let nAtaque = 0
  for (const t of picos) {
    const ini = Math.floor((t * SALTO_STFT) / RES_ENVOLVENTE)
    const fin = Math.min(env.length, Math.ceil((t * SALTO_STFT + N_STFT) / RES_ENVOLVENTE))
    const a = ataqueEnCeldas(env, ini, fin, retro)
    if (a != null) {
      sumaAtaque += a * celdaSeg * 1000
      nAtaque++
    }
  }
  return {
    onsets: picos.length,
    densidadPorSeg: duracion > 0 ? picos.length / duracion : 0,
    ataqueMedioMs: nAtaque ? sumaAtaque / nAtaque : null,
    tiemposSeg: picos.slice(0, 512).map((t) => Math.round((t * SALTO_STFT + N_STFT / 2) * 1000 / fsd) / 1000),
  }
}
