/**
 * Backend de análisis con el motor real (host nativo): la IA mide lo mismo que se exporta.
 *
 * El backend web (`analysis-render-web.ts`) solo renderiza clips de audio: las pistas MIDI con VST3 salían
 * mudas y la revisión de la mezcla y del máster quedaba «sin medir» (se aprobaba por opinión del agente).
 * Aquí se hace un bounce offline del rango pedido con un stem por pista (inserts, fader, paneo y envíos)
 * en una carpeta temporal que se vacía en cada medición, y se decodifica para medir.
 *
 * Sin host (web, tests) o si el render falla, se usa el respaldo (Web Audio).
 */

import type { RenderJob } from '../../../shared/src/types/render'
import { renderJobActive, renderJobGet, renderJobPut, renderJobUpdate } from '../../../shared/src/render/job-store'
import type { DAWState } from '../../../shared/src/types/state'
import type { BackendAnalisis, ResultadoBackendAnalisis, SegmentoPcm } from './analysis-render'
import { decodeWav } from './encode-wav'

const pos = (sec: number) => {
  const samples = Math.max(0, Math.floor(sec * 48000))
  return { beats: sec, segundos: sec, samples, ticks: 0, compases: 0, frames: samples, tiempoMusical: '1.1.0', porcentaje: 0 }
}

/** Máximo de audio que se renderiza para una medición de la IA: el tramo más denso de la canción. */
const MAX_SEG_MEDICION = 40

/**
 * Ventana de `max` s con más ataques de nota. Renderizar la canción entera en cada medición (varios
 * minutos con siete VST3) multiplicaba por diez el tiempo de la banda; la parte más llena es la que manda
 * en mezcla y máster. La exportación final sí mide la canción completa.
 */
export function ventanaRepresentativa(estado: DAWState, inicio: number, fin: number, max = MAX_SEG_MEDICION): { inicio: number; fin: number } {
  if (fin - inicio <= max + 5) return { inicio, fin }
  const bpm = Number((estado.project as { bpm?: { valor?: number } } | undefined)?.bpm?.valor ?? 120) || 120
  const segPorBeat = 60 / bpm
  const bins = new Float64Array(Math.ceil(fin - inicio) + 1)
  for (const t of estado.project?.tracks ?? []) {
    for (const c of t.clips ?? []) {
      for (const n of (c as { notas?: Array<{ inicio: number }> }).notas ?? []) {
        const s = (c.inicio + n.inicio) * segPorBeat - inicio
        if (s >= 0 && s < bins.length) bins[Math.floor(s)] += 1
      }
    }
  }
  let mejor = 0
  let suma = 0
  let mejorSuma = -1
  for (let i = 0; i < bins.length; i++) {
    suma += bins[i]!
    if (i >= max) suma -= bins[i - max]!
    if (i >= max - 1 && suma > mejorSuma) {
      mejorSuma = suma
      mejor = i - max + 1
    }
  }
  const ini = inicio + mejor
  return { inicio: ini, fin: Math.min(fin, ini + max) }
}

/** ¿Hay algo que solo el motor real puede oír? (instrumentos o efectos en pistas o en el máster). */
export function necesitaMotorReal(estado: DAWState): boolean {
  const conPlugins = (lista?: unknown[]) => (lista ?? []).length > 0
  return conPlugins(estado.project?.master?.plugins) || (estado.project?.tracks ?? []).some((t) => conPlugins(t.plugins))
}

function estereo(bin: Uint8Array | undefined | null): SegmentoPcm | null {
  const pcm = bin ? decodeWav(bin) : null
  if (!pcm?.channels.length) return null
  const l = pcm.channels[0]!
  return { l, r: pcm.channels[1] ?? l }
}

export function crearBackendAnalisisNativo(o: { respaldo: BackendAnalisis }): BackendAnalisis {
  return async (req): Promise<ResultadoBackendAnalisis> => {
    const api = typeof window !== 'undefined' ? window.electron : undefined
    const estado = req.estado as DAWState
    // Otro render en curso (export del usuario): no se le pisa.
    if (!api?.pluginHostSend || !api.fileReadBinary || !api.analisisIaDir || !necesitaMotorReal(estado) || renderJobActive()) return o.respaldo(req)
    try {
      const { buildRuntimeBounceContent, runNativeBounce, planStems } = await import('./bounce-service')
      const dir = await api.analisisIaDir()
      const t0 = Date.now()
      const pedido = { inicio: Math.max(0, req.rango.inicioSeg), fin: Math.max(req.rango.inicioSeg + 0.05, req.rango.finSeg) }
      const { inicio, fin } = ventanaRepresentativa(estado, pedido.inicio, pedido.fin)
      const outputPath = `${dir}/mezcla.wav`
      const stemTrackIds = (estado.project?.tracks ?? []).filter((t) => (t.clips ?? []).length > 0 || t.tipo === 'bus').map((t) => t.id)
      const job: RenderJob = {
        id: `analisis-${Date.now().toString(36)}`,
        projectId: estado.project.id,
        format: 'wav',
        sampleRate: req.sampleRate,
        bitDepth: 32,
        start: pos(inicio),
        end: pos(fin),
        progress: 0,
        status: 'pending',
        outputPath,
        normalize: false,
        exportStems: stemTrackIds.length > 0,
        stemTrackIds,
        stemsTap: 'post',
        autoEnd: false,
        transparentMaster: req.bypassMaster,
      }
      renderJobPut(job)
      let hecho: RenderJob
      try {
        const content = buildRuntimeBounceContent(estado, { startSec: inicio, endSec: fin })
        hecho = await runNativeBounce(job, content, undefined, estado)
      } finally {
        // Un job que quedara en «pending» bloquearía todos los renders siguientes («Ya hay un render en curso»).
        if (renderJobGet(job.id)?.status === 'pending' || renderJobGet(job.id)?.status === 'rendering') renderJobUpdate(job.id, { status: 'failed' })
      }
      if (hecho.status !== 'completed') throw new Error(hecho.error ?? 'render fallido')
      const mezcla = estereo((await api.fileReadBinary(hecho.outputPath ?? outputPath)) as Uint8Array | undefined)
      if (!mezcla) throw new Error('mezcla ilegible')
      const pistas = new Map<string, SegmentoPcm>()
      for (const s of planStems(estado, outputPath, stemTrackIds)) {
        const pcm = estereo((await api.fileReadBinary(s.path)) as Uint8Array | undefined)
        if (pcm) pistas.set(s.trackId, pcm)
      }
      // Suma previa al máster: los stems post-fader (incluidos los buses que reciben envíos).
      const frames = mezcla.l.length
      const suma: SegmentoPcm = { l: new Float32Array(frames), r: new Float32Array(frames) }
      const tracks = estado.project?.tracks ?? []
      const haySolo = tracks.some((t) => t.soloActiva === true)
      for (const [id, p] of pistas) {
        const t = tracks.find((x) => x.id === id)
        if (t?.silenciada || (haySolo && !t?.soloActiva)) continue
        for (let i = 0; i < frames; i++) {
          suma.l[i] = suma.l[i]! + (p.l[i] ?? 0)
          suma.r[i] = suma.r[i]! + (p.r[i] ?? 0)
        }
      }
      console.info(`[analisis] motor real: ${(fin - inicio).toFixed(0)} s de audio (de ${(pedido.fin - pedido.inicio).toFixed(0)}) en ${((Date.now() - t0) / 1000).toFixed(1)} s · ${pistas.size} pistas`)
      return { sampleRate: req.sampleRate, pistas, mezcla, suma, backend: 'host-nativo', pluginsProcesados: true }
    } catch (e) {
      console.info(`[analisis] motor real no disponible, respaldo web: ${e instanceof Error ? e.message : String(e)}`)
      return o.respaldo(req)
    } finally {
      void api.analisisIaLimpiar?.()
    }
  }
}
