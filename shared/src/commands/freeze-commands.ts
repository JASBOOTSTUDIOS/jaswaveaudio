/**
 * track.freeze / track.unfreeze — consolida a clip de audio y marca frozen.
 */

import type { CommandDefinition, StateTransition } from '../types/command'
import type { DAWState } from '../types/state'
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

export function crearComandoTrackFreeze(): CommandDefinition<any> {
  return {
    type: 'track.freeze',
    description: 'Marca pista como frozen (bypass plugins; el bounce de stem lo hace el cliente)',
    risk: 'write',
    schema: {
      type: 'object',
      required: ['trackId'],
      properties: {
        trackId: { type: 'string' },
        audioPath: { type: 'string' },
        clipId: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload): StateTransition<{ trackId: string }> => {
      const trackId = String(payload.trackId)
      const tracks = estado.project.tracks.map((t) => {
        if (t.id !== trackId) return t
        const plugins = (t.plugins ?? []).map((p) => ({ ...p, bypass: true }))
        return {
          ...t,
          frozen: true,
          estado: 'frozen' as const,
          plugins,
          comentario: payload.audioPath
            ? `frozen:${payload.audioPath}`
            : t.comentario,
        }
      })
      if (!tracks.some((t) => t.id === trackId)) throw new Error('Pista no encontrada')
      return {
        state: { ...estado, project: { ...estado.project, tracks } },
        events: [ev('track.frozen', { trackId, audioPath: payload.audioPath })],
        result: { trackId },
      }
    },
  }
}

export function crearComandoTrackUnfreeze(): CommandDefinition<any> {
  return {
    type: 'track.unfreeze',
    description: 'Quita frozen y reactiva plugins de la pista',
    risk: 'write',
    schema: {
      type: 'object',
      required: ['trackId'],
      properties: { trackId: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload): StateTransition<{ trackId: string }> => {
      const trackId = String(payload.trackId)
      const tracks = estado.project.tracks.map((t) => {
        if (t.id !== trackId) return t
        const plugins = (t.plugins ?? []).map((p) => ({ ...p, bypass: false }))
        return {
          ...t,
          frozen: false,
          estado: 'activo' as const,
          plugins,
          comentario: (t.comentario || '').startsWith('frozen:') ? undefined : t.comentario,
        }
      })
      return {
        state: { ...estado, project: { ...estado.project, tracks } },
        events: [ev('track.unfrozen', { trackId })],
        result: { trackId },
      }
    },
  }
}
