/**
 * Análisis de mezcla post-bounce: loudness BS.1770 + true-peak + crest/PLR + espectro Welch en
 * 1/3 de octava + estéreo por banda + transientes.
 */

import {
  calcularSubBloques,
  comoArrayNumerico,
  compareLoudnessTarget,
  dbDesdeLineal,
  loudnessDesdeSubBloques,
  LOUDNESS_PLATFORM_TARGETS,
  type LoudnessResult,
  type LoudnessTargetName,
  type SubBloquesNivel,
} from './loudness-bs1770'
import { medirTruePeak } from './true-peak'
import { densidadesWelch, espectroDesdeDensidades, type BandEnergy, type BandaEstereo } from './spectrum'
import { medirEstereo, type MedicionEstereo } from './stereo'
import { medirTransientes, type MedicionTransientes } from './transients'

export type VentanasDinamica = {
  /** Duración de cada ventana (s). */
  pasoSeg: number
  /** RMS por ventana (dBFS, todas las muestras de todos los canales). */
  rmsDb: number[]
  /** Crest factor por ventana (pico − RMS, dB). */
  crestDb: number[]
  /** Estadísticas de crest sobre ventanas no silenciosas (RMS > −70 dBFS). */
  crestMinDb: number
  crestMedianaDb: number
  crestMaxDb: number
}

export type MixAnalysisReport = {
  loudness: LoudnessResult
  /** Crest factor real: pico de muestra − RMS global (dB). */
  crestFactorDb: number
  clippingSamples: number
  clipping: boolean
  stereoCorrelation: number
  /** 31 bandas de 1/3 de octava (potencia en dB, Welch sobre toda la señal). */
  spectrumBands: BandEnergy[]
  truePeakDb: number
  peakDb: number
  sampleRate: number
  frames: number
  /** RMS global (dBFS, media cuadrática de todas las muestras). */
  rmsDb?: number
  /** Peak-to-loudness ratio: true-peak (dBTP) − integrated (LUFS). */
  plrDb?: number
  /** Peak-to-short-term ratio: true-peak − short-term máximo. */
  psrDb?: number
  dinamicaVentanas?: VentanasDinamica
  /** Bandas agregadas (sub/low/lowmid/mid/highmid/high). */
  bandasAgregadas?: BandEnergy[]
  estereo?: MedicionEstereo
  transientes?: MedicionTransientes
}

export type AudioListenReport = MixAnalysisReport & {
  ok: boolean
  issues: string[]
  target?: LoudnessTargetName
  targetDeltaDb?: number
  suggestion?: string
  summary: string
  /** Avisos que no bloquean (ok no depende de ellos). */
  advertencias?: string[]
  targetLufs?: number
  targetTruePeakDb?: number
}

/** Correlación estéreo (−1..1). Mono ≈ 1; invertido ≈ −1. */
export function measureStereoCorrelation(l: ArrayLike<number>, r: ArrayLike<number>): number {
  return medirEstereo(l, r).correlacion
}

function countClipping(channels: ArrayLike<number>[], thresh = 0.999): number {
  let n = 0
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] as number
      if (v >= thresh || v <= -thresh) n++
    }
  }
  return n
}

/** Espectro Welch en 1/3 de octava (31 bandas). Con dos canales promedia la potencia de L y R. */
export function measureSpectrumBands(
  channels: ArrayLike<number>[],
  sampleRate: number,
): BandEnergy[] {
  const canales = channels.map(comoArrayNumerico)
  const l = canales[0] ?? new Float32Array(0)
  const r = canales[1] ?? l
  return espectroDesdeDensidades(densidadesWelch(l, r, sampleRate), sampleRate).tercios
}

const VENTANA_DINAMICA_SUBBLOQUES = 10 // 1 s

function redondear2(x: number): number {
  return Math.round(x * 100) / 100
}

function dinamicaPorVentanas(sub: SubBloquesNivel, nCh: number): VentanasDinamica {
  const porVentana = VENTANA_DINAMICA_SUBBLOQUES
  const nVent = Math.floor(sub.energiaCruda.length / porVentana)
  const rmsDb: number[] = []
  const crestDb: number[] = []
  const validos: number[] = []
  const muestras = sub.muestrasSubBloque * porVentana * Math.max(1, nCh)
  for (let v = 0; v < nVent; v++) {
    let e = 0
    let pico = 0
    for (let j = v * porVentana; j < (v + 1) * porVentana; j++) {
      e += sub.energiaCruda[j]!
      if (sub.picoSubBloque[j]! > pico) pico = sub.picoSubBloque[j]!
    }
    const rms = Math.sqrt(e / muestras)
    const r = dbDesdeLineal(rms)
    const c = rms > 1e-9 ? dbDesdeLineal(pico) - r : 0
    rmsDb.push(redondear2(r))
    crestDb.push(redondear2(c))
    if (r > -70) validos.push(c)
  }
  validos.sort((a, b) => a - b)
  return {
    pasoSeg: (sub.muestrasSubBloque * porVentana) / Math.max(1, sub.sampleRate),
    rmsDb,
    crestDb,
    crestMinDb: validos.length ? redondear2(validos[0]!) : 0,
    crestMedianaDb: validos.length ? redondear2(validos[Math.floor(validos.length / 2)]!) : 0,
    crestMaxDb: validos.length ? redondear2(validos[validos.length - 1]!) : 0,
  }
}

export function measureMixAnalysis(
  channels: ArrayLike<number>[],
  sampleRate: number,
): MixAnalysisReport {
  const frames = channels[0]?.length ?? 0
  const canales = channels.map(comoArrayNumerico)
  const nCh = canales.length
  const sub = calcularSubBloques(canales, sampleRate)
  const truePeak = frames > 0 ? medirTruePeak(canales, sub.picoMuestras) : 0
  const loudness = loudnessDesdeSubBloques(sub, truePeak)
  const l = canales[0] ?? new Float32Array(0)
  const r = canales[1] ?? l
  const clippingSamples = countClipping(canales)
  const muestrasTotales = frames * Math.max(1, nCh)
  const rms = muestrasTotales > 0 ? Math.sqrt(sub.energiaCrudaTotal / muestrasTotales) : 0
  const rmsDb = dbDesdeLineal(rms)
  const peakDb = dbDesdeLineal(loudness.peak)
  const truePeakDb = dbDesdeLineal(loudness.truePeak)
  const crestFactorDb = rms > 1e-9 ? peakDb - rmsDb : 0
  const espectro = espectroDesdeDensidades(densidadesWelch(l, r, sampleRate), sampleRate)
  const estereo: MedicionEstereo = { ...medirEstereo(l, r), porBanda: espectro.estereoPorBanda }
  const stMax = loudness.shortTermMax ?? loudness.shortTerm
  return {
    loudness,
    crestFactorDb,
    clippingSamples,
    clipping: clippingSamples > 0,
    stereoCorrelation: estereo.correlacion,
    spectrumBands: espectro.tercios,
    truePeakDb,
    peakDb,
    sampleRate,
    frames,
    rmsDb,
    plrDb: loudness.integrated > -70 ? truePeakDb - loudness.integrated : undefined,
    psrDb: stMax > -70 ? truePeakDb - stMax : undefined,
    dinamicaVentanas: dinamicaPorVentanas(sub, nCh),
    bandasAgregadas: espectro.agregadas,
    estereo,
    transientes: medirTransientes(canales, sampleRate),
  }
}

function bandaEstereo(analysis: MixAnalysisReport, label: string): BandaEstereo | undefined {
  return analysis.estereo?.porBanda?.find((b) => b.label === label)
}

export function buildAudioListenReport(
  analysis: MixAnalysisReport,
  opts?: { target?: LoudnessTargetName; maxTruePeakDb?: number },
): AudioListenReport {
  const issues: string[] = []
  const advertencias: string[] = []
  const objetivo = opts?.target ? LOUDNESS_PLATFORM_TARGETS[opts.target] : undefined
  const maxTp = opts?.maxTruePeakDb ?? objetivo?.truePeakDb ?? -1
  if (analysis.clipping) issues.push(`Clipping: ${analysis.clippingSamples} samples`)
  if (analysis.truePeakDb > maxTp) {
    issues.push(`True-peak ${analysis.truePeakDb.toFixed(1)} dBTP > ceiling ${maxTp} dBTP`)
  }
  if (analysis.stereoCorrelation < -0.3) {
    issues.push(`Correlación estéreo baja (${analysis.stereoCorrelation.toFixed(2)})`)
  }
  // Graves en contrafase: se cancelan al sumar a mono (club, móviles).
  for (const label of ['sub', 'low']) {
    const b = bandaEstereo(analysis, label)
    const nivel = analysis.bandasAgregadas?.find((x) => x.label === label)?.db ?? -140
    if (b && nivel > -60 && b.correlacion < 0) {
      issues.push(
        `Banda ${label} en contrafase (corr ${b.correlacion.toFixed(2)}, pérdida mono ${b.perdidaMonoDb.toFixed(1)} dB)`,
      )
    }
  }
  if (analysis.estereo && analysis.estereo.perdidaMonoDb > 3 && analysis.stereoCorrelation >= -0.3) {
    advertencias.push(`Compatibilidad mono: pierde ${analysis.estereo.perdidaMonoDb.toFixed(1)} dB al sumar`)
  }
  if (analysis.plrDb != null && analysis.plrDb < 6) {
    advertencias.push(`PLR ${analysis.plrDb.toFixed(1)} dB: master muy comprimido/limitado`)
  }
  const lra = analysis.loudness.loudnessRange ?? analysis.loudness.rangoDinamico
  if (analysis.loudness.integrated > -70 && lra > 15) {
    advertencias.push(`LRA ${lra.toFixed(1)} LU: dinámica muy amplia para streaming`)
  }
  let targetDeltaDb: number | undefined
  let suggestion: string | undefined
  if (opts?.target) {
    const cmp = compareLoudnessTarget(analysis.loudness.integrated, opts.target, analysis.truePeakDb)
    targetDeltaDb = cmp.deltaDb
    suggestion = cmp.suggestion
    if (Math.abs(cmp.deltaDb) > 1.5) {
      issues.push(`Fuera de target ${opts.target}: Δ ${cmp.deltaDb.toFixed(1)} dB`)
    }
  }
  const ok = issues.length === 0
  const bandasResumen = analysis.bandasAgregadas?.length ? analysis.bandasAgregadas : analysis.spectrumBands
  const topBands = [...bandasResumen]
    .sort((a, b) => b.db - a.db)
    .slice(0, 3)
    .map((b) => `${b.label} ${b.db.toFixed(0)}dB`)
    .join(', ')
  const extras = [`LRA ${lra.toFixed(1)} LU`, analysis.plrDb != null ? `PLR ${analysis.plrDb.toFixed(1)} dB` : '']
    .filter(Boolean)
    .join(' · ')
  const summary = ok
    ? `OK · ${analysis.loudness.integrated.toFixed(1)} LUFS · TP ${analysis.truePeakDb.toFixed(1)} dBTP · ${extras} · corr ${analysis.stereoCorrelation.toFixed(2)} · bandas ${topBands}`
    : `Problemas: ${issues.join('; ')} · ${analysis.loudness.integrated.toFixed(1)} LUFS`
  return {
    ...analysis,
    ok,
    issues,
    target: opts?.target,
    targetDeltaDb,
    suggestion,
    summary,
    advertencias,
    ...(objetivo ? { targetLufs: objetivo.lufs, targetTruePeakDb: objetivo.truePeakDb } : {}),
  }
}

/**
 * Copia compacta del informe (p. ej. para enviar a la IA): sin series temporales ni listas largas.
 */
export function compactarInformeAudio<T extends MixAnalysisReport>(informe: T): T {
  const { serieMomentary: _m, serieShortTerm: _s, ...loudness } = informe.loudness
  const out: T = { ...informe, loudness }
  if (informe.dinamicaVentanas) out.dinamicaVentanas = { ...informe.dinamicaVentanas, rmsDb: [], crestDb: [] }
  if (informe.transientes) out.transientes = { ...informe.transientes, tiemposSeg: [] }
  return out
}

/** Aplica ganancia lineal a canales (normalización). */
export function applyGainToChannels(
  channels: Float32Array[],
  gainLinear: number,
): Float32Array[] {
  return channels.map((ch) => {
    const out = new Float32Array(ch.length)
    for (let i = 0; i < ch.length; i++) out[i] = ch[i]! * gainLinear
    return out
  })
}

export function normalizeGainForTarget(
  analysis: MixAnalysisReport,
  mode: 'peak' | 'lufs',
  targetDb: number,
): number {
  if (mode === 'peak') {
    const peakDb = analysis.peakDb
    if (peakDb <= -120) return 1
    return Math.pow(10, (targetDb - peakDb) / 20)
  }
  const delta = targetDb - analysis.loudness.integrated
  return Math.pow(10, delta / 20)
}
