/**
 * Espectro promediado (Welch) en 1/3 de octava + bandas agregadas, con densidades cruzadas L/R
 * para análisis estéreo por banda.
 *
 * - Ventana Hann de 8192 muestras, solape 50 %, sobre **toda** la señal (más un segmento final
 *   alineado al final si sobra cola).
 * - L y R se transforman con una sola FFT compleja (z = L + iR) y se separan por simetría.
 * - Cada bin cubre [(k−½)Δf, (k+½)Δf]; su potencia se reparte entre bandas proporcionalmente
 *   al solape (evita el error de cuantización en bandas graves estrechas).
 * - Nivel de banda = potencia (media cuadrática) en dB: un seno de amplitud A totalmente dentro de
 *   la banda da 20·log10(A) − 3.01 dB.
 */

import { fftEnLugar, ventanaHann } from './fft'

export type BandEnergy = {
  hzCenter: number
  label: string
  /** Potencia de la banda en dB (media cuadrática; seno a 0 dBFS pico = −3.01 dB). */
  db: number
  loHz?: number
  hiHz?: number
}

export type BandaEstereo = {
  label: string
  loHz: number
  hiHz: number
  /** Correlación L/R en la banda (−1..1). */
  correlacion: number
  /** Ancho = energía side / (mid + side): 0 mono, 0.5 descorrelado, 1 anti-fase. */
  ancho: number
  /** Pérdida (dB, ≥ 0) de la suma mono (L+R)/2 frente a la energía media por canal. */
  perdidaMonoDb: number
}

export type EspectroWelch = {
  /** 31 bandas de 1/3 de octava (20 Hz – 20 kHz, centros ISO). */
  tercios: BandEnergy[]
  /** Agregados: sub, low, lowmid, mid, highmid, high. */
  agregadas: BandEnergy[]
  /** Estéreo por banda agregada. */
  estereoPorBanda: BandaEstereo[]
  tamanoFft: number
  segmentos: number
}

export const CENTROS_TERCIO_OCTAVA = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000,
  2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
] as const

export const BANDAS_AGREGADAS = [
  { label: 'sub', loHz: 20, hiHz: 60 },
  { label: 'low', loHz: 60, hiHz: 250 },
  { label: 'lowmid', loHz: 250, hiHz: 500 },
  { label: 'mid', loHz: 500, hiHz: 2000 },
  { label: 'highmid', loHz: 2000, hiHz: 6000 },
  { label: 'high', loHz: 6000, hiHz: 20000 },
] as const

const TAMANO_WELCH = 8192

function etiquetaHz(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000
    return `${Number.isInteger(k) ? k.toFixed(0) : String(Math.round(k * 100) / 100)}k`
  }
  return String(hz)
}

/** Bordes exactos (base 10) de las bandas de 1/3 de octava: fc·10^(±1/20) con fc = 1000·10^(n/10). */
export function bandasTercioOctava(): { label: string; centro: number; loHz: number; hiHz: number }[] {
  return CENTROS_TERCIO_OCTAVA.map((nominal, i) => {
    const exacto = 1000 * Math.pow(10, (i - 17) / 10)
    return {
      label: etiquetaHz(nominal),
      centro: nominal,
      loHz: exacto * Math.pow(10, -1 / 20),
      hiHz: exacto * Math.pow(10, 1 / 20),
    }
  })
}

function dbPotencia(p: number): number {
  if (p <= 1e-14) return -140
  return 10 * Math.log10(p)
}

/** Integra una PSD unilateral (potencia por bin) en [lo, hi] con reparto fraccional por bin. */
function integrarBanda(psd: Float64Array, df: number, lo: number, hi: number): number {
  const nBins = psd.length
  const kIni = Math.max(0, Math.floor(lo / df - 0.5))
  const kFin = Math.min(nBins - 1, Math.ceil(hi / df + 0.5))
  let acc = 0
  for (let k = kIni; k <= kFin; k++) {
    const a = Math.max(lo, (k - 0.5) * df)
    const b = Math.min(hi, (k + 0.5) * df)
    if (b > a) acc += psd[k]! * ((b - a) / df)
  }
  return acc
}

export type DensidadesCruzadas = {
  /** Potencia unilateral por bin (media sobre segmentos), canal L. */
  pll: Float64Array
  prr: Float64Array
  /** Re(L·conj(R)) unilateral por bin. */
  plr: Float64Array
  df: number
  tamanoFft: number
  segmentos: number
}

/**
 * Densidades espectrales (Welch) de L, R y cruzada. Para mono pasa el mismo canal dos veces.
 */
export function densidadesWelch(
  l: ArrayLike<number>,
  r: ArrayLike<number>,
  sampleRate: number,
  tamano = TAMANO_WELCH,
): DensidadesCruzadas {
  const frames = Math.min(l.length, r.length)
  let N = tamano
  while (N > 256 && N > frames) N >>= 1
  const salto = N >> 1
  const w = ventanaHann(N)
  let sumW2 = 0
  for (let i = 0; i < N; i++) sumW2 += w[i]! * w[i]!
  const mitad = N >> 1
  const pll = new Float64Array(mitad + 1)
  const prr = new Float64Array(mitad + 1)
  const plr = new Float64Array(mitad + 1)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const inicios: number[] = []
  if (frames >= N) {
    for (let s = 0; s + N <= frames; s += salto) inicios.push(s)
    const ultimo = inicios[inicios.length - 1]!
    if (frames - (ultimo + N) > salto / 2) inicios.push(frames - N)
  } else if (frames > 0) {
    inicios.push(0)
  }
  for (const s of inicios) {
    const disponibles = Math.min(N, frames - s)
    for (let i = 0; i < disponibles; i++) {
      re[i] = Number(l[s + i]) * w[i]!
      im[i] = Number(r[s + i]) * w[i]!
    }
    for (let i = disponibles; i < N; i++) {
      re[i] = 0
      im[i] = 0
    }
    fftEnLugar(re, im)
    for (let k = 0; k <= mitad; k++) {
      const kn = k === 0 ? 0 : N - k
      const ar = re[k]!
      const ai = im[k]!
      const br = re[kn]!
      const bi = im[kn]!
      const lr = (ar + br) * 0.5
      const li = (ai - bi) * 0.5
      const rr = (ai + bi) * 0.5
      const ri = (br - ar) * 0.5
      pll[k] = pll[k]! + lr * lr + li * li
      prr[k] = prr[k]! + rr * rr + ri * ri
      plr[k] = plr[k]! + lr * rr + li * ri
    }
  }
  const segmentos = Math.max(1, inicios.length)
  // Potencia por bin: |X|²/(N·Σw²), unilateral ×2 salvo DC y Nyquist.
  const escala = 1 / (N * sumW2 * segmentos)
  for (let k = 0; k <= mitad; k++) {
    const f = k === 0 || k === mitad ? escala : 2 * escala
    pll[k] = pll[k]! * f
    prr[k] = prr[k]! * f
    plr[k] = plr[k]! * f
  }
  return { pll, prr, plr, df: sampleRate / N, tamanoFft: N, segmentos: inicios.length }
}

function bandaEstereo(
  d: DensidadesCruzadas,
  label: string,
  loHz: number,
  hiHz: number,
): BandaEstereo {
  const sll = integrarBanda(d.pll, d.df, loHz, hiHz)
  const srr = integrarBanda(d.prr, d.df, loHz, hiHz)
  const slr = integrarBanda(d.plr, d.df, loHz, hiHz)
  const den = Math.sqrt(sll * srr)
  const correlacion = den > 1e-20 ? Math.max(-1, Math.min(1, slr / den)) : 1
  const mid = Math.max(0, (sll + srr + 2 * slr) / 4)
  const side = Math.max(0, (sll + srr - 2 * slr) / 4)
  const ancho = mid + side > 1e-20 ? side / (mid + side) : 0
  const media = (sll + srr) / 2
  const perdidaMonoDb =
    media > 1e-20 ? Math.min(60, Math.max(0, -10 * Math.log10(Math.max(1e-6, mid / media)))) : 0
  return { label, loHz, hiHz, correlacion, ancho, perdidaMonoDb }
}

/** Espectro y estéreo por banda a partir de densidades ya calculadas. */
export function espectroDesdeDensidades(d: DensidadesCruzadas, sampleRate: number): EspectroWelch {
  const nyquist = sampleRate / 2
  const n = d.pll.length
  const media = new Float64Array(n)
  for (let k = 0; k < n; k++) media[k] = (d.pll[k]! + d.prr[k]!) / 2
  const tercios: BandEnergy[] = bandasTercioOctava().map((b) => {
    const hi = Math.min(b.hiHz, nyquist)
    const p = hi > b.loHz ? integrarBanda(media, d.df, b.loHz, hi) : 0
    return { hzCenter: b.centro, label: b.label, db: dbPotencia(p), loHz: b.loHz, hiHz: hi }
  })
  const agregadas: BandEnergy[] = BANDAS_AGREGADAS.map((b) => {
    const hi = Math.min(b.hiHz, nyquist)
    const p = hi > b.loHz ? integrarBanda(media, d.df, b.loHz, hi) : 0
    return {
      hzCenter: Math.round(Math.sqrt(b.loHz * b.hiHz)),
      label: b.label,
      db: dbPotencia(p),
      loHz: b.loHz,
      hiHz: hi,
    }
  })
  const estereoPorBanda = BANDAS_AGREGADAS.map((b) =>
    bandaEstereo(d, b.label, b.loHz, Math.min(b.hiHz, nyquist)),
  )
  return { tercios, agregadas, estereoPorBanda, tamanoFft: d.tamanoFft, segmentos: d.segmentos }
}

/**
 * Espectro Welch en 1/3 de octava. Con un canal se analiza mono; con dos o más se usan L (0) y R (1).
 */
export function medirEspectroWelch(canales: ArrayLike<number>[], sampleRate: number): EspectroWelch {
  const l = canales[0] ?? new Float32Array(0)
  const r = canales[1] ?? l
  return espectroDesdeDensidades(densidadesWelch(l, r, sampleRate), sampleRate)
}
