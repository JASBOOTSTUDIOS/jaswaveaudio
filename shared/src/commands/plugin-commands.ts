/**
 * Comandos de FX Chain por pista / Master (ADR-0012).
 * SSOT: track.plugins · project.master.plugins (orden = procesamiento).
 */

import type { CommandDefinition, StateTransition } from '../types/command'
import type { DAWState } from '../types/state'
import type { ProjectState } from '../types/proyecto'
import type { Track } from '../types/tracks'
import type { PluginInfo, ParametroPluginOpciones } from '../types/entidades'
import { EventosPlugin, EventosTrack } from '../constants/nombres-eventos'

/** Id canónico para FX Chain del master (mismo API que trackId). */
export const MASTER_FX_TRACK_ID = 'master'

function generarId(): string {
  return `plugin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function isMasterFxId(trackId: string): boolean {
  return trackId === MASTER_FX_TRACK_ID || trackId === '__master__'
}

type ChainHost = { id: string; nombre: string; plugins: PluginInfo[] }

function resolveChainHost(estado: DAWState, trackId: string): ChainHost {
  if (isMasterFxId(trackId)) {
    return {
      id: MASTER_FX_TRACK_ID,
      nombre: 'Master',
      plugins: [...(estado.project.master.plugins ?? [])],
    }
  }
  const pista = estado.project.tracks.find((t) => t.id === trackId)
  if (!pista) throw new Error(`Pista no encontrada: ${trackId}`)
  return { id: pista.id, nombre: pista.nombre, plugins: [...(pista.plugins ?? [])] }
}

function applyChain(estado: DAWState, trackId: string, plugins: PluginInfo[]): ProjectState {
  const now = Date.now()
  if (isMasterFxId(trackId)) {
    return {
      ...estado.project,
      master: { ...estado.project.master, plugins },
      modificado: true,
      fechaModificacion: now,
    }
  }
  return {
    ...estado.project,
    tracks: estado.project.tracks.map((t) =>
      t.id === trackId ? ({ ...t, plugins, fechaModificacion: now } as Track) : t,
    ),
    modificado: true,
    fechaModificacion: now,
  }
}

/** @deprecated use resolveChainHost — kept for callers that need Track */
function findTrack(estado: DAWState, trackId: string): Track {
  if (isMasterFxId(trackId)) {
    return {
      id: MASTER_FX_TRACK_ID,
      nombre: 'Master',
      plugins: estado.project.master.plugins ?? [],
    } as Track
  }
  const pista = estado.project.tracks.find((t) => t.id === trackId)
  if (!pista) throw new Error(`Pista no encontrada: ${trackId}`)
  return pista
}

function withPlugins(estado: DAWState, trackId: string, plugins: PluginInfo[]): ProjectState {
  return applyChain(estado, trackId, plugins)
}

export type PluginInsertPayload = {
  trackId: string
  plugin: PluginInfo
  /** Índice de inserción; default = final */
  position?: number
  /** Alias de position (compat agente) */
  index?: number
  /** Ruta VST/host a persistir en plugin.descripcion */
  path?: string
}

export type PluginUpdatePayload = {
  trackId: string
  pluginInstanceId: string
  /** Parches permitidos sobre PluginInfo (p.ej. descripcion = path host) */
  patch: Partial<Pick<PluginInfo, 'descripcion' | 'nombre' | 'bypass' | 'estadoPluginBase64'>>
}

export type PluginRemovePayload = {
  trackId: string
  pluginInstanceId: string
}

export type PluginMovePayload = {
  trackId: string
  pluginInstanceId: string
  toIndex: number
}

export type PluginBypassPayload = {
  trackId: string
  pluginInstanceId: string
  bypass: boolean
}

export type PluginDuplicatePayload = {
  trackId: string
  pluginInstanceId: string
}

export function crearComandoPluginInsert(): CommandDefinition<PluginInsertPayload> {
  return {
    type: 'plugin.insert',
    inverseType: 'plugin.remove',
    description: 'Inserta un plugin en la FX Chain de una pista',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        plugin: { type: 'object' },
        position: { type: 'number' },
        index: { type: 'number' },
        path: { type: 'string' },
      },
      required: ['trackId', 'plugin'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<PluginInsertPayload> => {
      const pista = findTrack(estado, payload.trackId)
      const chain = [...(pista.plugins ?? [])]
      const path = typeof payload.path === 'string' && payload.path.length > 0 ? payload.path : undefined
      const plugin: PluginInfo = {
        ...payload.plugin,
        id: payload.plugin.id || generarId(),
        ...(path ? { descripcion: path } : {}),
      }
      if (chain.some((p) => p.id === plugin.id)) {
        throw new Error(`Ya existe plugin instanceId: ${plugin.id}`)
      }
      const rawPos = payload.position ?? payload.index
      const pos =
        rawPos === undefined
          ? chain.length
          : Math.max(0, Math.min(Number(rawPos), chain.length))
      chain.splice(pos, 0, plugin)

      return {
        state: { ...estado, project: withPlugins(estado, payload.trackId, chain) },
        events: [
          {
            nombre: EventosPlugin.cargado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: {
              trackId: payload.trackId,
              pluginInstanceId: plugin.id,
              position: pos,
              nombre: plugin.nombre,
              tipo: plugin.tipo,
            },
          },
          {
            nombre: EventosTrack.actualizada,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: { trackId: payload.trackId, cambios: { plugins: chain } as any },
          },
        ],
        result: { ...payload, plugin, position: pos },
        inversePayload: {
          trackId: payload.trackId,
          pluginInstanceId: plugin.id,
        } satisfies PluginRemovePayload,
      }
    },
  }
}

export function crearComandoPluginUpdate(): CommandDefinition<PluginUpdatePayload> {
  return {
    type: 'plugin.update',
    inverseType: 'plugin.update',
    description: 'Actualiza metadatos de un plugin en la FX Chain (p.ej. descripcion/path)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        pluginInstanceId: { type: 'string' },
        patch: { type: 'object' },
      },
      required: ['trackId', 'pluginInstanceId', 'patch'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<PluginUpdatePayload> => {
      const pista = findTrack(estado, payload.trackId)
      const chain = [...(pista.plugins ?? [])]
      const idx = chain.findIndex((p) => p.id === payload.pluginInstanceId)
      if (idx < 0) throw new Error(`Plugin no encontrado: ${payload.pluginInstanceId}`)
      const prev = chain[idx]!
      const inversePatch: PluginUpdatePayload['patch'] = {}
      if (payload.patch.descripcion !== undefined) inversePatch.descripcion = prev.descripcion
      if (payload.patch.nombre !== undefined) inversePatch.nombre = prev.nombre
      if (payload.patch.bypass !== undefined) inversePatch.bypass = prev.bypass
      if (payload.patch.estadoPluginBase64 !== undefined) {
        inversePatch.estadoPluginBase64 = prev.estadoPluginBase64
      }
      const next: PluginInfo = { ...prev, ...payload.patch }
      chain[idx] = next
      return {
        state: { ...estado, project: withPlugins(estado, payload.trackId, chain) },
        events: [
          {
            nombre: EventosTrack.actualizada,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: { trackId: payload.trackId, cambios: { plugins: chain } as never },
          },
        ],
        result: { ...payload, plugin: next } as PluginUpdatePayload & { plugin: PluginInfo },
        inversePayload: {
          trackId: payload.trackId,
          pluginInstanceId: payload.pluginInstanceId,
          patch: inversePatch,
        } satisfies PluginUpdatePayload,
      }
    },
  }
}

export function crearComandoPluginRemove(): CommandDefinition<PluginRemovePayload> {
  return {
    type: 'plugin.remove',
    inverseType: 'plugin.insert',
    description: 'Elimina un plugin de la FX Chain',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        pluginInstanceId: { type: 'string' },
      },
      required: ['trackId', 'pluginInstanceId'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<PluginRemovePayload> => {
      const pista = findTrack(estado, payload.trackId)
      const chain = [...(pista.plugins ?? [])]
      const idx = chain.findIndex((p) => p.id === payload.pluginInstanceId)
      if (idx < 0) throw new Error(`Plugin no encontrado: ${payload.pluginInstanceId}`)
      const [removed] = chain.splice(idx, 1)

      return {
        state: { ...estado, project: withPlugins(estado, payload.trackId, chain) },
        events: [
          {
            nombre: EventosPlugin.descargado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: {
              trackId: payload.trackId,
              pluginInstanceId: payload.pluginInstanceId,
              position: idx,
            },
          },
          {
            nombre: EventosTrack.actualizada,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: { trackId: payload.trackId, cambios: { plugins: chain } as any },
          },
        ],
        result: payload,
        inversePayload: {
          trackId: payload.trackId,
          plugin: removed!,
          position: idx,
        } satisfies PluginInsertPayload,
      }
    },
  }
}

export function crearComandoPluginMove(): CommandDefinition<PluginMovePayload> {
  return {
    type: 'plugin.move',
    inverseType: 'plugin.move',
    description: 'Reordena un plugin en la FX Chain',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        pluginInstanceId: { type: 'string' },
        toIndex: { type: 'number' },
      },
      required: ['trackId', 'pluginInstanceId', 'toIndex'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<PluginMovePayload> => {
      const pista = findTrack(estado, payload.trackId)
      const chain = [...(pista.plugins ?? [])]
      const fromIndex = chain.findIndex((p) => p.id === payload.pluginInstanceId)
      if (fromIndex < 0) throw new Error(`Plugin no encontrado: ${payload.pluginInstanceId}`)
      const toIndex = Math.max(0, Math.min(payload.toIndex, chain.length - 1))
      if (fromIndex === toIndex) {
        return {
          state: estado,
          events: [],
          result: payload,
          inversePayload: payload,
        }
      }
      const [item] = chain.splice(fromIndex, 1)
      chain.splice(toIndex, 0, item!)

      return {
        state: { ...estado, project: withPlugins(estado, payload.trackId, chain) },
        events: [
          {
            nombre: EventosPlugin.movido,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: {
              trackId: payload.trackId,
              pluginInstanceId: payload.pluginInstanceId,
              fromIndex,
              toIndex,
            },
          },
          {
            nombre: EventosTrack.actualizada,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: { trackId: payload.trackId, cambios: { plugins: chain } as any },
          },
        ],
        result: payload,
        inversePayload: {
          trackId: payload.trackId,
          pluginInstanceId: payload.pluginInstanceId,
          toIndex: fromIndex,
        },
      }
    },
  }
}

export function crearComandoPluginBypass(): CommandDefinition<PluginBypassPayload> {
  return {
    type: 'plugin.bypass',
    inverseType: 'plugin.bypass',
    description: 'Activa/desactiva bypass de un plugin (no unload)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        pluginInstanceId: { type: 'string' },
        bypass: { type: 'boolean' },
      },
      required: ['trackId', 'pluginInstanceId', 'bypass'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<PluginBypassPayload> => {
      const pista = findTrack(estado, payload.trackId)
      const chain = (pista.plugins ?? []).map((p) =>
        p.id === payload.pluginInstanceId ? { ...p, bypass: payload.bypass } : p,
      )
      if (!(pista.plugins ?? []).some((p) => p.id === payload.pluginInstanceId)) {
        throw new Error(`Plugin no encontrado: ${payload.pluginInstanceId}`)
      }
      const prev = (pista.plugins ?? []).find((p) => p.id === payload.pluginInstanceId)!

      return {
        state: { ...estado, project: withPlugins(estado, payload.trackId, chain) },
        events: [
          {
            nombre: EventosPlugin.bypassCambiado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: {
              trackId: payload.trackId,
              pluginInstanceId: payload.pluginInstanceId,
              bypass: payload.bypass,
            },
          },
        ],
        result: payload,
        inversePayload: {
          trackId: payload.trackId,
          pluginInstanceId: payload.pluginInstanceId,
          bypass: prev.bypass,
        },
      }
    },
  }
}

export function crearComandoPluginDuplicate(): CommandDefinition<PluginDuplicatePayload> {
  return {
    type: 'plugin.duplicate',
    inverseType: 'plugin.remove',
    description: 'Duplica una instancia de plugin (nuevo id, mismo estado lógico)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        pluginInstanceId: { type: 'string' },
      },
      required: ['trackId', 'pluginInstanceId'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<PluginDuplicatePayload> => {
      const pista = findTrack(estado, payload.trackId)
      const chain = [...(pista.plugins ?? [])]
      const idx = chain.findIndex((p) => p.id === payload.pluginInstanceId)
      if (idx < 0) throw new Error(`Plugin no encontrado: ${payload.pluginInstanceId}`)
      const src = chain[idx]!
      const copy: PluginInfo = {
        ...structuredClone(src),
        id: generarId(),
        nombre: `${src.nombre} (copia)`,
      }
      chain.splice(idx + 1, 0, copy)

      return {
        state: { ...estado, project: withPlugins(estado, payload.trackId, chain) },
        events: [
          {
            nombre: EventosPlugin.cargado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: {
              trackId: payload.trackId,
              pluginInstanceId: copy.id,
              position: idx + 1,
              duplicatedFrom: payload.pluginInstanceId,
            },
          },
        ],
        result: { ...payload, newInstanceId: copy.id } as PluginDuplicatePayload,
        inversePayload: {
          trackId: payload.trackId,
          pluginInstanceId: copy.id,
        } satisfies PluginRemovePayload,
      }
    },
  }
}

export type PluginReplacePayload = {
  trackId: string
  pluginInstanceId: string
  plugin: PluginInfo
  newInstanceId?: string
}

export function crearComandoPluginReplace(): CommandDefinition<PluginReplacePayload> {
  return {
    type: 'plugin.replace',
    inverseType: 'plugin.replace',
    description: 'Reemplaza un plugin en la misma posición (nuevo instanceId)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        pluginInstanceId: { type: 'string' },
        plugin: { type: 'object' },
      },
      required: ['trackId', 'pluginInstanceId', 'plugin'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<PluginReplacePayload> => {
      const host = resolveChainHost(estado, payload.trackId)
      const chain = [...host.plugins]
      const idx = chain.findIndex((p) => p.id === payload.pluginInstanceId)
      if (idx < 0) throw new Error(`Plugin no encontrado: ${payload.pluginInstanceId}`)
      const prev = chain[idx]!
      const next: PluginInfo = {
        ...payload.plugin,
        id: payload.plugin.id || generarId(),
        bypass: payload.plugin.bypass ?? prev.bypass,
      }
      chain[idx] = next
      return {
        state: { ...estado, project: applyChain(estado, payload.trackId, chain) },
        events: [
          {
            nombre: EventosPlugin.cargado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: {
              trackId: payload.trackId,
              pluginInstanceId: next.id,
              replaced: payload.pluginInstanceId,
              position: idx,
            },
          },
          {
            nombre: EventosPlugin.descargado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: { trackId: payload.trackId, pluginInstanceId: payload.pluginInstanceId },
          },
        ],
        result: { ...payload, newInstanceId: next.id },
        inversePayload: {
          trackId: payload.trackId,
          pluginInstanceId: next.id,
          plugin: prev,
        },
      }
    },
  }
}

export type PluginSetParameterPayload = {
  trackId: string
  pluginInstanceId: string
  parameterId: string
  normalizedValue: number
  plainValue?: number
  name?: string
}

export function crearComandoPluginSetParameter(): CommandDefinition<PluginSetParameterPayload> {
  return {
    type: 'plugin.setParameter',
    inverseType: 'plugin.setParameter',
    description: 'Actualiza un parámetro lógico del plugin (dominio; host sync aparte)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        pluginInstanceId: { type: 'string' },
        parameterId: { type: 'string' },
        normalizedValue: { type: 'number' },
        plainValue: { type: 'number' },
        name: { type: 'string' },
      },
      required: ['trackId', 'pluginInstanceId', 'parameterId', 'normalizedValue'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<PluginSetParameterPayload> => {
      const host = resolveChainHost(estado, payload.trackId)
      const chain = host.plugins.map((p) => {
        if (p.id !== payload.pluginInstanceId) return p
        const params = [...(p.parametros ?? [])]
        const i = params.findIndex((x) => x.id === payload.parameterId || x.nombre === payload.parameterId)
        const entry: ParametroPluginOpciones = {
          id: payload.parameterId,
          nombre: payload.name ?? (i >= 0 ? params[i]!.nombre : payload.parameterId),
          valor: payload.normalizedValue,
          minimo: i >= 0 ? params[i]!.minimo : 0,
          maximo: i >= 0 ? params[i]!.maximo : 1,
          paso: i >= 0 ? params[i]!.paso : 0.01,
          unidad: i >= 0 ? params[i]!.unidad : '',
          etiqueta: payload.name ?? (i >= 0 ? params[i]!.etiqueta : payload.parameterId),
        }
        if (i >= 0) params[i] = { ...params[i]!, ...entry }
        else params.push(entry)
        return { ...p, parametros: params }
      })
      if (!host.plugins.some((p) => p.id === payload.pluginInstanceId)) {
        throw new Error(`Plugin no encontrado: ${payload.pluginInstanceId}`)
      }
      const prev = host.plugins.find((p) => p.id === payload.pluginInstanceId)!
      const prevParam = (prev.parametros ?? []).find(
        (x) => x.id === payload.parameterId || x.nombre === payload.parameterId,
      )

      return {
        state: { ...estado, project: applyChain(estado, payload.trackId, chain) },
        events: [
          {
            nombre: EventosPlugin.parametroCambiado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: {
              trackId: payload.trackId,
              pluginInstanceId: payload.pluginInstanceId,
              parameterId: payload.parameterId,
              normalizedValue: payload.normalizedValue,
            },
          },
        ],
        result: payload,
        inversePayload: {
          trackId: payload.trackId,
          pluginInstanceId: payload.pluginInstanceId,
          parameterId: payload.parameterId,
          normalizedValue: prevParam?.valor ?? 0,
          name: prevParam?.nombre,
        },
      }
    },
  }
}

export type FxChainCopyPayload = {
  trackId: string
  /** Si se omite, copia toda la cadena */
  pluginInstanceIds?: string[]
}

export type FxChainPastePayload = {
  trackId: string
  plugins: PluginInfo[]
  position?: number
}

export type FxChainPresetPayload = {
  trackId: string
  presetId: string
  nombre: string
  plugins: PluginInfo[]
}

/** Clipboard en memoria de dominio (sesión); la UI también puede cachear. */
let fxClipboard: PluginInfo[] = []

export function getFxChainClipboard(): PluginInfo[] {
  return fxClipboard.map((p) => structuredClone(p))
}

export function crearComandoFxChainCopy(): CommandDefinition<FxChainCopyPayload> {
  return {
    type: 'fxChain.copy',
    description: 'Copia plugins de la FX Chain al clipboard de sesión',
    risk: 'read',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        pluginInstanceIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['trackId'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<FxChainCopyPayload> => {
      const host = resolveChainHost(estado, payload.trackId)
      const ids = payload.pluginInstanceIds
      const selected = ids?.length
        ? host.plugins.filter((p) => ids.includes(p.id))
        : host.plugins
      fxClipboard = selected.map((p) => structuredClone(p))
      return {
        state: estado,
        events: [],
        result: { ...payload, count: fxClipboard.length } as FxChainCopyPayload,
      }
    },
  }
}

export function crearComandoFxChainPaste(): CommandDefinition<FxChainPastePayload> {
  return {
    type: 'fxChain.paste',
    inverseType: 'fxChain.pasteUndo',
    description: 'Pega plugins (nuevos ids) en la FX Chain',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        plugins: { type: 'array' },
        position: { type: 'number' },
      },
      required: ['trackId', 'plugins'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<FxChainPastePayload> => {
      const host = resolveChainHost(estado, payload.trackId)
      const chain = [...host.plugins]
      const copies = payload.plugins.map((p) => ({
        ...structuredClone(p),
        id: generarId(),
      }))
      const pos =
        payload.position === undefined
          ? chain.length
          : Math.max(0, Math.min(payload.position, chain.length))
      chain.splice(pos, 0, ...copies)
      const newIds = copies.map((c) => c.id)
      return {
        state: { ...estado, project: applyChain(estado, payload.trackId, chain) },
        events: [
          {
            nombre: EventosTrack.actualizada,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: { trackId: payload.trackId, fxChainPasted: newIds },
          },
        ],
        result: { ...payload, newIds } as FxChainPastePayload,
        inversePayload: {
          trackId: payload.trackId,
          removeIds: newIds,
        },
      }
    },
  }
}

/** Undo interno de paste: quita ids insertados */
export function crearComandoFxChainPasteUndo(): CommandDefinition<{
  trackId: string
  removeIds: string[]
}> {
  return {
    type: 'fxChain.pasteUndo',
    description: 'Deshace paste de FX Chain',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        removeIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['trackId', 'removeIds'],
      additionalProperties: false,
    },
    handler: (estado, payload) => {
      const host = resolveChainHost(estado, payload.trackId)
      const chain = host.plugins.filter((p) => !payload.removeIds.includes(p.id))
      return {
        state: { ...estado, project: applyChain(estado, payload.trackId, chain) },
        events: [],
        result: payload,
      }
    },
  }
}

export function crearComandoFxChainLoadPreset(): CommandDefinition<FxChainPresetPayload> {
  return {
    type: 'fxChain.loadPreset',
    inverseType: 'fxChain.loadPreset',
    description: 'Carga un preset de cadena (reemplaza plugins; missing → estado pendiente)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        presetId: { type: 'string' },
        nombre: { type: 'string' },
        plugins: { type: 'array' },
      },
      required: ['trackId', 'presetId', 'nombre', 'plugins'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<FxChainPresetPayload> => {
      const host = resolveChainHost(estado, payload.trackId)
      const prev = host.plugins.map((p) => structuredClone(p))
      const next = payload.plugins.map((p) => {
        const estado: PluginInfo['estado'] =
          p.estado === 'error' || p.estado === 'pendiente' || p.estado === 'cargado'
            ? p.estado
            : 'pendiente'
        return {
          ...structuredClone(p),
          id: p.id || generarId(),
          estado,
        }
      })
      return {
        state: { ...estado, project: applyChain(estado, payload.trackId, next) },
        events: [
          {
            nombre: EventosPlugin.presetCargado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: {
              trackId: payload.trackId,
              presetId: payload.presetId,
              nombre: payload.nombre,
            },
          },
        ],
        result: payload,
        inversePayload: {
          trackId: payload.trackId,
          presetId: payload.presetId + ':undo',
          nombre: 'undo',
          plugins: prev,
        },
      }
    },
  }
}

export function crearComandoFxChainSavePreset(): CommandDefinition<FxChainCopyPayload & { presetId: string; nombre: string }> {
  return {
    type: 'fxChain.savePreset',
    description: 'Serializa la FX Chain actual como preset (resultado; persistencia UI/local)',
    risk: 'read',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        presetId: { type: 'string' },
        nombre: { type: 'string' },
      },
      required: ['trackId', 'presetId', 'nombre'],
      additionalProperties: false,
    },
    handler: (estado, payload) => {
      const host = resolveChainHost(estado, payload.trackId)
      const plugins = host.plugins.map((p) => structuredClone(p))
      return {
        state: estado,
        events: [
          {
            nombre: EventosPlugin.presetGuardado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'plugin-commands',
            payload: {
              trackId: payload.trackId,
              presetId: payload.presetId,
              nombre: payload.nombre,
              pluginCount: plugins.length,
            },
          },
        ],
        result: { ...payload, plugins },
      }
    },
  }
}

/** Binding de automatización: parametro = `plugin:{instanceId}:{parameterId}` */
export function automationParamKey(pluginInstanceId: string, parameterId: string): string {
  return `plugin:${pluginInstanceId}:${parameterId}`
}

export function parseAutomationParamKey(
  key: string,
): { pluginInstanceId: string; parameterId: string } | null {
  if (!key.startsWith('plugin:')) return null
  const rest = key.slice('plugin:'.length)
  const i = rest.indexOf(':')
  if (i <= 0) return null
  return { pluginInstanceId: rest.slice(0, i), parameterId: rest.slice(i + 1) }
}
