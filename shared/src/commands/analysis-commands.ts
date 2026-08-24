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
} from '../audio/loudness-bs1770'
import type { EventoDominio } from '../events/evento-dominio'
import type { AudioListenReport, MixAnalysisReport } from '../audio/mix-analysis'
import { buildAudioListenReport } from '../audio/mix-analysis'

function ev(nombre: string, payload: Record<string, unknown>): EventoDominio {
  return {
    nombre,
    version: 1,
    marcaTiempo: Date.now(),
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
    handler: (estado, payload): StateTransition<LoudnessData & { source: string; jobId?: string; truePeakDb?: number }> => {
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
    description: 'Compara loudness integrado vs target streaming/club/cd',
    risk: 'read',
    schema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['streaming', 'club', 'cd'] },
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
      const cmp = compareLoudnessTarget(integrated, target)
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
        result: { jobId: job.id, bands: job.analysis.spectrumBands },
      }
    },
  }
}

export function crearComandoAnalysisStereo(): CommandDefinition<any> {
  return {
    type: 'analysis.stereo',
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
        },
      }
    },
  }
}

export function crearComandoAnalysisFullReport(): CommandDefinition<any> {
  return {
    type: 'analysis.fullReport',
    description: 'Informe completo / AudioListenReport del último bounce',
    risk: 'read',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        target: { type: 'string', enum: ['streaming', 'club', 'cd'] },
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
