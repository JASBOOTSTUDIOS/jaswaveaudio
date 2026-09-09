/**
 * Comandos de tomas / comping audio.
 */

import type { CommandDefinition, StateTransition } from '../types/command'
import type { DAWState } from '../types/state'
import type { EventoDominio } from '../events/evento-dominio'
import type { CompSegment, Take, TakeFolder } from '../types/entidades'

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function ev(nombre: string, payload: Record<string, unknown>): EventoDominio {
  return {
    nombre,
    version: 1,
    marcaTiempo: Date.now(),
    fuente: 'builtin',
    payload: payload as EventoDominio['payload'],
  }
}

function foldersOf(estado: DAWState): TakeFolder[] {
  return estado.project.takeFolders ?? []
}

function folderForTrack(estado: DAWState, pistaId: string): TakeFolder | undefined {
  return foldersOf(estado).find((f) => f.pistaId === pistaId)
}

function ensureTakeFolderInline(
  estado: DAWState,
  pistaId: string,
): { state: DAWState; folder: TakeFolder } {
  const track = estado.project.tracks.find((t) => t.id === pistaId)
  if (!track) throw new Error(`Pista no encontrada: ${pistaId}`)
  const existing = folderForTrack(estado, pistaId)
  if (existing) return { state: estado, folder: existing }
  const folder: TakeFolder = {
    id: newId('tf'),
    pistaId,
    takes: [],
    segments: [],
  }
  const takeFolders = [...foldersOf(estado), folder]
  const tracks = estado.project.tracks.map((t) =>
    t.id === pistaId ? { ...t, takeFolderId: folder.id } : t,
  )
  return {
    state: {
      ...estado,
      project: { ...estado.project, takeFolders, tracks, modificado: true },
    },
    folder,
  }
}

export function crearComandoTakeFolderEnsure(): CommandDefinition<any> {
  return {
    type: 'take.folder.ensure',
    description: 'Crea carpeta de tomas en pista si no existe',
    risk: 'write',
    schema: {
      type: 'object',
      required: ['pistaId'],
      properties: { pistaId: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<{ folderId: string }> => {
      const pistaId = String(payload.pistaId)
      const track = estado.project.tracks.find((t) => t.id === pistaId)
      if (!track) throw new Error(`Pista no encontrada: ${pistaId}`)
      const existing = folderForTrack(estado, pistaId)
      if (existing) {
        return {
          state: estado,
          events: [],
          result: { folderId: existing.id },
        }
      }
      const folder: TakeFolder = {
        id: newId('tf'),
        pistaId,
        takes: [],
        segments: [],
      }
      const takeFolders = [...foldersOf(estado), folder]
      const tracks = estado.project.tracks.map((t) =>
        t.id === pistaId ? { ...t, takeFolderId: folder.id } : t,
      )
      return {
        state: {
          ...estado,
          project: { ...estado.project, takeFolders, tracks, modificado: true },
        },
        events: [ev('take.folderCreated', { folderId: folder.id, pistaId })],
        result: { folderId: folder.id },
      }
    },
  }
}

export function crearComandoTakeAdd(): CommandDefinition<any> {
  return {
    type: 'take.add',
    description: 'Registra un WAV como toma en la carpeta de la pista',
    risk: 'write',
    schema: {
      type: 'object',
      required: ['pistaId', 'archivo'],
      properties: {
        pistaId: { type: 'string' },
        archivo: { type: 'string' },
        nombre: { type: 'string' },
        inicioGrabacion: { type: 'number' },
        finGrabacion: { type: 'number' },
        sampleRate: { type: 'number' },
        bitDepth: { type: 'number' },
        canales: { type: 'number' },
      },
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<{ takeId: string }> => {
      const pistaId = String(payload.pistaId)
      let nextState = estado
      let folder = folderForTrack(estado, pistaId)
      if (!folder) {
        const ensured = ensureTakeFolderInline(estado, pistaId)
        nextState = ensured.state
        folder = ensured.folder
      }
      if (!folder) throw new Error('No se pudo crear carpeta de tomas')
      const take: Take = {
        id: newId('take'),
        pistaId,
        nombre: String(payload.nombre ?? `Take ${folder.takes.length + 1}`),
        inicioGrabacion: Number(payload.inicioGrabacion ?? 0),
        finGrabacion: Number(payload.finGrabacion ?? 0),
        archivo: String(payload.archivo),
        formato: 'wav',
        sampleRate: Number(payload.sampleRate ?? 48000),
        bitDepth: Number(payload.bitDepth ?? 24),
        canales: Number(payload.canales ?? 2),
        tamaño: 0,
        seleccionado: false,
        muteado: false,
        notas: '',
      }
      const takeFolders = foldersOf(nextState).map((f) =>
        f.id === folder!.id ? { ...f, takes: [...f.takes, take] } : f,
      )
      return {
        state: {
          ...nextState,
          project: { ...nextState.project, takeFolders, modificado: true },
        },
        events: [ev('take.added', { takeId: take.id, pistaId })],
        result: { takeId: take.id },
      }
    },
  }
}

export function crearComandoTakeDelete(): CommandDefinition<any> {
  return {
    type: 'take.delete',
    description: 'Elimina una toma y sus segmentos de comp',
    risk: 'dangerous',
    schema: {
      type: 'object',
      required: ['takeId'],
      properties: { takeId: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<{ takeId: string }> => {
      const takeId = String(payload.takeId)
      const takeFolders = foldersOf(estado).map((f) => ({
        ...f,
        takes: f.takes.filter((t) => t.id !== takeId),
        segments: f.segments.filter((s) => s.takeId !== takeId),
        takeActivoId: f.takeActivoId === takeId ? undefined : f.takeActivoId,
      }))
      return {
        state: {
          ...estado,
          project: { ...estado.project, takeFolders, modificado: true },
        },
        events: [ev('take.deleted', { takeId })],
        result: { takeId },
      }
    },
  }
}

export function crearComandoTakeRename(): CommandDefinition<any> {
  return {
    type: 'take.rename',
    description: 'Renombra una toma',
    risk: 'write',
    schema: {
      type: 'object',
      required: ['takeId', 'nombre'],
      properties: { takeId: { type: 'string' }, nombre: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<{ takeId: string }> => {
      const takeId = String(payload.takeId)
      const nombre = String(payload.nombre)
      const takeFolders = foldersOf(estado).map((f) => ({
        ...f,
        takes: f.takes.map((t) => (t.id === takeId ? { ...t, nombre } : t)),
      }))
      return {
        state: {
          ...estado,
          project: { ...estado.project, takeFolders, modificado: true },
        },
        events: [ev('take.renamed', { takeId, nombre })],
        result: { takeId },
      }
    },
  }
}

export function crearComandoTakePreview(): CommandDefinition<any> {
  return {
    type: 'take.preview',
    description: 'Audition solo una toma (null = comp activo)',
    risk: 'write',
    schema: {
      type: 'object',
      required: ['pistaId'],
      properties: { takeId: { type: ['string', 'null'] }, pistaId: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<{ takeId: string | null }> => {
      const pistaId = String(payload.pistaId)
      const takeId = payload.takeId == null ? null : String(payload.takeId)
      const takeFolders = foldersOf(estado).map((f) =>
        f.pistaId === pistaId ? { ...f, takeActivoId: takeId ?? undefined } : f,
      )
      return {
        state: {
          ...estado,
          project: { ...estado.project, takeFolders, modificado: true },
        },
        events: [ev('take.preview', { pistaId, takeId })],
        result: { takeId },
      }
    },
  }
}

export function crearComandoCompSegmentSet(): CommandDefinition<any> {
  return {
    type: 'comp.segment.set',
    description: 'Define o reemplaza un segmento en la matriz de comp',
    risk: 'write',
    schema: {
      type: 'object',
      required: ['pistaId', 'takeId', 'timelineInicio', 'timelineFin'],
      properties: {
        pistaId: { type: 'string' },
        takeId: { type: 'string' },
        timelineInicio: { type: 'number' },
        timelineFin: { type: 'number' },
        origenInicio: { type: 'number' },
        origenFin: { type: 'number' },
        segmentId: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<{ segmentId: string }> => {
      const pistaId = String(payload.pistaId)
      const takeId = String(payload.takeId)
      const tl0 = Number(payload.timelineInicio)
      const tl1 = Number(payload.timelineFin)
      if (!(tl1 > tl0)) throw new Error('timelineFin debe ser mayor que timelineInicio')
      const folder = folderForTrack(estado, pistaId)
      if (!folder) throw new Error('Sin carpeta de tomas; usa take.folder.ensure')
      const take = folder.takes.find((t) => t.id === takeId)
      if (!take) throw new Error(`Toma no encontrada: ${takeId}`)
      const durSec = Math.max(0.01, take.finGrabacion - take.inicioGrabacion)
      const origenInicio = Number(payload.origenInicio ?? 0)
      const origenFin = Number(payload.origenFin ?? durSec)
      const seg: CompSegment = {
        id: payload.segmentId ? String(payload.segmentId) : newId('seg'),
        takeId,
        origenInicio,
        origenFin,
        timelineInicio: tl0,
        timelineFin: tl1,
      }
      const trimmed = folder.segments.filter(
        (s) => !(s.timelineFin <= tl0 || s.timelineInicio >= tl1),
      )
      const takeFolders = foldersOf(estado).map((f) =>
        f.id === folder.id ? { ...f, segments: [...trimmed, seg] } : f,
      )
      return {
        state: {
          ...estado,
          project: { ...estado.project, takeFolders, modificado: true },
        },
        events: [ev('comp.segmentSet', { segmentId: seg.id, pistaId, takeId })],
        result: { segmentId: seg.id },
      }
    },
  }
}

export function crearComandoCompSegmentClear(): CommandDefinition<any> {
  return {
    type: 'comp.segment.clear',
    description: 'Quita un segmento del comp',
    risk: 'write',
    schema: {
      type: 'object',
      required: ['segmentId'],
      properties: { segmentId: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<{ segmentId: string }> => {
      const segmentId = String(payload.segmentId)
      const takeFolders = foldersOf(estado).map((f) => ({
        ...f,
        segments: f.segments.filter((s) => s.id !== segmentId),
      }))
      return {
        state: {
          ...estado,
          project: { ...estado.project, takeFolders, modificado: true },
        },
        events: [ev('comp.segmentCleared', { segmentId })],
        result: { segmentId },
      }
    },
  }
}

export function crearComandoTransportSetRecordMode(): CommandDefinition<any> {
  return {
    type: 'transport.setRecordMode',
    description: 'Cambia modo de grabación (normal, comping, punch, …)',
    risk: 'write',
    schema: {
      type: 'object',
      required: ['modo'],
      properties: {
        modo: {
          type: 'string',
          enum: ['normal', 'loop', 'punch', 'comping', 'sobrescritura', 'stack'],
        },
      },
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<{ modo: string }> => {
      const modo = String(payload.modo) as typeof estado.transport.modoGrabacion
      return {
        state: {
          ...estado,
          transport: { ...estado.transport, modoGrabacion: modo },
        },
        events: [ev('transport.recordMode', { modo })],
        result: { modo },
      }
    },
  }
}
