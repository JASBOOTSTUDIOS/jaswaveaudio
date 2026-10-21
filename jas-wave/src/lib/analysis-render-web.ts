/**
 * Backend de análisis por Web Audio (A7b).
 *
 * Propósito:
 *   Renderizar los clips de audio de cada pista y la mezcla en un
 *   OfflineAudioContext, sin depender del host nativo (que aquí no se puede
 *   compilar), para poder medir por pista.
 *
 * Importancia:
 *   - Replica la ley de ganancia/paneo del grafo nativo (makeup ×2, paneo de
 *     potencia constante) para que los números sean comparables con un bounce.
 *   - NO procesa plugins: las cifras de dinamismo y espectro no incluyen los
 *     VST. El servicio lo marca en `pluginsProcesados: false`.
 *
 * Función:
 *   - `crearBackendAnalisisWeb`: devuelve el `BackendAnalisis` de la app.
 */

import { buildBounceContent } from './bounce-content'
import { prerenderWebStems } from './bounce-offline-audio'
import {
  desintercalar,
  type BackendAnalisis,
  type ResultadoBackendAnalisis,
  type SegmentoPcm,
} from './analysis-render'
import type { DAWState } from '../../../shared/src/types/state'

/** Makeup por canal del grafo nativo (~+6 dB). */
const MAKEUP_CANAL = 2
/** Ganancia del master en el grafo nativo. */
const GANANCIA_MASTER = 1.35
/** Ganancia máxima por canal tras el makeup. */
const GANANCIA_MAX = 4

/** Ley de ganancia/paneo del grafo nativo (main.cpp: applyTrackGainPan). */
export function gananciaPaneo(
  volumen: number,
  paneo: number,
  silenciada: boolean,
): { gL: number; gR: number } {
  if (silenciada) return { gL: 0, gR: 0 }
  const g = Math.max(0, Math.min(GANANCIA_MAX, volumen * MAKEUP_CANAL))
  if (g <= 0) return { gL: 0, gR: 0 }
  const p = Math.max(-1, Math.min(1, paneo))
  const theta = ((p + 1) * Math.PI) / 4
  return { gL: g * Math.cos(theta), gR: g * Math.sin(theta) }
}

/** Limitador suave del grafo nativo (transparente bajo 0.95). */
export function limitarSuave(x: number): number {
  if (x > 0.95) return 0.95 + 0.05 * Math.tanh((x - 0.95) * 8)
  if (x < -0.95) return -0.95 - 0.05 * Math.tanh((-0.95 - x) * 8)
  return x
}

function aplicarPista(
  pcm: SegmentoPcm,
  gL: number,
  gR: number,
): SegmentoPcm {
  const l = new Float32Array(pcm.l.length)
  const r = new Float32Array(pcm.r.length)
  for (let i = 0; i < pcm.l.length; i++) {
    l[i] = pcm.l[i]! * gL
    r[i] = pcm.r[i]! * gR
  }
  return { l, r }
}

function sumar(segmentos: SegmentoPcm[], frames: number): SegmentoPcm {
  const l = new Float32Array(frames)
  const r = new Float32Array(frames)
  for (const s of segmentos) {
    for (let i = 0; i < frames; i++) {
      l[i] = l[i]! + (s.l[i] ?? 0)
      r[i] = r[i]! + (s.r[i] ?? 0)
    }
  }
  return { l, r }
}

function aplicarMaster(pcm: SegmentoPcm, bypassMaster: boolean): SegmentoPcm {
  if (bypassMaster) return pcm
  const l = new Float32Array(pcm.l.length)
  const r = new Float32Array(pcm.r.length)
  for (let i = 0; i < pcm.l.length; i++) {
    l[i] = limitarSuave(pcm.l[i]! * GANANCIA_MASTER)
    r[i] = limitarSuave(pcm.r[i]! * GANANCIA_MASTER)
  }
  return { l, r }
}

/**
 * Backend Web Audio: renderiza los clips de audio por pista y la mezcla.
 * Las pistas MIDI (sin audio renderizable aquí) quedan sin medir.
 */
export function crearBackendAnalisisWeb(): BackendAnalisis {
  return async (req): Promise<ResultadoBackendAnalisis> => {
    const inicio = Math.max(0, req.rango.inicioSeg)
    const fin = Math.max(inicio + 0.05, req.rango.finSeg)
    const duracion = fin - inicio
    const estado = req.estado as DAWState
    const content = buildBounceContent(estado, { startSec: inicio, endSec: fin })
    const stems = await prerenderWebStems(content, {
      startSec: inicio,
      durationSec: duracion,
      sampleRate: req.sampleRate,
    })

    const pistas = new Map<string, SegmentoPcm>()
    const segmentos: SegmentoPcm[] = []
    for (const track of content.tracks) {
      const pcm = stems.get(track.stemIndex)
      if (!pcm) continue
      const info = (estado.project.tracks ?? []).find((t) => t.id === track.trackId)
      const { gL, gR } = gananciaPaneo(
        typeof info?.volumen === 'number' ? info.volumen : 0.8,
        typeof info?.paneo === 'number' ? info.paneo : 0,
        info?.silenciada === true,
      )
      const mezclado = aplicarPista(desintercalar(pcm, Math.floor(pcm.length / 2)), gL, gR)
      pistas.set(track.trackId, mezclado)
      segmentos.push(mezclado)
    }

    const frames = Math.max(1, Math.round(duracion * req.sampleRate))
    const suma = sumar(segmentos, frames)
    const mezcla = aplicarMaster(suma, req.bypassMaster)

    return {
      sampleRate: req.sampleRate,
      pistas,
      mezcla,
      suma,
      backend: 'ts-web-audio',
      pluginsProcesados: false,
    }
  }
}
