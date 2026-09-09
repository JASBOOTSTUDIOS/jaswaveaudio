/**
 * Pipeline de validación del DAW.
 *
 * Propósito:
 *   Orquestar todos los pasos de validación que una acción debe
 *   atravesar antes de ejecutarse: schema, auth, permisos, dominio,
 *   conflictos y validación específica de IA.
 *
 * Importancia:
 *   - Es la única puerta de entrada para autorizar mutaciones.
 *   - Garantiza que ninguna acción inválida llegue al CommandExecutor.
 *   - Soporta dry-run para previsualización sin efectos secundarios.
 *
 * Función:
 *   Exporta ValidatorPipeline, ValidationStep, crearPipelineValidacion
 *   con implementación concreta que combina todos los validadores.
 */

import type { ActionRequest, ValidationResult, DryRunResult, ToolDefinition, ValidatorPipeline, PermissionValidator, ValidationError } from '../types/command';
import type { DAWState } from '../types/state';
import type { EventoDominio } from '../events/evento-dominio';
import type { PermissionValidator as IPermissionValidator } from '../state/validacion-acceso';
import type { ReglasDominio } from '../state/validacion-dominio';
import type { ConflictValidator } from '../state/validacion-conflictos';
import type { AIValidator } from '../state/validacion-ia';
import { registroComandos as globalRegistroComandos } from './registro-comandos';
import type { CommandRegistry } from './registro-comandos';

export interface ValidationStep {
  name: string;
  execute(request: ActionRequest, state: DAWState): ValidationResult;
}

function esPrimitivo(valor: unknown): boolean {
  return valor === null || valor === undefined || typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean';
}

function calcularDiff(anterior: unknown, despues: unknown, prefijo = ''): Record<string, { before: unknown; after: unknown }> {
  if (anterior === despues) return {};
  if (esPrimitivo(anterior) || esPrimitivo(despues)) {
    return { [prefijo || 'valor']: { before: anterior, after: despues } };
  }

  const resultado: Record<string, { before: unknown; after: unknown }> = {};
  const mapaAnterior = (anterior as Record<string, unknown>) ?? {};
  const mapaDespues = (despues as Record<string, unknown>) ?? {};
  const claves = new Set([...Object.keys(mapaAnterior), ...Object.keys(mapaDespues)]);

  for (const clave of claves) {
    const subPrefijo = prefijo ? `${prefijo}.${clave}` : clave;
    const subAnterior = mapaAnterior[clave];
    const subDespues = mapaDespues[clave];

    if (Array.isArray(subAnterior) || Array.isArray(subDespues)) {
      const anteriorArr = Array.isArray(subAnterior) ? subAnterior : [];
      const despuesArr = Array.isArray(subDespues) ? subDespues : [];
      if (anteriorArr.length !== despuesArr.length || !anteriorArr.every((v, i) => v === despuesArr[i])) {
        resultado[subPrefijo] = { before: subAnterior, after: subDespues };
      }
      continue;
    }

    if (typeof subAnterior === 'object' && subAnterior !== null || typeof subDespues === 'object' && subDespues !== null) {
      const subDiff = calcularDiff(subAnterior, subDespues, subPrefijo);
      Object.assign(resultado, subDiff);
      continue;
    }

    if (subAnterior !== subDespues) {
      resultado[subPrefijo] = { before: subAnterior, after: subDespues };
    }
  }

  return resultado;
}

export function crearPipelineValidacion(opciones?: {
  permissionValidator?: PermissionValidator;
  reglasDominio?: ReglasDominio;
  conflictValidator?: ConflictValidator;
  aiValidator?: AIValidator;
  registroComandos?: CommandRegistry;
}): ValidatorPipeline {
  const registry = opciones?.registroComandos ?? globalRegistroComandos;
  const permissionValidator = opciones?.permissionValidator ?? {
    check: (_tool: ToolDefinition, _userLevel: 'admin' | 'engineer' | 'user' | 'guest' | 'ai') => ({
      allowed: true,
      requiresConfirmation: false,
    }),
  };

  const reglasDominio = opciones?.reglasDominio ?? {
    validar: (_estado: DAWState, _payload: unknown, _tipoComando?: string): ValidationResult => ({
      valid: true,
      errors: [],
      warnings: [],
    }),
    registrar: () => {},
  };

  const conflictValidator = opciones?.conflictValidator ?? {
    validate: (_state: DAWState, _request: ActionRequest): ValidationResult => ({
      valid: true,
      errors: [],
      warnings: [],
    }),
    addCheck: () => {},
  };

  const aiValidator = opciones?.aiValidator ?? {
    validate: (_request: ActionRequest, _context: Record<string, unknown>): ValidationResult => ({
      valid: true,
      errors: [],
      warnings: [],
    }),
    addCheck: () => {},
  };

  const steps: ValidationStep[] = [
    {
      name: 'schema',
      execute: (request: ActionRequest, _state: DAWState): ValidationResult => {
        const definicion = registry.get(request.type);
        const schema = definicion?.schema;
        if (!schema) return { valid: true, errors: [], warnings: [] };

        const payload = (request.payload ?? {}) as Record<string, unknown>;
        const errors: ValidationError[] = [];

        if (schema.required && Array.isArray(schema.required)) {
          for (const field of schema.required as string[]) {
            if (payload[field] === undefined || payload[field] === null) {
              errors.push({ code: 'SCHEMA_MISSING_REQUIRED', message: `Campo requerido faltante: ${field}`, field });
            }
          }
        }

        if (schema.properties && typeof schema.properties === 'object') {
          const props = schema.properties as Record<string, Record<string, unknown>>;
          for (const [key, propSchema] of Object.entries(props)) {
            const value = payload[key];
            if (value === undefined || value === null) continue;
            if (propSchema.type === 'string' && typeof value !== 'string') {
              errors.push({ code: 'SCHEMA_TYPE_MISMATCH', message: `Campo '${key}' debe ser string, recibido ${typeof value}`, field: key });
            }
            if (propSchema.type === 'number' && typeof value !== 'number') {
              errors.push({ code: 'SCHEMA_TYPE_MISMATCH', message: `Campo '${key}' debe ser number, recibido ${typeof value}`, field: key });
            }
            if (propSchema.type === 'number' && typeof value === 'number') {
              if (!Number.isFinite(value)) {
                errors.push({
                  code: 'SCHEMA_TYPE_MISMATCH',
                  message: `Campo '${key}' debe ser un número finito`,
                  field: key,
                })
              } else {
                if (typeof propSchema.minimum === 'number' && value < propSchema.minimum) {
                  errors.push({
                    code: 'SCHEMA_OUT_OF_RANGE',
                    message: `Campo '${key}' debe ser ≥ ${propSchema.minimum}`,
                    field: key,
                  })
                }
                if (typeof propSchema.maximum === 'number' && value > propSchema.maximum) {
                  errors.push({
                    code: 'SCHEMA_OUT_OF_RANGE',
                    message: `Campo '${key}' debe ser ≤ ${propSchema.maximum}`,
                    field: key,
                  })
                }
              }
            }
            if (propSchema.type === 'boolean' && typeof value !== 'boolean') {
              errors.push({ code: 'SCHEMA_TYPE_MISMATCH', message: `Campo '${key}' debe ser boolean, recibido ${typeof value}`, field: key });
            }
          }
        }

        if (schema.additionalProperties === false && schema.properties) {
          const allowed = new Set(Object.keys(schema.properties as Record<string, unknown>));
          for (const key of Object.keys(payload)) {
            if (!allowed.has(key)) {
              errors.push({ code: 'SCHEMA_EXTRA_PROPERTY', message: `Propiedad no permitida: ${key}`, field: key });
            }
          }
        }

        return { valid: errors.length === 0, errors, warnings: [] };
      },
    },
    {
      name: 'auth',
      execute: (request: ActionRequest, _state: DAWState): ValidationResult => {
        // Sesión local de escritorio: el usuario implícito es "local".
        // Solo advertir si la fuente es remota/script sin identidad (auditoría multi-usuario).
        if (!request.userId && request.source === 'script') {
          return {
            valid: true,
            errors: [],
            warnings: [{
              code: 'AUTH_MISSING',
              message: 'Se requiere identificación de usuario para esta acción.',
              suggestion: 'Proveer userId en el request.',
            }],
          };
        }
        return { valid: true, errors: [], warnings: [] };
      },
    },
    {
      name: 'permission',
      execute: (request: ActionRequest, _state: DAWState): ValidationResult => {
        const tool: ToolDefinition = {
          type: request.type,
          category: 'system',
          description: '',
          risk: 'write',
        };
        const userLevel = (request.source === 'ai' ? 'ai' : 'user') as 'user' | 'ai' | 'admin' | 'engineer' | 'guest';
        const result = permissionValidator.check(tool, userLevel);
        if (!result.allowed) {
          return {
            valid: false,
            errors: [{ code: 'PERMISSION_DENIED', message: result.reason ?? 'Permiso insuficiente.' }],
            warnings: [],
          };
        }
        return { valid: true, errors: [], warnings: [] };
      },
    },
    {
      name: 'domain',
      execute: (request: ActionRequest, state: DAWState): ValidationResult => {
        return reglasDominio.validar(state, request.payload, request.type);
      },
    },
    {
      name: 'conflict',
      execute: (request: ActionRequest, state: DAWState): ValidationResult => {
        return conflictValidator.validate(state, request);
      },
    },
    {
      name: 'ai',
      execute: (request: ActionRequest, _state: DAWState): ValidationResult => {
        if (request.source !== 'ai') return { valid: true, errors: [], warnings: [] };
        const context = (request.context ?? {}) as Record<string, unknown>;
        return aiValidator.validate(request, context);
      },
    },
  ];

  return {
    async validate(request: ActionRequest, options?: { dryRun?: boolean; state?: DAWState }): Promise<ValidationResult> {
      const state = options?.state;
      if (!state) {
        return { valid: false, errors: [{ code: 'STATE_REQUIRED', message: 'El estado es requerido para validar.' }], warnings: [] };
      }

      const allErrors: ValidationError[] = [];
      const allWarnings: ValidationError[] = [];

      for (const step of steps) {
        const result = step.execute(request, state);
        if (!result.valid) {
          allErrors.push(...result.errors);
        }
        allWarnings.push(...result.warnings);
      }

      return {
        valid: allErrors.length === 0,
        errors: allErrors,
        warnings: allWarnings,
      };
    },

    async validateAndPreview(request: ActionRequest, options?: { dryRun?: boolean; state?: DAWState }): Promise<DryRunResult> {
      const validation = await this.validate(request, options);
      const base = {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
      };

      if (!options?.dryRun) {
        return base;
      }

      const state = options?.state;
      if (!state) {
        return {
          ...base,
          events: [],
          stateDiff: {},
        };
      }

      const estadoSimulado = structuredClone(state);
      let eventosSimulados: import('../types/command').StateTransition['events'] = [];
      let stateDiff: Record<string, { before: unknown; after: unknown }> = {};

      const definicion = registry.get(request.type);

      if (definicion?.handler) {
        const estadoAnterior = estadoSimulado;
        const transition = await (definicion.handler(estadoSimulado, request.payload as never) as Promise<{ state: DAWState; events: EventoDominio[] }>);
        const estadoDespues = transition.state;
        eventosSimulados = transition.events;

        stateDiff = calcularDiff(estadoAnterior, estadoDespues);
      }

      return {
        ...base,
        events: eventosSimulados,
        stateDiff,
      };
    },

    addRule(rule: import('../types/command').DomainRule): void {
      reglasDominio.registrar(rule);
    },

    addConflictCheck(check: import('../types/command').ConflictCheck): void {
      conflictValidator.addCheck(check);
    },

    addAICheck(check: import('../types/command').AICheck): void {
      aiValidator.addCheck(check);
    },

    setPermissionValidator(validator: PermissionValidator): void {
      Object.assign(permissionValidator, validator);
    },
  };
}
