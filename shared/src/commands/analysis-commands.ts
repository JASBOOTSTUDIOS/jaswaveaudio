/**
 * Tools/comandos analysis.* (loudness, spectrum, stereo, fullReport, compareTarget).
 */

import type { CommandDefinition, StateTransition } from '../types/command'
import type { DAWState } from '../types/state'
import type { LoudnessData } from '../types/analisis'
import { renderJobGet, renderJobList } from '../render/job-store'
import {
  compareLoudnessTarget,
  type LoudnessTargetName,
  LOUDNESS_TARGETS,
  LOUDNESS_TARGET_NAMES,
} from '../audio/loudness-bs1770'
import type { EventoDominio } from '../events/evento-dominio'
import type { AudioListenReport, MixAnalysisReport } from '../audio/mix-analysis'
import { buildAudioListenReport } from '../audio/mix-analysis'
import {
  MENSAJE_SIN_PROVEEDOR_ANALISIS,
  obtenerProveedorAnalisis,
  type AnalisisProyecto,
  type RangoAnalisis,
} from '../audio/analysis-provider'
import {
  compararConReferencia,
  detectarEnmascaramiento,
  diagnosticarMezcla,
  type MedidaMezcla,
  type MedidaPista,
} from '../audio/diagnosis'
import { beatsASegundos } from '../types/tiempo'
import { getStateRevision } from '../state/state-revision'

function ev(nombre: string, payload: Record<string, unknown>): EventoDominio {
  return {
    nombre,
    version: 1,
    marcaTiempo: entorno.ahora(),
    fuente: 'builtin',
    payload: payload as EventoDominio['payload'],
  }
}

function latestJobWithAnalysis() {
  return renderJobList()
    .filter((j) => j.status === 'completed' && (j.loudness || j.analysis))
    .sort((a, b) => (a.id < b.id ? 1 : -1))[0]
}

export type AnalysisLoudnessPayload = {
  source?: 'play' | 'render'
  jobId?: string
}

export function crearComandoAnalysisLoudness(): CommandDefinition<any> {
  return {
    type: 'analysis.loudness',
    replicacion: 'resultado',
    description: 'Devuelve loudness medido (último render o análisis de proyecto)',
    risk: 'read',
    schema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['play', 'render'] },
        jobId: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (estado, payload): Promise<StateTransition<LoudnessData & { source: string; jobId?: string; truePeakDb?: number; rango?: RangoAnalisis }>> => {
      const source = payload.source ?? 'render'
      if (source === 'render') {
        const job =
          (payload.jobId ? renderJobGet(payload.jobId) : undefined) ?? latestJobWithAnalysis()
        if (job?.loudness) {
          const truePeakDb =
            job.analysis?.truePeakDb ??
            (job.loudness.truePeak > 0 ? 20 * Math.log10(job.loudness.truePeak) : -120)
          return {
            state: estado,
            events: [ev('audio.analisis.actualizado', { source: 'render', jobId: job.id, loudness: job.loudness })],
            result: { ...job.loudness, source: 'render', jobId: job.id, truePeakDb },
          }
        }
      }
      // source 'play': mide el proyecto con el motor de análisis si está disponible.
      const proveedor = obtenerProveedorAnalisis()
      if (proveedor) {
        const analisis = await proveedor({
          revision: getStateRevision(estado),
          rango: resolverRango(estado, {}),
        })
        const m = analisis.master
        const l = m.loudness
        return {
          state: estado,
          events: [ev('audio.analisis.actualizado', { source: 'play', loudness: m.loudness ?? null })],
          result: {
            integrated: l?.integrated ?? m.integrated,
            shortTerm: l?.shortTerm ?? m.integrated,
            momentary: l?.momentary ?? m.integrated,
            rangoDinamico: l?.rangoDinamico ?? m.lraDb ?? 0,
            peak: l?.peak ?? dbAPlinear(m.peakDb),
            truePeak: l?.truePeak ?? dbAPlinear(m.truePeakDb),
            lufs: l?.lufs ?? m.integrated,
            source: 'play',
            truePeakDb: m.truePeakDb,
            rango: analisis.rango,
          },
        }
      }
      const master = estado.project.analysis?.master?.loudness
      if (!master) {
        throw new Error('Sin medición: ejecuta un bounce (render.start) primero')
      }
      return {
        state: estado,
        events: [],
        result: { ...master, source: 'play' },
      }
    },
  }
}

export function crearComandoAnalysisCompareTarget(): CommandDefinition<any> {
  return {
    type: 'analysis.compareTarget',
    replicacion: 'resultado',
    description: 'Compara loudness integrado vs target de plataforma (spotify, apple, youtube, amazon, club, broadcast, cd, streaming)',
    risk: 'read',
    schema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: LOUDNESS_TARGET_NAMES as unknown as string[] },
        jobId: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (estado, payload) => {
      const target = (payload.target ?? 'streaming') as LoudnessTargetName
      if (!(target in LOUDNESS_TARGETS)) {
        throw new Error(`Target desconocido: ${target}`)
      }
      const job =
        (payload.jobId ? renderJobGet(payload.jobId) : undefined) ?? latestJobWithAnalysis()
      const integrated =
        job?.loudness?.integrated ?? estado.project.analysis?.master?.loudness?.integrated
      if (integrated == null || !Number.isFinite(integrated)) {
        throw new Error('Sin medición: ejecuta un bounce (render.start) primero')
      }
      const cmp = compareLoudnessTarget(integrated, target, job?.analysis?.truePeakDb)
      const listen = job?.listenReport
      return {
        state: estado,
        events: [],
        result: {
          integrated,
          ...cmp,
          target,
          truePeakDb: job?.analysis?.truePeakDb,
          listenOk: listen?.ok,
          listenIssues: listen?.issues,
        },
      }
    },
  }
}

export function crearComandoAnalysisSpectrum(): CommandDefinition<any> {
  return {
    type: 'analysis.spectrum',
    replicacion: 'resultado',
    description: 'Energía por bandas del último bounce',
    risk: 'read',
    schema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (_estado, payload) => {
      const job =
        (payload.jobId ? renderJobGet(payload.jobId) : undefined) ?? latestJobWithAnalysis()
      if (!job?.analysis?.spectrumBands?.length) {
        throw new Error('Sin espectro: ejecuta render.start (análisis extendido)')
      }
      return {
        state: _estado,
        events: [],
        result: {
          jobId: job.id,
          bands: job.analysis.spectrumBands,
          // Agregados sub/low/lowmid/mid/highmid/high (opcionales en renders antiguos).
          agregados: job.analysis.bandasAgregadas,
        },
      }
    },
  }
}

export function crearComandoAnalysisStereo(): CommandDefinition<any> {
  return {
    type: 'analysis.stereo',
    replicacion: 'resultado',
    description: 'Correlación estéreo y clipping del último bounce',
    risk: 'read',
    schema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (_estado, payload) => {
      const job =
        (payload.jobId ? renderJobGet(payload.jobId) : undefined) ?? latestJobWithAnalysis()
      if (!job?.analysis) {
        throw new Error('Sin análisis estéreo: ejecuta render.start')
      }
      return {
        state: _estado,
        events: [],
        result: {
          jobId: job.id,
          stereoCorrelation: job.analysis.stereoCorrelation,
          clipping: job.analysis.clipping,
          clippingSamples: job.analysis.clippingSamples,
          crestFactorDb: job.analysis.crestFactorDb,
          // Métricas nuevas (opcionales: renders antiguos no las tienen).
          rmsDb: job.analysis.rmsDb,
          plrDb: job.analysis.plrDb,
          psrDb: job.analysis.psrDb,
          balanceDb: job.analysis.estereo?.balanceDb,
          ancho: job.analysis.estereo?.ancho,
          energiaMidDb: job.analysis.estereo?.energiaMidDb,
          energiaSideDb: job.analysis.estereo?.energiaSideDb,
          perdidaMonoDb: job.analysis.estereo?.perdidaMonoDb,
          correlacionPorBanda: job.analysis.estereo?.porBanda?.map((b) => ({
            banda: b.label,
            correlacion: b.correlacion,
            ancho: b.ancho,
            perdidaMonoDb: b.perdidaMonoDb,
          })),
          onsets: job.analysis.transientes?.onsets,
          densidadOnsetsPorSeg: job.analysis.transientes?.densidadPorSeg,
          ataqueMedioMs: job.analysis.transientes?.ataqueMedioMs,
        },
      }
    },
  }
}

export function crearComandoAnalysisFullReport(): CommandDefinition<any> {
  return {
    type: 'analysis.fullReport',
    replicacion: 'resultado',
    description: 'Informe completo / AudioListenReport del último bounce',
    risk: 'read',
      schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
          target: { type: 'string', enum: LOUDNESS_TARGET_NAMES as unknown as string[] },
          maxTruePeakDb: { type: 'number' },
        },
        additionalProperties: false,
      },
    handler: (_estado, payload): StateTransition<AudioListenReport & { jobId: string }> => {
      const job =
        (payload.jobId ? renderJobGet(payload.jobId) : undefined) ?? latestJobWithAnalysis()
      if (!job?.analysis && !job?.loudness) {
        throw new Error('Sin bounce: ejecuta render.start primero')
      }
      const analysis: MixAnalysisReport =
        job.analysis ??
        ({
          loudness: job.loudness!,
          crestFactorDb: 0,
          clippingSamples: 0,
          clipping: false,
          stereoCorrelation: 1,
          spectrumBands: [],
          truePeakDb: 20 * Math.log10(Math.max(1e-12, job.loudness!.truePeak)),
          peakDb: 20 * Math.log10(Math.max(1e-12, job.loudness!.peak)),
          sampleRate: job.sampleRate,
          frames: job.frames ?? 0,
        } satisfies MixAnalysisReport)
      const report =
        job.listenReport ??
        buildAudioListenReport(analysis, {
          target: payload.target as LoudnessTargetName | undefined,
          maxTruePeakDb: payload.maxTruePeakDb != null ? Number(payload.maxTruePeakDb) : undefined,
        })
      return {
        state: _estado,
        events: [],
        result: { ...report, jobId: job.id },
      }
    },
  }
}

// ── A7b: análisis por pista, mezcla, enmascaramiento, dinámica, sección, referencia y diagnóstico ──

/** Rango de análisis (segundos) + opciones de render. */
export type RangoAnalisisPayload = {
  /** Inicio del rango en segundos (con `finSeg`). */
  inicioSeg?: number
  /** Fin del rango en segundos. */
  finSeg?: number
  /** Marcador (id o nombre) que delimita la sección a analizar. */
  marcador?: string
  /** Tap del host: post-insert (por defecto) o pre-fader. */
  tap?: 'pre' | 'post'
  /** Ignorar la cadena master (mide la mezcla antes del master). */
  bypassMaster?: boolean
}

function dbAPlinear(db: number): number {
  return Math.pow(10, db / 20)
}

function bpmProyecto(estado: DAWState): number {
  const valor = estado.project.bpm?.valor
  return typeof valor === 'number' && valor > 0 ? valor : 120
}

/** Fin del proyecto en beats (último clip). */
function finProyectoBeats(estado: DAWState): number {
  let fin = 0
  for (const pista of estado.project.tracks ?? []) {
    for (const clip of pista.clips ?? []) {
      fin = Math.max(fin, (clip.inicio ?? 0) + (clip.duracion ?? 0))
    }
  }
  return fin
}

/** Marcadores del proyecto y de las pistas (en beats). */
function marcadoresProyecto(estado: DAWState) {
  const dePistas = (estado.project.tracks ?? []).flatMap((p) => p.marcadores ?? [])
  return [...(estado.project.marcadores ?? []), ...dePistas]
}

/** Resuelve el rango a medir: explícito > marcador > proyecto entero. */
export function resolverRango(estado: DAWState, payload: RangoAnalisisPayload): RangoAnalisis {
  const bpm = bpmProyecto(estado)
  if (typeof payload.inicioSeg === 'number' && typeof payload.finSeg === 'number') {
    const inicio = Math.max(0, payload.inicioSeg)
    return { inicioSeg: inicio, finSeg: Math.max(inicio, payload.finSeg) }
  }
  const nombre = payload.marcador?.trim().toLowerCase()
  const marcador = nombre
    ? marcadoresProyecto(estado).find(
        (m) => m.id === payload.marcador || m.nombre?.trim().toLowerCase() === nombre,
      )
    : undefined
  if (marcador) {
    if (marcador.tipo === 'region' && marcador.regionInicio != null && marcador.regionFin != null) {
      return {
        inicioSeg: beatsASegundos(marcador.regionInicio, bpm),
        finSeg: beatsASegundos(marcador.regionFin, bpm),
      }
    }
    const siguiente = marcadoresProyecto(estado)
      .filter((m) => m.tiempo > marcador.tiempo)
      .sort((a, b) => a.tiempo - b.tiempo)[0]
    const finBeats = siguiente ? siguiente.tiempo : finProyectoBeats(estado)
    return {
      inicioSeg: beatsASegundos(marcador.tiempo, bpm),
      finSeg: beatsASegundos(finBeats, bpm),
    }
  }
  return { inicioSeg: 0, finSeg: beatsASegundos(finProyectoBeats(estado), bpm) }
}

/** Pide el análisis al motor inyectado por la app. */
export async function ejecutarAnalisis(
  estado: DAWState,
  payload: RangoAnalisisPayload & { pistas?: string[] },
): Promise<AnalisisProyecto> {
  const proveedor = obtenerProveedorAnalisis()
  if (!proveedor) throw new Error(MENSAJE_SIN_PROVEEDOR_ANALISIS)
  return proveedor({
    revision: getStateRevision(estado),
    pistas: payload.pistas,
    rango: resolverRango(estado, payload),
    tap: payload.tap,
    bypassMaster: payload.bypassMaster,
  })
}

function medidaMezcla(analisis: AnalisisProyecto): MedidaMezcla {
  return { pistas: analisis.pistas, master: analisis.master, suma: analisis.suma }
}

const ESQUEMA_RANGO = {
  inicioSeg: { type: 'number' },
  finSeg: { type: 'number' },
  marcador: { type: 'string' },
  tap: { type: 'string', enum: ['pre', 'post'] },
  bypassMaster: { type: 'boolean' },
} as const

export type AnalysisTrackPayload = RangoAnalisisPayload & { trackId: string }

/** `analysis.track`: medición completa de una pista. */
export function crearComandoAnalysisTrack(): CommandDefinition<any> {
  return {
    type: 'analysis.track',
    replicacion: 'resultado',
    description: 'Mide una pista (loudness, espectro, dinámica, estéreo) en un rango',
    risk: 'read',
    schema: {
      type: 'object',
      properties: { ...ESQUEMA_RANGO, trackId: { type: 'string' } },
      required: ['trackId'],
      additionalProperties: false,
    },
    handler: async (estado, payload) => {
      const analisis = await ejecutarAnalisis(estado, { ...payload, pistas: [payload.trackId] })
      const pista = analisis.pistas.find((p) => p.trackId === payload.trackId)
      if (!pista) {
        throw new Error(`La pista ${payload.trackId} no tiene audio que medir en ese rango`)
      }
      return {
        state: estado,
        events: [],
        result: { ...pista, rango: analisis.rango, metadatos: analisis.metadatos },
      }
    },
  }
}

/** `analysis.mix`: todas las pistas + master + suma. */
export function crearComandoAnalysisMix(): CommandDefinition<any> {
  return {
    type: 'analysis.mix',
    replicacion: 'resultado',
    description: 'Mide la mezcla completa: cada pista, el master y la suma previa al master',
    risk: 'read',
    schema: {
      type: 'object',
      properties: { ...ESQUEMA_RANGO },
      additionalProperties: false,
    },
    handler: async (estado, payload) => {
      const analisis = await ejecutarAnalisis(estado, payload)
      return {
        state: estado,
        events: [],
        result: {
          rango: analisis.rango,
          pistas: analisis.pistas,
          master: analisis.master,
          suma: analisis.suma,
          metadatos: analisis.metadatos,
        },
      }
    },
  }
}

/** `analysis.masking`: matriz de enmascaramiento entre pistas. */
export function crearComandoAnalysisMasking(): CommandDefinition<any> {
  return {
    type: 'analysis.masking',
    replicacion: 'resultado',
    description: 'Detecta qué pista tapa a cuál (kick/bajo, voz/guitarra…)',
    risk: 'read',
    schema: {
      type: 'object',
      properties: {
        ...ESQUEMA_RANGO,
        umbralDb: { type: 'number' },
        pares: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
      },
      additionalProperties: false,
    },
    handler: async (estado, payload) => {
      const analisis = await ejecutarAnalisis(estado, payload)
      const pares = (payload.pares as Array<[string, string]> | undefined)?.filter(
        (p) => Array.isArray(p) && p.length === 2,
      )
      const matriz = detectarEnmascaramiento(analisis.pistas, {
        umbralDb: payload.umbralDb != null ? Number(payload.umbralDb) : undefined,
        pares,
      })
      return {
        state: estado,
        events: [],
        result: { rango: analisis.rango, ...matriz },
      }
    },
  }
}

/** `analysis.dynamics`: crest, PLR, LRA y transientes por pista y master. */
export function crearComandoAnalysisDynamics(): CommandDefinition<any> {
  return {
    type: 'analysis.dynamics',
    replicacion: 'resultado',
    description: 'Mide la dinámica (crest, PLR, LRA, transientes) de la mezcla o de una pista',
    risk: 'read',
    schema: {
      type: 'object',
      properties: { ...ESQUEMA_RANGO, trackId: { type: 'string' } },
      additionalProperties: false,
    },
    handler: async (estado, payload) => {
      const analisis = await ejecutarAnalisis(estado, {
        ...payload,
        pistas: payload.trackId ? [payload.trackId] : undefined,
      })
      const dinamica = (m: MedidaPista) => ({
        trackId: m.trackId,
        nombre: m.nombre,
        crestFactorDb: m.crestFactorDb,
        plrDb: m.plrDb ?? null,
        lraDb: m.lraDb ?? null,
        rmsDb: m.rmsDb,
        truePeakDb: m.truePeakDb,
        integrated: m.integrated,
        onsets: m.transientes?.onsets ?? null,
        densidadOnsetsPorSeg: m.transientes?.densidadPorSeg ?? null,
        ataqueMedioMs: m.transientes?.ataqueMedioMs ?? null,
      })
      return {
        state: estado,
        events: [],
        result: {
          rango: analisis.rango,
          pistas: analisis.pistas.map(dinamica),
          master: dinamica(analisis.master),
        },
      }
    },
  }
}

/** `analysis.section`: análisis (medidas + diagnóstico) de una sección delimitada por marcadores. */
export function crearComandoAnalysisSection(): CommandDefinition<any> {
  return {
    type: 'analysis.section',
    replicacion: 'resultado',
    description: 'Analiza una sección del proyecto (marcador o rango) con su diagnóstico',
    risk: 'read',
    schema: {
      type: 'object',
      properties: { ...ESQUEMA_RANGO },
      additionalProperties: false,
    },
    handler: async (estado, payload) => {
      const analisis = await ejecutarAnalisis(estado, payload)
      const medida = medidaMezcla(analisis)
      return {
        state: estado,
        events: [],
        result: {
          marcador: payload.marcador ?? null,
          rango: analisis.rango,
          pistas: analisis.pistas,
          master: analisis.master,
          diagnostico: diagnosticarMezcla(medida),
        },
      }
    },
  }
}

/** `analysis.reference`: compara una pista de referencia con la mezcla actual. */
export function crearComandoAnalysisReference(): CommandDefinition<any> {
  return {
    type: 'analysis.reference',
    replicacion: 'resultado',
    description: 'Compara una pista de referencia con la mezcla actual (loudness, espectro, ancho)',
    risk: 'read',
    schema: {
      type: 'object',
      properties: { ...ESQUEMA_RANGO, trackId: { type: 'string' } },
      required: ['trackId'],
      additionalProperties: false,
    },
    handler: async (estado, payload) => {
      const analisis = await ejecutarAnalisis(estado, { ...payload, pistas: [payload.trackId] })
      const referencia = analisis.pistas.find((p) => p.trackId === payload.trackId)
      if (!referencia) {
        throw new Error(`La pista de referencia ${payload.trackId} no tiene audio que medir`)
      }
      const mezcla = await ejecutarAnalisis(estado, payload)
      const comparacion = compararConReferencia(referencia, mezcla.master)
      return {
        state: estado,
        events: [],
        result: {
          rango: analisis.rango,
          referencia: { trackId: referencia.trackId, nombre: referencia.nombre },
          ...comparacion,
        },
      }
    },
  }
}

/** `analysis.diagnose`: diagnóstico de la mezcla con evidencia numérica. */
export function crearComandoAnalysisDiagnose(): CommandDefinition<any> {
  return {
    type: 'analysis.diagnose',
    replicacion: 'resultado',
    description: 'Diagnóstico de mezcla: barro, aspereza, sub, sibilancia, fase, compresión, enmascaramiento',
    risk: 'read',
    schema: {
      type: 'object',
      properties: { ...ESQUEMA_RANGO },
      additionalProperties: false,
    },
    handler: async (estado, payload) => {
      const analisis = await ejecutarAnalisis(estado, payload)
      const diagnostico = diagnosticarMezcla(medidaMezcla(analisis))
      return {
        state: estado,
        events: [],
        result: {
          rango: analisis.rango,
          diagnostico,
          resumen: {
            criticos: diagnostico.filter((d) => d.severidad === 'critico').length,
            avisos: diagnostico.filter((d) => d.severidad === 'aviso').length,
            info: diagnostico.filter((d) => d.severidad === 'info').length,
          },
        },
      }
    },
  }
}

import { entorno } from '../state/entorno-determinista';