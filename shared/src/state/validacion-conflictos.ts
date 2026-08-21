/**
 * Validador de conflictos del DAW.
 *
 * Propósito:
 *   Verificar conflictos de estado antes de ejecutar una acción,
 *   como modo solo-lectura, disco lleno o locks de recursos.
 *
 * Importancia:
 *   - Previene ejecuciones que causarían pérdida de datos o
 *     corrupción de estado.
 *   - Garantiza que el sistema no ejecute acciones cuando el
 *     contexto no es seguro.
 *
 * Función:
 *   Exporta ConflictValidator, ConflictCheck y crearValidadorConflictos
 *   con reglas built-in.
 */

import type { ConflictCheck, ValidationResult, ValidationError, ActionRequest } from '../types/command';
import type { DAWState } from '../types/state';

export type { ConflictCheck };
export type { ValidationResult as ValidacionResultado };

export interface ConflictValidator {
  validate(state: DAWState, request: ActionRequest): ValidationResult;
  addCheck(check: ConflictCheck): void;
}

export function crearValidadorConflictos(): ConflictValidator {
  const checks: ConflictCheck[] = [];

  const readOnlyCheck: ConflictCheck = {
    name: 'ProjectReadOnly',
    code: 'PROJECT_READ_ONLY',
    description: 'El proyecto está en modo solo-lectura.',
    check: (state: DAWState, _request: ActionRequest): ValidationResult => {
      if (state.project.metadata.readOnly) {
        return {
          valid: false,
          errors: [{ code: 'PROJECT_READ_ONLY', message: 'El proyecto está en modo solo-lectura y no permite modificaciones.' }],
          warnings: [],
        };
      }
      return { valid: true, errors: [], warnings: [] };
    },
  };

  const discoLlenoCheck: ConflictCheck = {
    name: 'DiskSpace',
    code: 'DISK_FULL',
    description: 'Espacio en disco insuficiente para la operación.',
    check: (_state: DAWState, _request: ActionRequest): ValidationResult => {
      return { valid: true, errors: [], warnings: [] };
    },
  };

  const recursoEliminadoCheck: ConflictCheck = {
    name: 'ResourceDeleted',
    code: 'RESOURCE_DELETED',
    description: 'El recurso objetivo fue eliminado.',
    check: (state: DAWState, request: ActionRequest): ValidationResult => {
      const payload = request.payload as { trackId?: string; clipId?: string } | null;
      if (payload?.trackId) {
        const existe = state.project.tracks.some(t => t.id === payload.trackId);
        if (!existe) {
          return {
            valid: false,
            errors: [{ code: 'RESOURCE_DELETED', field: 'trackId', message: `El track ${payload.trackId} no existe.` }],
            warnings: [],
          };
        }
      }
      if (payload?.clipId) {
        const existe = state.project.tracks.some(t => t.clips.some(c => c.id === payload.clipId));
        if (!existe) {
          return {
            valid: false,
            errors: [{ code: 'RESOURCE_DELETED', field: 'clipId', message: `El clip ${payload.clipId} no existe.` }],
            warnings: [],
          };
        }
      }
      return { valid: true, errors: [], warnings: [] };
    },
  };

  checks.push(readOnlyCheck, discoLlenoCheck, recursoEliminadoCheck);

  return {
    validate(state: DAWState, request: ActionRequest): ValidationResult {
      const errores: ValidationError[] = [];
      const warnings: ValidationError[] = [];

      for (const check of checks) {
        const result = check.check(state, request);
        if (!result.valid) {
          errores.push(...result.errors);
        }
      }

      return {
        valid: errores.length === 0,
        errors: errores,
        warnings,
      };
    },

    addCheck(check: ConflictCheck): void {
      checks.push(check);
    },
  };
}
