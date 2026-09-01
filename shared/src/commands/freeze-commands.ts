/**
 * track.freeze / track.unfreeze — consolida a clip de audio y marca frozen.
 * Guarda snapshot de bypass por plugin para restaurarlo en unfreeze.
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

const FROZEN_PREFIX = 'frozen:'
const BYPASS_SEP = '||bps:'

export function encodeFrozenComment(
  audioPath: string | undefined,
  bypassByPluginId: Record<string, boolean>,
): string {
  const path = audioPath?.trim() || ''
  return `${FROZEN_PREFIX}${path}${BYPASS_SEP}${JSON.stringify(bypassByPluginId)}`
}

export function parseFrozenComment(comentario: string | undefined): {
  audioPath?: string
  bypassByPluginId?: Record<string, boolean>
} {
  const raw = comentario || ''
  if (!raw.startsWith(FROZEN_PREFIX)) return {}
  const rest = raw.slice(FROZEN_PREFIX.length)
  const sep = rest.indexOf(BYPASS_SEP)
  if (sep < 0) return { audioPath: rest || undefined }
  const audioPath = rest.slice(0, sep) || undefined
  try {
    const bypassByPluginId = JSON.parse(rest.slice(sep + BYPASS_SEP.length)) as Record<
      string,
      boolean
    >
    return { audioPath, bypassByPluginId }
  } catch {
    return { audioPath }
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
        const bypassByPluginId: Record<string, boolean> = {}
        for (const p of t.plugins ?? []) {
          bypassByPluginId[p.id] = Boolean(p.bypass)
        }
        const plugins = (t.plugins ?? []).map((p) => ({ ...p, bypass: true }))
        return {
          ...t,
          frozen: true,
          estado: 'frozen' as const,
          plugins,
          comentario: encodeFrozenComment(
            typeof payload.audioPath === 'string' ? payload.audioPath : undefined,
            bypassByPluginId,
          ),
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
    description: 'Quita frozen y restaura bypass previo de plugins',
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
        const { bypassByPluginId } = parseFrozenComment(t.comentario)
        const plugins = (t.plugins ?? []).map((p) => ({
          ...p,
          bypass: bypassByPluginId ? Boolean(bypassByPluginId[p.id]) : false,
        }))
        return {
          ...t,
          frozen: false,
          estado: 'activo' as const,
          plugins,
          comentario: (t.comentario || '').startsWith(FROZEN_PREFIX) ? undefined : t.comentario,
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
