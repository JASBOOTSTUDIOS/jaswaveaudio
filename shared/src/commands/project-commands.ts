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
import type { EventoDominio } from '../events/evento-dominio';
import { NombresEventos, EventosProyecto } from '../constants/nombres-eventos';
import { proyectoNuevo, nombreAlGuardar } from '../project/ciclo-vida';
import type { AudioReference } from '../project/ciclo-vida';
import { crearValidadorConflictos } from '../state/validacion-conflictos';
import { guardarProyecto, cargarProyectoConRespaldo, rutaRespaldo } from '../project/persistencia';
import { entorno } from '../state/entorno-determinista';

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
    limpiaHistorialUndo: true,
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
            marcaTiempo: entorno.ahora(),
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

      const rutaGuardada = `${ruta.replace(/\.jaswave$/i, '')}.jaswave`;
      const nombre = nombreAlGuardar(estado.project.nombre, rutaGuardada);
      const proyecto: ProjectState = {
        ...estado.project,
        ruta: rutaGuardada,
        nombre,
        modificado: false,
        fechaModificacion: entorno.ahora(),
      };

      await guardarProyecto(proyecto, rutaGuardada, fileService);

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
             nombre: NombresEventos.guardado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'project-commands',
            payload: { projectId: proyecto.id, ruta: rutaGuardada },
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
    limpiaHistorialUndo: true,
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

      // Si el archivo está dañado y existe `${ruta}.bak`, se recupera la copia.
      let notasMidiDescartadas = 0;
      const mediaFaltante: AudioReference[] = [];
      const { proyecto, usadoRespaldo, errorOriginal } = await cargarProyectoConRespaldo(ruta, fileService, {
        onNotasMidiDescartadas: (cantidad) => {
          notasMidiDescartadas += cantidad;
        },
        onMediaFaltante: (faltantes) => {
          mediaFaltante.push(...faltantes);
        },
      });
      const proyectoConRuta: ProjectState = {
        ...proyecto,
        ruta,
        // Recuperado de respaldo: hay que volver a guardar para reparar el archivo principal.
        modificado: usadoRespaldo,
      };

      const marcaTiempo = entorno.ahora();
      const events: EventoDominio[] = [
        {
          nombre: NombresEventos.cargado,
          version: 1,
          marcaTiempo,
          fuente: 'project-commands',
          payload: { projectId: proyecto.id, ruta },
        },
      ];
      if (usadoRespaldo) {
        events.push({
          nombre: EventosProyecto.recuperadoDeRespaldo,
          version: 1,
          marcaTiempo,
          fuente: 'project-commands',
          payload: {
            projectId: proyecto.id,
            ruta,
            rutaRespaldo: rutaRespaldo(ruta),
            motivo: errorOriginal ?? '',
            mensaje: `El archivo del proyecto estaba dañado; se cargó la copia de seguridad (${rutaRespaldo(ruta)}). Guarda el proyecto para repararlo.`,
          },
        });
      }
      if (notasMidiDescartadas > 0) {
        events.push({
          nombre: 'validacion.advertencia',
          version: 1,
          marcaTiempo,
          fuente: 'project-commands',
          payload: {
            code: 'MIDI_NOTES_REPAIRED',
            message: `Se descartaron ${notasMidiDescartadas} nota(s) MIDI inválidas al abrir el proyecto`,
          },
        });
      }
      if (mediaFaltante.length > 0) {
        events.push({
          nombre: 'validacion.advertencia',
          version: 1,
          marcaTiempo,
          fuente: 'project-commands',
          payload: {
            code: 'MEDIA_FALTANTE',
            message: `Faltan ${mediaFaltante.length} archivo(s) de media del proyecto`,
            referencias: mediaFaltante.map((r) => ({
              id: r.id,
              rutaRelativa: r.rutaRelativa,
              formato: r.formato,
            })),
          },
        });
      }

      return {
        state: { ...estado, project: proyectoConRuta },
        events,
        result: { ruta, usadoRespaldo, mediaFaltante },
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
              marcaTiempo: entorno.ahora(),
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
            marcaTiempo: entorno.ahora(),
            fuente: 'project-commands',
            payload: { projectId: proyecto.id },
          },
        ],
        result: { cerrado: true, projectId: proyecto.id },
      };
    },
  };
}
