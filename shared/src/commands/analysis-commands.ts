/**
 * Tools/comandos analysis.loudness / analysis.compareTarget.
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

function ev(nombre: string, payload: Record<string, unknown>): EventoDominio {
  return {
    nombre,
    version: 1,
    marcaTiempo: Date.now(),
    fuente: 'builtin',
    payload: payload as EventoDominio['payload'],
  }
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
    handler: (estado, payload): StateTransition<LoudnessData & { source: string; jobId?: string }> => {
      const source = payload.source ?? 'render'
      if (source === 'render') {
        const job =
          (payload.jobId ? renderJobGet(payload.jobId) : undefined) ??
          renderJobList()
            .filter((j) => j.status === 'completed' && j.loudness)
            .sort((a, b) => (a.id < b.id ? 1 : -1))[0]
        if (job?.loudness) {
          return {
            state: estado,
            events: [ev('audio.analisis.actualizado', { source: 'render', jobId: job.id, loudness: job.loudness })],
            result: { ...job.loudness, source: 'render', jobId: job.id },
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
        (payload.jobId ? renderJobGet(payload.jobId) : undefined) ??
        renderJobList()
          .filter((j) => j.status === 'completed' && j.loudness)
          .sort((a, b) => (a.id < b.id ? 1 : -1))[0]
      const integrated =
        job?.loudness?.integrated ?? estado.project.analysis?.master?.loudness?.integrated
      if (integrated == null || !Number.isFinite(integrated)) {
        throw new Error('Sin medición: ejecuta un bounce (render.start) primero')
      }
      const cmp = compareLoudnessTarget(integrated, target)
      return {
        state: estado,
        events: [],
        result: { integrated, ...cmp, target },
      }
    },
  }
}
