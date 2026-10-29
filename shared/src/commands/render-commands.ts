/**
 * Comandos render.start / cancel / getStatus (hoja-ruta 035).
 */

import type { CommandDefinition, StateTransition } from '../types/command'
import type { DAWState } from '../types/state'
import type { RenderJob, RenderStartPayload } from '../types/render'
import { RENDER_BIT_DEPTHS, RENDER_FORMATS, RENDER_SAMPLE_RATES } from '../types/render'
import { detectarFinProyecto } from '../render/fin-proyecto'
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
    marcaTiempo: entorno.ahora(),
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
  return `render-${entorno.ahora().toString(36)}-${entorno.aleatorio().toString(36).slice(2, 8)}`
}

export function crearComandoRenderStart(): CommandDefinition<any> {
  return {
    type: 'render.start',
    replicacion: 'resultado',
    description:
      'Exporta el proyecto (WAV/AIFF/FLAC/MP3/OGG/AAC/Opus). Sin endSec detecta solo dónde termina la canción.',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: [...RENDER_FORMATS] },
        sampleRate: { type: 'number' },
        bitDepth: { type: 'number' },
        bitrate: { type: 'number' },
        startSec: { type: 'number' },
        endSec: { type: 'number' },
        outputPath: { type: 'string' },
        stems: { type: 'boolean' },
        stemTrackIds: { type: 'array', items: { type: 'string' } },
        stemsTap: { type: 'string', enum: ['post', 'pre'] },
        normalize: { type: ['string', 'boolean'] },
        normalizeTargetDb: { type: 'number' },
        listenTarget: { type: 'string', enum: ['streaming', 'club', 'cd'] },
        dither: { type: 'boolean' },
        transparentMaster: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: RenderStartPayload): StateTransition<RenderJob> => {
      const format = payload.format ?? 'wav'
      if (!RENDER_FORMATS.includes(format)) {
        throw new Error(`Formato no soportado: ${format}. Usa uno de: ${RENDER_FORMATS.join(', ')}.`)
      }
      const sampleRate = payload.sampleRate ?? 48000
      if (!(RENDER_SAMPLE_RATES as readonly number[]).includes(sampleRate)) {
        throw new Error(`Frecuencia de muestreo no soportada: ${sampleRate}. Usa ${RENDER_SAMPLE_RATES.join(', ')} Hz.`)
      }
      const bitDepth = payload.bitDepth ?? 24
      if (!(RENDER_BIT_DEPTHS as readonly number[]).includes(bitDepth)) {
        throw new Error(`Profundidad no soportada: ${bitDepth} bits. Usa 16, 24 o 32 (float).`)
      }
      if (payload.bitrate != null && (payload.bitrate < 64 || payload.bitrate > 320)) {
        throw new Error('bitrate debe estar entre 64 y 320 kbps.')
      }
      const startSec = Math.max(0, payload.startSec ?? 0)
      // Sin endSec: el final lo marca el contenido (último clip audible); el bounce añade la cola.
      const fin = detectarFinProyecto(estado.project)
      const autoEnd = payload.endSec == null
      if (autoEnd && fin.vacio) {
        throw new Error('No hay contenido en la línea de tiempo: añade clips (o quita el mute/solo) antes de exportar.')
      }
      const endSec = autoEnd ? fin.finSegundos : payload.endSec!
      if (endSec <= startSec) {
        throw new Error(
          autoEnd
            ? `El contenido termina en ${endSec.toFixed(1)} s, antes del inicio pedido (${startSec.toFixed(1)} s).`
            : 'endSec debe ser > startSec',
        )
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
        sampleRate,
        bitDepth,
        bitrate: payload.bitrate,
        start: secToPos(startSec),
        end: secToPos(endSec),
        progress: 0,
        status: 'pending',
        outputPath: payload.outputPath,
        normalize,
        normalizeTargetDb: payload.normalizeTargetDb,
        exportStems: payload.stems === true || (payload.stemTrackIds?.length ?? 0) > 0,
        stemTrackIds: payload.stemTrackIds?.length ? [...payload.stemTrackIds] : undefined,
        stemsTap: payload.stemsTap,
        listenTarget: payload.listenTarget,
        autoEnd,
        contentEndSec: autoEnd ? endSec : undefined,
        dither: payload.dither,
        transparentMaster: payload.transparentMaster,
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
    replicacion: 'resultado',
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
    replicacion: 'resultado',
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

import { entorno } from '../state/entorno-determinista';