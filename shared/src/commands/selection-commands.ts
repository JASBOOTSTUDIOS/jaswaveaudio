/**
 * Comandos de selección (sin undo: cambios de contexto, no de proyecto).
 */

import type { CommandDefinition, StateTransition } from '../types/command';
import type { DAWState } from '../types/state';
import type { EstadoSeleccion } from '../types/seleccion';

export type SelectionSetPayload = {
  ids?: string[];
  idsClips?: string[];
  idsPistas?: string[];
  tipo?: 'track' | 'clip' | 'pista';
  idPrincipal?: string | null;
  /** Si true, reemplaza solo el campo indicado y limpia el resto de ids principales. */
  limpiar?: boolean;
};

export type SelectionClearPayload = {
  alcance?: 'todo' | 'clips' | 'pistas';
};

function baseSeleccion(prev: EstadoSeleccion): EstadoSeleccion {
  return {
    ...prev,
    seleccionAnterior: {
      ...prev,
      seleccionAnterior: null,
    },
    ultimaSeleccion: null,
  };
}

export function crearComandoSelectionSet(): CommandDefinition<SelectionSetPayload> {
  return {
    type: 'selection.set',
    description: 'Establece la selección activa (pistas/clips)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
        idsClips: { type: 'array', items: { type: 'string' } },
        idsPistas: { type: 'array', items: { type: 'string' } },
        tipo: { type: 'string', enum: ['track', 'clip', 'pista'] },
        idPrincipal: { type: ['string', 'null'] },
        limpiar: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: SelectionSetPayload): StateTransition<SelectionSetPayload> => {
      const tipo = payload.tipo === 'track' || payload.tipo === 'pista' ? 'pista' : payload.tipo === 'clip' ? 'clip' : null;
      const ids = payload.ids ?? [];
      const idsClips = payload.idsClips ?? (tipo === 'clip' ? ids : estado.selection.idsClips);
      const idsPistas = payload.idsPistas ?? (tipo === 'pista' ? ids : estado.selection.idsPistas);
      const idPrincipal =
        payload.idPrincipal !== undefined
          ? payload.idPrincipal
          : ids[0] ?? idsClips[0] ?? idsPistas[0] ?? null;

      const selection: EstadoSeleccion = {
        ...baseSeleccion(estado.selection),
        idsClips: payload.limpiar && tipo === 'pista' ? [] : idsClips,
        idsPistas: payload.limpiar && tipo === 'clip' ? [] : idsPistas,
        idPrincipal,
        tipoPrincipal: tipo ?? (idsClips.length ? 'clip' : idsPistas.length ? 'pista' : null),
        ultimaSeleccion: idPrincipal
          ? {
              tipo: tipo ?? 'clip',
              id: idPrincipal,
              marcaTiempo: Date.now(),
              metodo: 'comando',
            }
          : null,
        modoSeleccion: 'reemplazar',
      };

      return {
        state: { ...estado, selection },
        events: [
          {
            nombre: 'ui.seleccionCambiada',
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'selection-commands',
            payload: {
              idsClips: selection.idsClips,
              idsPistas: selection.idsPistas,
              idPrincipal: selection.idPrincipal,
            },
          },
        ],
        result: payload,
      };
    },
  };
}

export function crearComandoSelectionClear(): CommandDefinition<SelectionClearPayload> {
  return {
    type: 'selection.clear',
    description: 'Limpia la selección activa',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        alcance: { type: 'string', enum: ['todo', 'clips', 'pistas'] },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: SelectionClearPayload = {}): StateTransition<SelectionClearPayload> => {
      const alcance = payload.alcance ?? 'todo';
      const selection: EstadoSeleccion = {
        ...baseSeleccion(estado.selection),
        idsClips: alcance === 'pistas' ? estado.selection.idsClips : [],
        idsPistas: alcance === 'clips' ? estado.selection.idsPistas : [],
        idPrincipal: null,
        tipoPrincipal: null,
        ultimaSeleccion: null,
        modoSeleccion: 'reemplazar',
      };

      return {
        state: { ...estado, selection },
        events: [
          {
            nombre: 'ui.seleccionCambiada',
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'selection-commands',
            payload: { limpia: true, alcance },
          },
        ],
        result: payload,
      };
    },
  };
}

export type UiSetPalettePayload = {
  abierta: boolean;
};

export function crearComandoUiSetPalette(): CommandDefinition<UiSetPalettePayload> {
  return {
    type: 'ui.setPalette',
    description: 'Abre o cierra la paleta de comandos',
    risk: 'read',
    schema: {
      type: 'object',
      properties: {
        abierta: { type: 'boolean' },
      },
      required: ['abierta'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: UiSetPalettePayload): StateTransition<UiSetPalettePayload> => {
      return {
        state: {
          ...estado,
          ui: {
            ...estado.ui,
            paletaComandosAbierta: payload.abierta,
            estadoPaletaComandos: {
              ...(estado.ui.estadoPaletaComandos ?? {
                abierta: false,
                filtro: '',
                indiceSeleccionado: 0,
                comandosFiltrados: [],
              }),
              abierta: payload.abierta,
            },
          },
        },
        events: [
          {
            nombre: payload.abierta ? 'ui.dialogoAbierto' : 'ui.dialogoCerrado',
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'selection-commands',
            payload: { dialogo: 'command-palette' },
          },
        ],
        result: payload,
      };
    },
  };
}
