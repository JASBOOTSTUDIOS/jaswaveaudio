/**
 * `referencia.analizar` (K6): main descarga el audio de la referencia (yt-dlp + ffmpeg → WAV mono 22 050 Hz de
 * hasta 90 s) y aquí se mide con los analizadores del DAW: tonalidad, acordes y tempo con `analysis.audioLens`
 * (comando existente, con las muestras reales), loudness BS.1770 + true peak y espectro Welch de `shared`.
 * El informe sale en español con números; la medición manda.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { measureLoudnessBs1770, type LoudnessResult } from '../../../shared/src/audio/loudness-bs1770'
import { medirEspectroWelch, type EspectroWelch } from '../../../shared/src/audio/spectrum'
import type { AnalisisMusicalDescriptivo } from '../../../shared/src/audio/audio-lens'
import { referenciaDescargar, type ReferenciaDescargada } from './web-tools-cliente'

/** AudioLens trabaja mejor con tramos cortos (como las notas de voz): 30 s del inicio de la ventana densa. */
const SEG_AUDIO_LENS = 30

export type DatosReferencia = {
  videoId: string
  url: string
  titulo: string
  ruta: string
  sampleRate: number
  desdeSeg: number
  duracionSeg: number
  duracionTotalSeg: number
  bpmEstimado: number
  tonalidad: { raiz: string; escala: 'mayor' | 'menor'; confianza: number }
  acordes: Array<{ tiempoSeg: number; acorde: string; confianza: number }>
  loudness: Pick<LoudnessResult, 'integrated' | 'rangoDinamico' | 'truePeakDb' | 'peakDb' | 'shortTermMax' | 'momentaryMax'>
  espectro: Array<{ banda: string; db: number }>
  resumenAudioLens: string
}

export function float32DesdePcm16(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i]! / 32768
  return out
}

function mmss(seg: number): string {
  const s = Math.round(seg)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const n1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—')

/** Informe en español, con los números medidos (no estimaciones del modelo). */
export function redactarInformeReferencia(d: DatosReferencia): string {
  const lineas = [
    `Referencia analizada: ${d.titulo} (${d.url})`,
    `Tramo medido: ${mmss(d.desdeSeg)}–${mmss(d.desdeSeg + d.duracionSeg)} de ${mmss(d.duracionTotalSeg)} (${Math.round(d.duracionSeg)} s, el tramo más denso), mono a ${d.sampleRate} Hz.`,
    `Tempo estimado: ${Math.round(d.bpmEstimado)} BPM.`,
    `Tonalidad: ${d.tonalidad.raiz} ${d.tonalidad.escala} (confianza ${Math.round(d.tonalidad.confianza * 100)} %).`,
  ]
  if (d.acordes.length) {
    const vistos = d.acordes.slice(0, 24).map((a) => `${a.acorde}@${mmss(a.tiempoSeg)}`)
    lineas.push(`Acordes detectados (${d.acordes.length}): ${vistos.join(' → ')}${d.acordes.length > 24 ? ' …' : ''}`)
  } else {
    lineas.push('Acordes: sin progresión tonal clara (audio percusivo, monofónico o muy denso).')
  }
  const l = d.loudness
  lineas.push(
    `Loudness: ${n1(l.integrated)} LUFS integrado · LRA ${n1(l.rangoDinamico)} LU · short-term máx. ${n1(l.shortTermMax ?? NaN)} LUFS · pico ${n1(l.peakDb ?? NaN)} dBFS · true peak ${n1(l.truePeakDb ?? NaN)} dBTP.`,
  )
  if (d.espectro.length) {
    lineas.push(`Espectro (bandas, dB; la fuente llega hasta ${Math.round(d.sampleRate / 2 / 1000)} kHz): ${d.espectro.map((b) => `${b.banda} ${n1(b.db)}`).join(' · ')}.`)
  }
  if (d.resumenAudioLens) lineas.push(`Lectura musical: ${d.resumenAudioLens}`)
  lineas.push(`WAV temporal: ${d.ruta} (se borra al cerrar JasWave). Uso personal de referencia.`)
  return lineas.join('\n')
}

function bandasResumidas(e: EspectroWelch): Array<{ banda: string; db: number }> {
  return e.agregadas.map((b) => ({ banda: b.label, db: Math.round(b.db * 10) / 10 }))
}

export type ResultadoAnalisisReferencia = { informe: string; datos: DatosReferencia }

/** Mide una referencia ya descargada (separado para poder probarlo sin red). */
export async function medirReferencia(tienda: TiendaDAW, ref: ReferenciaDescargada): Promise<ResultadoAnalisisReferencia> {
  const muestras = float32DesdePcm16(ref.pcm16 instanceof Int16Array ? ref.pcm16 : new Int16Array(ref.pcm16 as ArrayLike<number>))
  if (!muestras.length) throw new Error('La referencia no tiene audio que medir')
  const loudness = measureLoudnessBs1770([muestras], ref.sampleRate, { series: false })
  const espectro = medirEspectroWelch([muestras], ref.sampleRate)
  const tramo = muestras.subarray(0, Math.min(muestras.length, SEG_AUDIO_LENS * ref.sampleRate))
  const r = await tienda.executor.execute('analysis.audioLens', { audioData: Array.from(tramo), sampleRate: ref.sampleRate, cuantizar: '1/4' })
  if (!r.success) throw new Error(r.error?.message ?? 'analysis.audioLens falló')
  const lens = r.result as AnalisisMusicalDescriptivo
  const datos: DatosReferencia = {
    videoId: ref.videoId,
    url: ref.url,
    titulo: ref.titulo,
    ruta: ref.ruta,
    sampleRate: ref.sampleRate,
    desdeSeg: ref.desdeSeg,
    duracionSeg: ref.duracionSeg,
    duracionTotalSeg: ref.duracionTotalSeg,
    bpmEstimado: lens.bpmEstimado,
    tonalidad: lens.tonalidad,
    acordes: lens.progresionAcordes.map((a) => ({ tiempoSeg: ref.desdeSeg + a.tiempoSeg, acorde: a.acorde, confianza: a.confianza })),
    loudness: {
      integrated: loudness.integrated,
      rangoDinamico: loudness.rangoDinamico,
      truePeakDb: loudness.truePeakDb,
      peakDb: loudness.peakDb,
      shortTermMax: loudness.shortTermMax,
      momentaryMax: loudness.momentaryMax,
    },
    espectro: bandasResumidas(espectro),
    resumenAudioLens: lens.resumenParaIA ?? '',
  }
  return { informe: redactarInformeReferencia(datos), datos }
}

/** Cadena completa: main descarga → renderer mide → informe. */
export async function analizarReferencia(tienda: TiendaDAW, url: string): Promise<ResultadoAnalisisReferencia> {
  const ref = await referenciaDescargar(url)
  return medirReferencia(tienda, ref)
}
