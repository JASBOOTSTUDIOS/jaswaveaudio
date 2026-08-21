/**
 * Sistema de macros del DAW.
 *
 * Propósito:
 *   Permitir registrar, validar, agrupar y ejecutar secuencias de
 *   comandos como macros, facilitando automatización de flujos
 *   repetitivos con trazabilidad, cancelación y timeouts.
 *
 * Importancia:
 *   - Las macros se ejecutan como transacciones atómicas.
 *   - Si un comando falla, toda la macro se revierte.
 *   - Permite automatización avanzada con validación, condiciones
 *     y grupos de ejecución.
 *
 * Función:
 *   Exporta MacroRegistry para registrar macros y ejecutarlas mediante
 *   CommandExecutor.batch(), con soporte de validación, cancelación,
 *   timeouts, grupos y eventos de progreso.
 */

import type { Macro, CommandPayload, TransactionResult, CommandResult } from '../types/command';
import type { CommandExecutor } from './ejecutor-comandos';
import type { AuditLog } from './registro-auditoria';
import type { BusEventos } from '../events/event-bus';

export interface MacroDefinition extends Macro {
  descripcion?: string;
  categoria?: string;
  validacion?: {
    pre?: (params: Record<string, unknown>) => boolean;
    post?: (result: TransactionResult) => boolean;
  };
  agruparCon?: string;
  condicional?: {
    cuando: (params: Record<string, unknown>, estado: unknown) => boolean;
    sino?: MacroDefinition;
  };
  timeoutMs?: number;
  maximoReintentos?: number;
}

export interface MacroExecution {
  id: string;
  macroId: string;
  inicio: number;
  fin?: number;
  estado: 'ejecutando' | 'completada' | 'fallida' | 'cancelada' | 'timeout';
  resultado?: TransactionResult;
  error?: string;
  comandosEjecutados: number;
  comandosTotales: number;
}

export interface MacroGroup {
  id: string;
  nombre: string;
  descripcion: string;
  macros: string[];
  secuencial: boolean;
}

export interface MacroRegistry {
  register(macro: MacroDefinition): void;
  unregister(id: string): void;
  get(id: string): MacroDefinition | undefined;
  list(): MacroDefinition[];
  listByCategory(categoria: string): MacroDefinition[];
  createGroup(group: MacroGroup): void;
  getGroup(id: string): MacroGroup | undefined;
  execute(id: string, executor: CommandExecutor, options?: { source?: 'user' | 'script' | 'ai'; userId?: string; audit?: AuditLog; bus?: BusEventos; timeoutMs?: number; onProgress?: (progress: MacroExecution) => void }): Promise<TransactionResult>;
  cancel(id: string): void;
  getExecution(id: string): MacroExecution | undefined;
  getExecutions(): MacroExecution[];
}

export function crearRegistroMacros(busEventos?: BusEventos): MacroRegistry {
  const macros = new Map<string, MacroDefinition>();
  const grupos = new Map<string, MacroGroup>();
  const ejecuciones = new Map<string, MacroExecution>();
  const ejecucionesActivas = new Map<string, { cancelar: () => void; timeout?: ReturnType<typeof setTimeout> }>();

  return {
    register(macro: MacroDefinition): void {
      if (macros.has(macro.id)) {
        throw new Error(`La macro ${macro.id} ya está registrada`);
      }
      macros.set(macro.id, macro);
    },

    unregister(id: string): void {
      macros.delete(id);
    },

    get(id: string): MacroDefinition | undefined {
      return macros.get(id);
    },

    list(): MacroDefinition[] {
      return Array.from(macros.values());
    },

    listByCategory(categoria: string): MacroDefinition[] {
      return Array.from(macros.values()).filter(m => m.categoria === categoria);
    },

    createGroup(group: MacroGroup): void {
      if (grupos.has(group.id)) {
        throw new Error(`El grupo ${group.id} ya existe`);
      }
      grupos.set(group.id, group);
    },

    getGroup(id: string): MacroGroup | undefined {
      return grupos.get(id);
    },

    async execute(id: string, executor: CommandExecutor, options?: { source?: 'user' | 'script' | 'ai'; userId?: string; audit?: AuditLog; bus?: BusEventos; timeoutMs?: number; onProgress?: (progress: MacroExecution) => void }): Promise<TransactionResult> {
      const macro = macros.get(id);
      if (!macro) {
        const result: TransactionResult = { success: false, results: [], rolledBack: false, error: { code: 'MACRO_NOT_FOUND', message: `Macro no encontrada: ${id}` } };
        return result;
      }

      if (macro.validacion?.pre) {
        const preValid = macro.validacion.pre(macro.parameters ?? {});
        if (!preValid) {
          const result: TransactionResult = { success: false, results: [], rolledBack: false, error: { code: 'MACRO_PRE_VALIDATION_FAILED', message: 'Validación pre-ejecución de macro fallida' } };
          return result;
        }
      }

      const executionId = crypto.randomUUID();
      const inicio = Date.now();
      const execution: MacroExecution = {
        id: executionId,
        macroId: macro.id,
        inicio,
        estado: 'ejecutando',
        comandosEjecutados: 0,
        comandosTotales: macro.commands.length,
      };
      ejecuciones.set(executionId, execution);

      let cancelada = false;
      const cancelar = () => {
        cancelada = true;
        execution.estado = 'cancelada';
        execution.fin = Date.now();
        execution.error = 'Macro cancelada por el usuario';
      };

      const timeoutMs = options?.timeoutMs ?? macro.timeoutMs ?? 30000;
      const timeoutHandle = setTimeout(() => {
        if (ejecucionActiva(executionId)) {
          cancelar();
          execution.estado = 'timeout';
          execution.error = `Macro timeout después de ${timeoutMs}ms`;
        }
      }, timeoutMs);

      ejecucionesActivas.set(executionId, { cancelar, timeout: timeoutHandle });

      const commands: CommandPayload[] = macro.commands.map(type => ({
        type,
        payload: macro.parameters?.[type] ?? {},
      }));

      const source = options?.source ?? 'user';
      const userId = options?.userId;
      const audit = options?.audit;
      const bus = options?.bus ?? busEventos;

      let resultado: TransactionResult;
      try {
        if (macro.condicional && !macro.condicional.cuando(macro.parameters ?? {}, executor.obtenerEstado())) {
          const sino = macro.condicional.sino;
          if (sino) {
            const sinoCommands: CommandPayload[] = sino.commands.map(type => ({
              type,
              payload: sino.parameters?.[type] ?? {},
            }));
            resultado = await executor.batch(sinoCommands, source, userId);
          } else {
            resultado = { success: true, results: [], rolledBack: false };
          }
        } else {
          resultado = await executor.batch(commands, source, userId);
        }

        execution.comandosEjecutados = resultado.results.length;
        execution.estado = resultado.success ? 'completada' : 'fallida';
        execution.error = resultado.error?.message;
      } catch (e: unknown) {
        execution.estado = 'fallida';
        execution.error = e instanceof Error ? e.message : String(e);
        resultado = { success: false, results: [], rolledBack: false, error: { code: 'MACRO_EXECUTION_ERROR', message: execution.error } };
      } finally {
        execution.fin = Date.now();
        const activa = ejecucionesActivas.get(executionId);
        if (activa) {
          if (activa.timeout) clearTimeout(activa.timeout);
          ejecucionesActivas.delete(executionId);
        }
      }

      if (audit) {
        audit.log({
          id: executionId,
          timestamp: inicio,
          commandType: `macro.${macro.id}`,
          payload: macro.parameters,
          source: source as any,
          userId,
          result: execution.estado === 'completada' ? 'success' : 'failure',
          error: execution.error,
        });
      }

      if (bus && execution.estado === 'completada') {
        bus.emit('macro.ejecutada', { macroId: macro.id, executionId, resultado });
      }

      options?.onProgress?.(execution);

      return resultado;
    },

    cancel(id: string): void {
      const activa = ejecucionesActivas.get(id);
      if (activa) {
        activa.cancelar();
      }
    },

    getExecution(id: string): MacroExecution | undefined {
      return ejecuciones.get(id);
    },

    getExecutions(): MacroExecution[] {
      return Array.from(ejecuciones.values());
    },
  };

  function ejecucionActiva(executionId: string): boolean {
    return ejecucionesActivas.has(executionId);
  }
}

export const registroMacros = crearRegistroMacros();
