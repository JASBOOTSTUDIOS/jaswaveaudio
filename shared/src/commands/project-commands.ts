/**
 * Comandos de ciclo de vida del proyecto.
 *
 * Propósito:
 *   Cubrir las operaciones de dominio para crear, guardar, cargar y cerrar
 *   proyectos, alineadas con `docs/hoja-ruta/009-proyectos.md`.
 *
 * Importancia:
 *   - Centraliza la mutación del estado de proyecto en el Command System.
 *   - Garantiza eventos del dominio para UI, IA y audit log.
 *   - Usa helpers existentes de persistencia en `shared/src/project.ts`.
 *
 * Función:
 *   Expone definiciones de comandos de proyecto y las deja listas para
 *   registrarlas en el registry global.
 */

import type { CommandDefinition, StateTransition, ValidationResult } from '../types/command';
import type { DAWState } from '../types/state';
import type { ProjectState } from '../types/proyecto';
import type { FileService } from '../project/persistencia';
import { NombresEventos } from '../constants/nombres-eventos';
import { proyectoNuevo } from '../project/ciclo-vida';
import { crearValidadorConflictos } from '../state/validacion-conflictos';
import { guardarProyecto, cargarProyecto } from '../project/persistencia';

export type ProjectNewPayload = {
  nombre?: string;
};

export type ProjectSavePayload = {
  ruta?: string;
};

export type ProjectLoadPayload = {
  ruta: string;
};

export type ProjectClosePayload = {
  /** Descartar cambios y cerrar sin guardar. */
  forzar?: boolean;
  /** Solo limpiar el diálogo de confirmación. */
  cancelarDialogo?: boolean;
  /** Campos de resultado (no input). */
  requiereConfirmacion?: boolean;
  projectId?: string;
  cancelado?: boolean;
  cerrado?: boolean;
};

let fileServiceGlobal: FileService | undefined;

export function configurarFileService(fileService: FileService): void {
  fileServiceGlobal = fileService;
}

export function crearComandoProjectNew(): CommandDefinition<ProjectNewPayload> {
  return {
    type: 'project.new',
    description: 'Crea un nuevo proyecto con valores por defecto',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ProjectNewPayload): StateTransition<ProjectState> => {
      const nombre = (payload.nombre || '').trim();
      if (!nombre) {
        throw new Error('El nombre del proyecto no puede estar vacío');
      }

      const proyecto: ProjectState = proyectoNuevo(nombre);

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: NombresEventos.creado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'project-commands',
            payload: { projectId: proyecto.id, nombre },
          },
        ],
        result: proyecto,
      };
    },
  };
}

export function crearComandoProjectSave(): CommandDefinition<ProjectSavePayload> {
  return {
    type: 'project.save',
    description: 'Guarda el proyecto actual en disco',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        ruta: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (estado: DAWState, payload: ProjectSavePayload) => {
      if (!estado.project) {
        throw new Error('No hay proyecto abierto para guardar');
      }

      const ruta = payload.ruta || estado.project.ruta;
      if (!ruta) {
        throw new Error('Debe indicar una ruta de guardado');
      }

      const fileService = fileServiceGlobal;
      if (!fileService) {
        throw new Error('FileService no configurado. Llama a configurarFileService() antes de ejecutar project.save');
      }

      const resultado: ValidationResult = crearValidadorConflictos().validate(estado, { type: 'project.save', payload } as any);
      if (!resultado.valid) {
        throw new Error(resultado.errors[0]?.message || 'Conflicto al guardar el proyecto');
      }

      await guardarProyecto(estado.project, ruta, fileService);

      const rutaGuardada = `${ruta.replace(/\.jaswave$/, '')}.jaswave`;

      return {
        state: estado,
        events: [
          {
             nombre: NombresEventos.guardado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'project-commands',
            payload: { projectId: estado.project.id, ruta: rutaGuardada },
          },
        ],
        result: { ruta: rutaGuardada },
      };
    },
  };
}

export function crearComandoProjectLoad(): CommandDefinition<ProjectLoadPayload> {
  return {
    type: 'project.load',
    description: 'Carga un proyecto desde disco',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        ruta: { type: 'string' },
      },
      required: ['ruta'],
      additionalProperties: false,
    },
    handler: async (estado: DAWState, payload: ProjectLoadPayload) => {
      const ruta = payload.ruta;
      if (!ruta || typeof ruta !== 'string') {
        throw new Error('Ruta inválida para cargar proyecto');
      }

      const fileService = fileServiceGlobal;
      if (!fileService) {
        throw new Error('FileService no configurado. Llama a configurarFileService() antes de ejecutar project.load');
      }

      const proyecto = await cargarProyecto(ruta, fileService);

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
             nombre: NombresEventos.cargado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'project-commands',
            payload: { projectId: proyecto.id, ruta },
          },
        ],
        result: { ruta },
      };
    },
  };
}

export function crearComandoProjectClose(): CommandDefinition<ProjectClosePayload> {
  return {
    type: 'project.close',
    description: 'Cierra el proyecto actual',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        forzar: { type: 'boolean' },
        cancelarDialogo: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ProjectClosePayload): StateTransition<ProjectClosePayload> => {
      if (payload.cancelarDialogo) {
        return {
          state: {
            ...estado,
            ui: { ...estado.ui, dialogoActivo: null, dialogoPayload: undefined },
          },
          events: [],
          result: { cancelado: true },
        };
      }

      const blankSelection = {
        ...estado.selection,
        idsPistas: [] as string[],
        idsClips: [] as string[],
        idsMarcadores: [] as string[],
        idPrincipal: null,
        tipoPrincipal: null,
      };

      const resetUi = {
        ...estado.ui,
        panelActivo: null,
        dialogoActivo: null,
        dialogoPayload: undefined,
        herramientaActiva: 'select' as const,
        modoEdicion: 'arrange' as const,
      };

      // Sin proyecto → dejar uno nuevo vacío (UI siempre tiene project)
      if (!estado.project) {
        const nuevo = proyectoNuevo('Sin título');
        return {
          state: {
            ...estado,
            project: nuevo,
            selection: blankSelection,
            ui: resetUi,
          },
          events: [
            {
              nombre: NombresEventos.cerrado,
              version: 1,
              marcaTiempo: Date.now(),
              fuente: 'project-commands',
              payload: {},
            },
          ],
          result: {},
        };
      }

      const proyecto = estado.project;

      if (proyecto.metadata?.readOnly && proyecto.modificado && !payload.forzar) {
        throw new Error('El proyecto es de solo lectura y tiene cambios sin guardar');
      }

      if (proyecto.modificado && !payload.forzar) {
        return {
          state: {
            ...estado,
            ui: {
              ...estado.ui,
              dialogoActivo: 'confirmar-cierre',
              dialogoPayload: { projectId: proyecto.id, modificado: true },
            },
          },
          events: [],
          result: { requiereConfirmacion: true, projectId: proyecto.id },
        };
      }

      const nuevo = proyectoNuevo('Sin título');
      return {
        state: {
          ...estado,
          project: nuevo,
          selection: blankSelection,
          ui: resetUi,
        },
        events: [
          {
            nombre: NombresEventos.cerrado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'project-commands',
            payload: { projectId: proyecto.id },
          },
        ],
        result: { cerrado: true, projectId: proyecto.id },
      };
    },
  };
}
