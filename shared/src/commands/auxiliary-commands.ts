/**
 * Comandos auxiliares: master channel, UI, timeline y proyecto.
 *
 * Propósito:
 *   Completar las mutaciones que la UI realiza directamente via
 *   establecerEstado() para que pasen por el Command System con
 *   validación, audit log, eventos y undo/redo.
 */

import type { CommandDefinition, StateTransition } from '../types/command';
import type { DAWState } from '../types/state';
import type { ProjectState } from '../types/proyecto';
import type { HerramientaActiva, IdPanel } from '../types/ui';
import { NombresEventos, EventosUIExt, EventosProyecto } from '../constants/nombres-eventos';

// ── master.update ──────────────────────────────────────────────

export type MasterUpdatePayload = {
  datos: Partial<{
    volumen: number;
    paneo: number;
    muted: boolean;
    solo: boolean;
  }>;
};

export function crearComandoMasterUpdate(): CommandDefinition<MasterUpdatePayload> {
  return {
    type: 'master.update',
    description: 'Actualiza propiedades del canal master (volumen, paneo, mute, solo)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        datos: { type: 'object' },
      },
      required: ['datos'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: MasterUpdatePayload): StateTransition<MasterUpdatePayload> => {
      const masterActual = estado.project.master;
      const masterActualizado = { ...masterActual, ...payload.datos };

      const proyecto: ProjectState = {
        ...estado.project,
        master: masterActualizado,
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosProyecto.modificado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'auxiliary-commands',
            payload: { canal: 'master' },
          },
        ],
        result: payload,
      };
    },
  };
}

// ── project.setTimeSignature ───────────────────────────────────

export type SetTimeSignaturePayload = {
  numerador: number;
  denominador: number;
};

export function crearComandoSetTimeSignature(): CommandDefinition<SetTimeSignaturePayload> {
  return {
    type: 'project.setTimeSignature',
    description: 'Establece la firma de tiempo del proyecto',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        numerador: { type: 'number', minimum: 1, maximum: 32 },
        denominador: { type: 'number', minimum: 1, maximum: 32 },
      },
      required: ['numerador', 'denominador'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: SetTimeSignaturePayload): StateTransition<SetTimeSignaturePayload> => {
      const proyecto: ProjectState = {
        ...estado.project,
        timeSignature: {
          ...estado.project.timeSignature,
          numerador: payload.numerador,
          denominador: payload.denominador,
          nombre: `${payload.numerador}/${payload.denominador}`,
        },
        modificado: true,
        fechaModificacion: Date.now(),
      };

      // Alinear metrónomo con el compás del proyecto (estilo Reaper)
      const transport = {
        ...estado.transport,
        metronomo: {
          ...estado.transport.metronomo,
          compas: payload.numerador,
        },
      };

      return {
        state: { ...estado, project: proyecto, transport },
        events: [
          {
            nombre: EventosProyecto.modificado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'auxiliary-commands',
            payload: { timeSignature: payload },
          },
        ],
        result: payload,
      };
    },
  };
}

// ── ui.setTool ────────────────────────────────────────────────

export type SetToolPayload = {
  herramienta: HerramientaActiva;
};

export function crearComandoSetTool(): CommandDefinition<SetToolPayload> {
  return {
    type: 'ui.setTool',
    description: 'Cambia la herramienta activa del editor',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        herramienta: { type: 'string' },
      },
      required: ['herramienta'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: SetToolPayload): StateTransition<SetToolPayload> => {
      const ui = estado.ui ?? {} as any;
      const nuevoUI = { ...ui, herramientaActiva: payload.herramienta };

      return {
        state: { ...estado, ui: nuevoUI },
        events: [
          {
            nombre: EventosUIExt.focoCambiado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'auxiliary-commands',
            payload: { herramienta: payload.herramienta },
          },
        ],
        result: payload,
      };
    },
  };
}

// ── ui.togglePanel ─────────────────────────────────────────────

export type TogglePanelPayload = {
  panel: string;
};

export function crearComandoTogglePanel(): CommandDefinition<TogglePanelPayload> {
  return {
    type: 'ui.togglePanel',
    description: 'Alterna la visibilidad de un panel de UI',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        panel: { type: 'string' },
      },
      required: ['panel'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: TogglePanelPayload): StateTransition<TogglePanelPayload> => {
      const ui = estado.ui ?? {} as any;
      const panelActivo = ui.panelActivo === payload.panel ? null : payload.panel as IdPanel;
      const nuevoUI = { ...ui, panelActivo };

      return {
        state: { ...estado, ui: nuevoUI },
        events: [
          {
            nombre: EventosUIExt.focoCambiado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'auxiliary-commands',
            payload: { panel: panelActivo },
          },
        ],
        result: payload,
      };
    },
  };
}

// ── timeline.setSnap ───────────────────────────────────────────

export type SetSnapPayload = {
  snap: boolean;
  snapValor?: number;
};

export function crearComandoSetSnap(): CommandDefinition<SetSnapPayload> {
  return {
    type: 'timeline.setSnap',
    description: 'Configura el snap de la línea de tiempo',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        snap: { type: 'boolean' },
        snapValor: { type: 'number' },
      },
      required: ['snap'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: SetSnapPayload): StateTransition<SetSnapPayload> => {
      const timeline = estado.project.timeline ?? {} as any;
      const nuevoTimeline = {
        ...timeline,
        snap: payload.snap,
        ...(payload.snapValor !== undefined ? { snapValor: payload.snapValor } : {}),
      };

      const proyecto: ProjectState = {
        ...estado.project,
        timeline: nuevoTimeline,
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: NombresEventos.modificado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'auxiliary-commands',
            payload: { snap: payload.snap },
          },
        ],
        result: payload,
      };
    },
  };
}

// ── ui.setZoom ─────────────────────────────────────────────────

export type SetZoomPayload = {
  horizontal?: number;
  vertical?: number;
  scrollX?: number;
};

export function crearComandoSetZoom(): CommandDefinition<SetZoomPayload> {
  return {
    type: 'ui.setZoom',
    description: 'Ajusta el zoom de la línea de tiempo',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        horizontal: { type: 'number' },
        vertical: { type: 'number' },
        scrollX: { type: 'number' },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: SetZoomPayload): StateTransition<SetZoomPayload> => {
      const ui = estado.ui ?? {} as any;
      const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
      const nuevoUI = {
        ...ui,
        ...(payload.horizontal !== undefined ? { zoomHorizontal: clamp(payload.horizontal, 0.15, 256) } : {}),
        ...(payload.vertical !== undefined ? { zoomVertical: clamp(payload.vertical, 0.5, 3) } : {}),
        ...(payload.scrollX !== undefined ? { scrollX: Math.max(0, payload.scrollX) } : {}),
      };

      return {
        state: { ...estado, ui: nuevoUI },
        events: [],
        result: payload,
      };
    },
  };
}

// ── marker.create ──────────────────────────────────────────────

export type MarkerCreatePayload = {
  nombre?: string;
  tiempo: number;
  color?: string;
};

export function crearComandoMarkerCreate(): CommandDefinition<MarkerCreatePayload> {
  return {
    type: 'marker.create',
    description: 'Crea un marcador en la línea de tiempo',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        tiempo: { type: 'number' },
        color: { type: 'string' },
      },
      required: ['tiempo'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: MarkerCreatePayload): StateTransition<MarkerCreatePayload> => {
      const marcador = {
        id: crypto.randomUUID(),
        nombre: payload.nombre?.trim() || `Marcador ${(estado.project.marcadores?.length ?? 0) + 1}`,
        tiempo: payload.tiempo,
        color: payload.color ?? '#f59e0b',
        seleccionado: false,
        tipo: 'marcador' as const,
      };
      const proyecto: ProjectState = {
        ...estado.project,
        marcadores: [...(estado.project.marcadores ?? []), marcador],
      };
      return {
        state: { ...estado, project: proyecto },
        events: [{
          nombre: 'marcador.creado',
          version: 1,
          marcaTiempo: Date.now(),
          fuente: 'auxiliary-commands',
          payload: { id: marcador.id, tiempo: marcador.tiempo },
        }],
        result: payload,
      };
    },
  };
}

// ── project.update ─────────────────────────────────────────────

export type ProjectUpdatePayload = {
  datos: Partial<{
    nombre: string;
    ruta: string;
    sampleRate: number;
    bitDepth: number;
    bpm: { valor: number; tipo: string };
    timeSignature: { numerador: number; denominador: number };
    configuracion: Partial<import('../types/proyecto').ConfiguracionProyecto>;
  }>;
};

export function crearComandoProjectUpdate(): CommandDefinition<ProjectUpdatePayload> {
  return {
    type: 'project.update',
    description: 'Actualiza propiedades del proyecto (nombre, BPM, time signature, configuración)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        datos: { type: 'object' },
      },
      required: ['datos'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ProjectUpdatePayload): StateTransition<ProjectUpdatePayload> => {
      const { datos } = payload;
      const proyecto: ProjectState = {
        ...estado.project,
        ...(datos.nombre !== undefined ? { nombre: datos.nombre } : {}),
        ...(datos.ruta !== undefined ? { ruta: datos.ruta } : {}),
        ...(datos.sampleRate !== undefined ? { sampleRate: datos.sampleRate } : {}),
        ...(datos.bitDepth !== undefined ? { bitDepth: datos.bitDepth } : {}),
        ...(datos.bpm !== undefined ? { bpm: { ...estado.project.bpm, ...datos.bpm } } : {}),
        ...(datos.timeSignature !== undefined ? {
          timeSignature: {
            ...estado.project.timeSignature,
            ...datos.timeSignature,
            nombre: `${datos.timeSignature.numerador}/${datos.timeSignature.denominador}`,
          },
        } : {}),
        ...(datos.configuracion !== undefined ? {
          configuracion: { ...estado.project.configuracion, ...datos.configuracion },
        } : {}),
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosProyecto.modificado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'auxiliary-commands',
            payload: { campos: Object.keys(datos) },
          },
        ],
        result: payload,
      };
    },
  };
}
