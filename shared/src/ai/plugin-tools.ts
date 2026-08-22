/**
 * Tools de FX Chain para el Tool Registry (ADR-0012).
 */

import type { ToolDefinitionExtended, ToolHandler, ToolRegistry } from './tool-registry'
import type { DAWState } from '../types/state'
import { MASTER_FX_TRACK_ID } from '../commands/plugin-commands'

type GetState = () => DAWState

export function chainOf(state: DAWState, trackId: string) {
  if (trackId === MASTER_FX_TRACK_ID || trackId === '__master__') {
    return {
      trackId: MASTER_FX_TRACK_ID,
      trackName: 'Master',
      plugins: state.project.master.plugins ?? [],
    }
  }
  const t = state.project.tracks.find((x) => x.id === trackId)
  return {
    trackId,
    trackName: t?.nombre ?? trackId,
    plugins: t?.plugins ?? [],
  }
}

const pluginWrite = (type: string, description: string): ToolDefinitionExtended => ({
  type,
  name: type,
  version: '1.0.0',
  description,
  category: 'plugin',
  risk: 'write',
  tags: ['plugin', 'fx'],
})

const getFxChainDef: ToolDefinitionExtended = {
  type: 'track.getFxChain',
  name: 'track.getFxChain',
  version: '1.0.0',
  description: 'Lista la FX Chain de una pista o del master',
  category: 'plugin',
  risk: 'read',
  tags: ['plugin', 'fx', 'query'],
}

function ok(data: unknown) {
  return { success: true as const, data, events: [] }
}
function fail(code: string, message: string) {
  return { success: false as const, error: { code, message }, events: [] }
}

export function registrarPluginTools(registry: ToolRegistry, getState: GetState): void {
  const getFxChainHandler: ToolHandler = async (params) => {
    const trackId = String((params as { trackId?: string }).trackId ?? '')
    if (!trackId) return fail('MISSING', 'trackId requerido')
    const chain = chainOf(getState(), trackId)
    return ok({
      ...chain,
      plugins: chain.plugins.map((pl, position) => ({
        instanceId: pl.id,
        name: pl.nombre,
        type: pl.tipo,
        position,
        bypass: pl.bypass,
        latency: pl.latencia,
        estado: pl.estado,
      })),
    })
  }

  const viaCommand =
    (type: string): ToolHandler =>
    async (params, ctx) => {
      try {
        const r = await ctx.commandExecutor.execute(type, params as Record<string, unknown>)
        return {
          success: r.success,
          data: r.result,
          error: r.success ? undefined : { code: 'CMD', message: r.error?.message ?? 'fail' },
          events: r.events ?? [],
        }
      } catch (e) {
        return fail('COMMAND_FAILED', e instanceof Error ? e.message : String(e))
      }
    }

  try {
    registry.register(getFxChainDef, getFxChainHandler)
  } catch {
    /* HMR */
  }

  for (const [type, description] of [
    ['plugin.insert', 'Inserta un plugin en la FX Chain'],
    ['plugin.remove', 'Quita un plugin de la FX Chain'],
    ['plugin.move', 'Reordena un plugin en la cadena'],
    ['plugin.bypass', 'Activa/desactiva bypass'],
    ['plugin.duplicate', 'Duplica una instancia'],
    ['plugin.replace', 'Reemplaza un plugin en la misma posición'],
    ['plugin.setParameter', 'Actualiza un parámetro lógico'],
  ] as const) {
    try {
      registry.register(pluginWrite(type, description), viaCommand(type))
    } catch {
      /* HMR */
    }
  }
}
