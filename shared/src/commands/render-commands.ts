/**
 * Comandos render.start / cancel / getStatus (hoja-ruta 035).
 */

import type { CommandDefinition, StateTransition } from '../types/command'
import type { DAWState } from '../types/state'
import type { RenderJob, RenderStartPayload } from '../types/render'
import type { TimePosition } from '../types/tiempo'
import {
  renderJobActive,
  renderJobGet,
  renderJobPut,
  renderJobUpdate,
} from '../render/job-store'
import type { EventoDominio } from '../events/evento-dominio'

function ev(nombre: string, payload: Record<string, unknown>): EventoDominio {
  return {
    nombre,
    version: 1,
    marcaTiempo: Date.now(),
    fuente: 'builtin',
    payload: payload as EventoDominio['payload'],
    asincrono: true,
  }
}

function secToPos(sec: number): TimePosition {
  const samples = Math.max(0, Math.floor(sec * 48000))
  return {
    beats: sec,
    segundos: sec,
    samples,
    ticks: 0,
    compases: 0,
    frames: samples,
    tiempoMusical: '1.1.0',
    porcentaje: 0,
  }
}

function newId(): string {
  return `render-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function crearComandoRenderStart(): CommandDefinition<any> {
  return {
    type: 'render.start',
    description: 'Inicia bounce/export WAV/FLAC/MP3 del proyecto',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['wav', 'flac', 'mp3'] },
        sampleRate: { type: 'number' },
        bitDepth: { type: 'number' },
        bitrate: { type: 'number' },
        startSec: { type: 'number' },
        endSec: { type: 'number' },
        outputPath: { type: 'string' },
        stems: { type: 'boolean' },
        normalize: { type: ['string', 'boolean'] },
        normalizeTargetDb: { type: 'number' },
        listenTarget: { type: 'string', enum: ['streaming', 'club', 'cd'] },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: RenderStartPayload): StateTransition<RenderJob> => {
      const format = payload.format ?? 'wav'
      if (format !== 'wav' && format !== 'flac' && format !== 'mp3') {
        throw new Error(`Formato no soportado: ${format}`)
      }
      const startSec = payload.startSec ?? 0
      const endSec = payload.endSec
      if (endSec != null && endSec <= startSec) {
        throw new Error('endSec debe ser > startSec')
      }
      if (renderJobActive()) {
        throw new Error('Ya hay un render en curso')
      }
      const normalize =
        payload.normalize === false || payload.normalize == null
          ? false
          : payload.normalize === true
            ? 'lufs'
            : payload.normalize
      const job: RenderJob = {
        id: newId(),
        projectId: estado.project.id,
        format,
        sampleRate: payload.sampleRate ?? 48000,
        bitDepth: payload.bitDepth ?? 16,
        bitrate: payload.bitrate,
        start: secToPos(startSec),
        end: secToPos(endSec ?? Math.max(startSec + 1, 30)),
        progress: 0,
        status: 'pending',
        outputPath: payload.outputPath,
        normalize,
        normalizeTargetDb: payload.normalizeTargetDb,
        exportStems: payload.stems === true,
        listenTarget: payload.listenTarget,
      }
      renderJobPut(job)
      return {
        state: estado,
        events: [ev('render.started', { jobId: job.id, job })],
        result: job,
      }
    },
  }
}

export function crearComandoRenderCancel(): CommandDefinition<{ renderJobId: string }> {
  return {
    type: 'render.cancel',
    description: 'Cancela un bounce en curso',
    risk: 'write',
    schema: {
      type: 'object',
      properties: { renderJobId: { type: 'string' } },
      required: ['renderJobId'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<{ renderJobId: string }> => {
      const job = renderJobGet(payload.renderJobId)
      if (!job) throw new Error(`RenderJob no encontrado: ${payload.renderJobId}`)
      renderJobUpdate(payload.renderJobId, { status: 'cancelled', progress: job.progress })
      return {
        state: estado,
        events: [ev('render.cancelled', { jobId: payload.renderJobId })],
        result: { renderJobId: payload.renderJobId },
      }
    },
  }
}

export function crearComandoRenderGetStatus(): CommandDefinition<any> {
  return {
    type: 'render.getStatus',
    description: 'Estado de un RenderJob',
    risk: 'read',
    schema: {
      type: 'object',
      properties: { renderJobId: { type: 'string' } },
      required: ['renderJobId'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<RenderJob> => {
      const job = renderJobGet(payload.renderJobId)
      if (!job) throw new Error(`RenderJob no encontrado: ${payload.renderJobId}`)
      return { state: estado, events: [], result: job }
    },
  }
}
