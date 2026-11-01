/**
 * Loudness ITU-R BS.1770-4 / EBU R128 en TS puro.
 *
 * - K-weighting (pre-filtro shelving + high-pass RLB) con coeficientes calculados para cualquier
 *   sample rate por transformada bilineal (a 48 kHz coinciden con la tabla de la norma).
 * - Momentary (400 ms) y short-term (3 s) como series temporales a 10 Hz + máximos.
 * - Integrated con gating absoluto −70 LUFS y relativo −10 LU (bloques de 400 ms, solape 75 %).
 * - LRA según EBU Tech 3342 (short-term, gating −70 LUFS y −20 LU, percentiles 10–95).
 * - True-peak por sobremuestreo 4× con FIR polifásico (ver `true-peak.ts`).
 */

import { medirTruePeak } from './true-peak'

export type LoudnessResult = {
  integrated: number
  /** Short-term máximo (LUFS). Antes era el último bloque; se conserva el campo por compatibilidad. */
  shortTerm: number
  /** Momentary máximo (LUFS). Antes era el último bloque; se conserva el campo por compatibilidad. */
  momentary: number
  /** Loudness Range (LU, EBU Tech 3342). */
  rangoDinamico: number
  /** Pico de muestra lineal. */
  peak: number
  /** Pico verdadero lineal (4×). */
  truePeak: number
  lufs: number
  momentaryMax?: number
  shortTermMax?: number
  /** Serie momentary (LUFS) a `pasoSerieSeg`; el valor i corresponde al bloque que termina en (i + 4)·0.1 s. */
  serieMomentary?: number[]
  /** Serie short-term (LUFS) a `pasoSerieSeg`; el valor i corresponde al bloque que termina en (i + 30)·0.1 s. */
  serieShortTerm?: number[]
  pasoSerieSeg?: number
  /** Igual a `rangoDinamico` (nombre EBU). */
  loudnessRange?: number
  peakDb?: number
  truePeakDb?: number
}

export type OpcionesLoudness = {
  /** Incluir series temporales momentary/short-term (por defecto true). */
  series?: boolean
}

export type CoeficientesBiquad = { b0: number; b1: number; b2: number; a1: number; a2: number }

/**
 * Coeficientes de las dos etapas del K-weighting para `sampleRate` (diseño bilineal con
 * pre-warping; parámetros analógicos de BS.1770 tal como los publica libebur128).
 */
export function coeficientesKWeighting(sampleRate: number): {
  preFiltro: CoeficientesBiquad
  rlb: CoeficientesBiquad
} {
  const fs = sampleRate > 0 ? sampleRate : 48000
  // Etapa 1: high-shelf (modelo acústico de la cabeza).
  const f0 = 1681.974450955533
  const G = 3.999843853973347
  const Q = 0.7071752369554196
  const K = Math.tan((Math.PI * f0) / fs)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  const a0 = 1 + K / Q + K * K
  const preFiltro: CoeficientesBiquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  }
  // Etapa 2: high-pass RLB.
  const f1 = 38.13547087602444
  const Q1 = 0.5003270373238773
  const K1 = Math.tan((Math.PI * f1) / fs)
  const d = 1 + K1 / Q1 + K1 * K1
  const rlb: CoeficientesBiquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K1 * K1 - 1)) / d,
    a2: (1 - K1 / Q1 + K1 * K1) / d,
  }
  return { preFiltro, rlb }
}

export function lufsDesdeEnergia(ms: number): number {
  if (ms <= 1e-12) return -70
  return -0.691 + 10 * Math.log10(ms)
}

function redondear2(x: number): number {
  return Math.round(x * 100) / 100
}

export function dbDesdeLineal(x: number): number {
  if (x <= 1e-12) return -120
  return 20 * Math.log10(x)
}

/** Ponderación por canal BS.1770 (L, R, C = 1; Ls, Rs = 1.41 en 5.x; LFE excluido en 6 canales). */
function pesoCanal(c: number, nCh: number): number {
  if (nCh === 6) {
    if (c === 3) return 0
    if (c === 4 || c === 5) return 1.41
  }
  if (nCh === 5 && (c === 3 || c === 4)) return 1.41
  return 1
}

/** Convierte a Float32Array sin copiar si ya lo es (o Float64Array). */
export function comoArrayNumerico(ch: ArrayLike<number>): Float32Array | Float64Array {
  if (ch instanceof Float32Array || ch instanceof Float64Array) return ch
  const out = new Float32Array(ch.length)
  for (let i = 0; i < ch.length; i++) out[i] = Number(ch[i] ?? 0)
  return out
}

/** Datos intermedios por sub-bloques de 100 ms (reutilizados por mix-analysis). */
export type SubBloquesNivel = {
  sampleRate: number
  /** Muestras por sub-bloque (≈ fs/10). */
  muestrasSubBloque: number
  /** Energía K-ponderada por sub-bloque (Σ G_c·Σ y², sin dividir). */
  energiaK: Float64Array
  /** Energía sin ponderar por sub-bloque (Σ_c Σ x²). */
  energiaCruda: Float64Array
  /** Pico de muestra por sub-bloque (máx sobre canales). */
  picoSubBloque: Float64Array
  /** Σ x² total (todas las muestras de todos los canales). */
  energiaCrudaTotal: number
  picoMuestras: number
}

/** Una pasada por canal: K-weighting + acumulación por sub-bloques de 100 ms. */
export function calcularSubBloques(
  canales: (Float32Array | Float64Array)[],
  sampleRate: number,
): SubBloquesNivel {
  const nCh = canales.length
  const frames = canales[0]?.length ?? 0
  const muestrasSubBloque = Math.max(1, Math.round(sampleRate / 10))
  const nSub = Math.floor(frames / muestrasSubBloque)
  const energiaK = new Float64Array(nSub)
  const energiaCruda = new Float64Array(nSub)
  const picoSubBloque = new Float64Array(nSub)
  const { preFiltro: p, rlb: r } = coeficientesKWeighting(sampleRate)
  let energiaCrudaTotal = 0
  let picoMuestras = 0
  for (let c = 0; c < nCh; c++) {
    const x = canales[c]!
    const g = pesoCanal(c, nCh)
    let z1 = 0
    let z2 = 0
    let w1 = 0
    let w2 = 0
    let i = 0
    for (let s = 0; s <= nSub; s++) {
      const fin = s < nSub ? (s + 1) * muestrasSubBloque : frames
      let accK = 0
      let accC = 0
      let pico = 0
      for (; i < fin; i++) {
        const v = x[i]!
        // Etapa 1 (DF2 transpuesta)
        const y = p.b0 * v + z1
        z1 = p.b1 * v - p.a1 * y + z2
        z2 = p.b2 * v - p.a2 * y
        // Etapa 2
        const u = y + w1
        w1 = -2 * y - r.a1 * u + w2
        w2 = y - r.a2 * u
        accK += u * u
        accC += v * v
        const a = v < 0 ? -v : v
        if (a > pico) pico = a
      }
      if (s < nSub) {
        energiaK[s] = energiaK[s]! + g * accK
        energiaCruda[s] = energiaCruda[s]! + accC
        if (pico > picoSubBloque[s]!) picoSubBloque[s] = pico
      }
      energiaCrudaTotal += accC
      if (pico > picoMuestras) picoMuestras = pico
    }
  }
  return { sampleRate, muestrasSubBloque, energiaK, energiaCruda, picoSubBloque, energiaCrudaTotal, picoMuestras }
}

/** Energías medias (ms) de bloques deslizantes de `largo` sub-bloques con salto de 1 sub-bloque. */
function bloquesDeslizantes(energiaK: Float64Array, largo: number, muestrasSubBloque: number): Float64Array {
  const n = energiaK.length - largo + 1
  if (n <= 0) return new Float64Array(0)
  const out = new Float64Array(n)
  let acc = 0
  for (let i = 0; i < largo; i++) acc += energiaK[i]!
  const div = largo * muestrasSubBloque
  out[0] = acc / div
  for (let i = 1; i < n; i++) {
    acc += energiaK[i + largo - 1]! - energiaK[i - 1]!
    out[i] = Math.max(0, acc) / div
  }
  return out
}

const UMBRAL_ABSOLUTO_MS = Math.pow(10, (-70 + 0.691) / 10)

/** Integrated (BS.1770-4) a partir de energías de bloques de 400 ms. */
export function integradoConGating(bloquesMs: ArrayLike<number>): number {
  let suma = 0
  let n = 0
  for (let i = 0; i < bloquesMs.length; i++) {
    const m = bloquesMs[i]!
    if (m > UMBRAL_ABSOLUTO_MS) {
      suma += m
      n++
    }
  }
  if (n === 0) return -70
  const umbralRel = (suma / n) * 0.1 // −10 LU
  let sumaG = 0
  let nG = 0
  for (let i = 0; i < bloquesMs.length; i++) {
    const m = bloquesMs[i]!
    if (m > UMBRAL_ABSOLUTO_MS && m > umbralRel) {
      sumaG += m
      nG++
    }
  }
  return nG ? lufsDesdeEnergia(sumaG / nG) : -70
}

/** LRA según EBU Tech 3342 a partir de energías short-term (3 s). */
export function rangoLoudnessTech3342(shortMs: ArrayLike<number>): number {
  const sobreAbs: number[] = []
  let suma = 0
  for (let i = 0; i < shortMs.length; i++) {
    const m = shortMs[i]!
    if (m > UMBRAL_ABSOLUTO_MS) {
      sobreAbs.push(m)
      suma += m
    }
  }
  if (sobreAbs.length < 2) return 0
  const umbralRel = (suma / sobreAbs.length) * 0.01 // −20 LU
  const valores = sobreAbs.filter((m) => m > umbralRel).map(lufsDesdeEnergia)
  if (valores.length < 2) return 0
  valores.sort((a, b) => a - b)
  const idx = (p: number) => Math.round((valores.length - 1) * p)
  return Math.max(0, valores[idx(0.95)]! - valores[idx(0.1)]!)
}

function maximo(xs: ArrayLike<number>): number {
  let m = 0
  for (let i = 0; i < xs.length; i++) if (xs[i]! > m) m = xs[i]!
  return m
}

/** Construye el resultado de loudness a partir de sub-bloques ya calculados. */
export function loudnessDesdeSubBloques(
  sub: SubBloquesNivel,
  truePeak: number,
  opts?: OpcionesLoudness,
): LoudnessResult {
  const momMs = bloquesDeslizantes(sub.energiaK, 4, sub.muestrasSubBloque)
  const shortMs = bloquesDeslizantes(sub.energiaK, 30, sub.muestrasSubBloque)
  const integrated = integradoConGating(momMs)
  const lra = rangoLoudnessTech3342(shortMs)
  const momentaryMax = momMs.length ? lufsDesdeEnergia(maximo(momMs)) : -70
  const shortTermMax = shortMs.length ? lufsDesdeEnergia(maximo(shortMs)) : -70
  const res: LoudnessResult = {
    integrated,
    shortTerm: shortTermMax,
    momentary: momentaryMax,
    rangoDinamico: lra,
    peak: sub.picoMuestras,
    truePeak,
    lufs: integrated,
    momentaryMax,
    shortTermMax,
    loudnessRange: lra,
    peakDb: dbDesdeLineal(sub.picoMuestras),
    truePeakDb: dbDesdeLineal(truePeak),
  }
  if (opts?.series !== false) {
    res.serieMomentary = Array.from(momMs, (m) => redondear2(lufsDesdeEnergia(m)))
    res.serieShortTerm = Array.from(shortMs, (m) => redondear2(lufsDesdeEnergia(m)))
    res.pasoSerieSeg = sub.muestrasSubBloque / sub.sampleRate
  }
  return res
}

function resultadoVacio(): LoudnessResult {
  return {
    integrated: -70,
    shortTerm: -70,
    momentary: -70,
    rangoDinamico: 0,
    peak: 0,
    truePeak: 0,
    lufs: -70,
    momentaryMax: -70,
    shortTermMax: -70,
    serieMomentary: [],
    serieShortTerm: [],
    pasoSerieSeg: 0.1,
    loudnessRange: 0,
    peakDb: -120,
    truePeakDb: -120,
  }
}

/**
 * Analiza canales separados (float −1..1) a cualquier sample rate.
 */
export function measureLoudnessBs1770(
  channels: ArrayLike<number>[],
  sampleRate: number,
  opts?: OpcionesLoudness,
): LoudnessResult {
  const frames = channels[0]?.length ?? 0
  if (frames === 0 || channels.length === 0) return resultadoVacio()
  const canales = channels.map(comoArrayNumerico)
  const sub = calcularSubBloques(canales, sampleRate)
  const truePeak = medirTruePeak(canales, sub.picoMuestras)
  return loudnessDesdeSubBloques(sub, truePeak, opts)
}

export type ObjetivoPlataforma = {
  lufs: number
  truePeakDb: number
  descripcion: string
}

/** Objetivos de loudness por plataforma (integrated LUFS y techo de true-peak). */
export const LOUDNESS_PLATFORM_TARGETS = {
  spotify: { lufs: -14, truePeakDb: -1, descripcion: 'Spotify (normalización −14 LUFS)' },
  apple: { lufs: -16, truePeakDb: -1, descripcion: 'Apple Music (Sound Check −16 LUFS)' },
  youtube: { lufs: -14, truePeakDb: -1, descripcion: 'YouTube (−14 LUFS)' },
  amazon: { lufs: -14, truePeakDb: -2, descripcion: 'Amazon Music (−14 LUFS, −2 dBTP)' },
  club: { lufs: -8, truePeakDb: -0.3, descripcion: 'Club / DJ (master fuerte)' },
  broadcast: { lufs: -23, truePeakDb: -1, descripcion: 'Broadcast EBU R128 (−23 LUFS)' },
  cd: { lufs: -9, truePeakDb: -0.3, descripcion: 'CD / descarga (master fuerte)' },
  /** Alias histórico: streaming genérico = Spotify. */
  streaming: { lufs: -14, truePeakDb: -1, descripcion: 'Streaming genérico (−14 LUFS)' },
} as const satisfies Record<string, ObjetivoPlataforma>

export type LoudnessTargetName = keyof typeof LOUDNESS_PLATFORM_TARGETS

/** LUFS integrado objetivo por nombre (compatibilidad: mapa nombre → LUFS). */
export const LOUDNESS_TARGETS: { readonly [K in LoudnessTargetName]: (typeof LOUDNESS_PLATFORM_TARGETS)[K]['lufs'] } =
  Object.fromEntries(
    Object.entries(LOUDNESS_PLATFORM_TARGETS).map(([k, v]) => [k, v.lufs]),
  ) as never

export const LOUDNESS_TARGET_NAMES = Object.keys(LOUDNESS_PLATFORM_TARGETS) as LoudnessTargetName[]

export function esLoudnessTargetName(x: unknown): x is LoudnessTargetName {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(LOUDNESS_PLATFORM_TARGETS, x)
}

export function compareLoudnessTarget(
  integratedLufs: number,
  target: LoudnessTargetName,
  truePeakDb?: number,
): {
  targetLufs: number
  deltaDb: number
  gainLinear: number
  suggestion: string
  targetTruePeakDb: number
  /** Margen hasta el techo de true-peak tras aplicar `deltaDb` (si se pasó `truePeakDb`). */
  truePeakTrasGananciaDb?: number
} {
  const objetivo = LOUDNESS_PLATFORM_TARGETS[target]
  const targetLufs = objetivo.lufs
  const deltaDb = targetLufs - integratedLufs
  const gainLinear = Math.pow(10, deltaDb / 20)
  const tpTras = truePeakDb != null && Number.isFinite(truePeakDb) ? truePeakDb + deltaDb : undefined
  let suggestion =
    Math.abs(deltaDb) < 0.5
      ? `Ya está cerca del target ${target} (${targetLufs} LUFS).`
      : deltaDb > 0
        ? `Sube ~${deltaDb.toFixed(1)} dB el master (o baja el limiter threshold) hacia ${targetLufs} LUFS.`
        : `Baja ~${Math.abs(deltaDb).toFixed(1)} dB el master hacia ${targetLufs} LUFS.`
  if (tpTras != null && tpTras > objetivo.truePeakDb && deltaDb > 0) {
    suggestion += ` Con esa ganancia el true-peak llegaría a ${tpTras.toFixed(1)} dBTP (> ${objetivo.truePeakDb}): usa limitador.`
  }
  return {
    targetLufs,
    deltaDb,
    gainLinear,
    suggestion,
    targetTruePeakDb: objetivo.truePeakDb,
    ...(tpTras != null ? { truePeakTrasGananciaDb: tpTras } : {}),
  }
}
