import type { CommandDefinition, StateTransition } from '../types/command';
import type { DAWState } from '../types/state';
import type { AccionAtajo, AtajoPersistido } from '../config/atajos';
import { ACCIONES_ATAJO } from '../config/atajos';

export type AtajoListarPayload = AccionAtajo[];
export type AtajoActualizarPayload = { accionId: string; combinacion: string };
export type AtajoRestaurarPayload = Record<string, string>;
export type AtajoEjecutarPayload = { accionId: string; comando: string };

export function crearComandoAtajoListar(): CommandDefinition<AtajoListarPayload> {
  return {
    type: 'atajos.listar',
    description: 'Lista todos los atajos disponibles y sus combinaciones actuales',
    risk: 'read',
    schema: {
      type: 'object',
      additionalProperties: false,
    },
    handler: (_estado: DAWState, _payload: AtajoListarPayload): StateTransition<AtajoListarPayload> => {
      return {
        state: _estado,
        events: [],
        result: ACCIONES_ATAJO,
      };
    },
  };
}

export function crearComandoAtajoActualizar(): CommandDefinition<AtajoActualizarPayload> {
  return {
    type: 'atajos.actualizar',
    description: 'Actualiza la combinación de una acción de atajo',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        accionId: { type: 'string' },
        combinacion: { type: 'string' },
      },
      required: ['accionId', 'combinacion'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: AtajoActualizarPayload): StateTransition<AtajoActualizarPayload> => {
      const accion = ACCIONES_ATAJO.find(a => a.id === payload.accionId);
      if (!accion) {
        throw new Error(`Acción de atajo no encontrada: ${payload.accionId}`);
      }

      const combinacionNormalizada = payload.combinacion.trim();
      if (!combinacionNormalizada) {
        throw new Error('La combinación de atajo no puede estar vacía');
      }

      const duplicado = Object.entries(estado.atajos.mapa).find(
        ([id, combo]) => id !== payload.accionId && combo.toLowerCase() === combinacionNormalizada.toLowerCase()
      );
      if (duplicado) {
        throw new Error(`La combinación ${combinacionNormalizada} ya está asignada a ${duplicado[0]}`);
      }

      const nuevoMapa = { ...estado.atajos.mapa, [payload.accionId]: combinacionNormalizada };

      return {
        state: {
          ...estado,
          atajos: {
            ...estado.atajos,
            mapa: nuevoMapa,
          },
        },
        events: [],
        result: { accionId: payload.accionId, combinacion: combinacionNormalizada },
      };
    },
  };
}

export function crearComandoAtajoRestaurar(): CommandDefinition<AtajoRestaurarPayload> {
  return {
    type: 'atajos.restaurar',
    description: 'Restaura todos los atajos a sus valores por defecto',
    risk: 'write',
    schema: {
      type: 'object',
      additionalProperties: false,
    },
    handler: (_estado: DAWState, _payload: AtajoRestaurarPayload): StateTransition<AtajoRestaurarPayload> => {
      return {
        state: {
          ..._estado,
          atajos: {
            mapa: { ..._estado.atajos.porDefecto },
            porDefecto: { ..._estado.atajos.porDefecto },
          },
        },
        events: [],
        result: { ..._estado.atajos.porDefecto },
      };
    },
  };
}

export function crearComandoAtajoRestaurarUno(): CommandDefinition<AtajoActualizarPayload> {
  return {
    type: 'atajos.restaurarUno',
    description: 'Restaura un atajo individual a su valor por defecto',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        accionId: { type: 'string' },
      },
      required: ['accionId'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: AtajoActualizarPayload): StateTransition<AtajoActualizarPayload> => {
      const accion = ACCIONES_ATAJO.find(a => a.id === payload.accionId);
      if (!accion) {
        throw new Error(`Acción de atajo no encontrada: ${payload.accionId}`);
      }

      const porDefecto = accion.comandoPorDefecto;

      return {
        state: {
          ...estado,
          atajos: {
            ...estado.atajos,
            mapa: {
              ...estado.atajos.mapa,
              [payload.accionId]: porDefecto,
            },
          },
        },
        events: [],
        result: { accionId: payload.accionId, combinacion: porDefecto },
      };
    },
  };
}

export function crearComandoAtajoEjecutar(): CommandDefinition<AtajoEjecutarPayload> {
  return {
    type: 'atajos.ejecutar',
    description: 'Ejecuta la acción asociada a un id de atajo (usado por botones y teclado)',
    risk: 'read',
    schema: {
      type: 'object',
      properties: {
        accionId: { type: 'string' },
      },
      required: ['accionId'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: AtajoEjecutarPayload): StateTransition<AtajoEjecutarPayload> => {
      const accion = ACCIONES_ATAJO.find(a => a.id === payload.accionId);
      if (!accion) {
        throw new Error(`Acción de atajo no encontrada: ${payload.accionId}`);
      }

      const comando = estado.atajos.mapa[payload.accionId] || accion.comandoPorDefecto;

      return {
        state: estado,
        events: [],
        result: { accionId: payload.accionId, comando },
      };
    },
  };
}
