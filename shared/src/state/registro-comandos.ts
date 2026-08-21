/**
 * Registry global de definiciones de comandos del DAW.
 *
 * Propósito:
 *   Centralizar el registro de todos los comandos disponibles por tipo,
 *   permitiendo lookup, filtrado por riesgo y descubrimiento dinámico
 *   desde UI, IA, scripts y macros.
 *
 * Importancia:
 *   - Es la única fuente de verdad para qué comandos existen y cómo
 *     se ejecutan.
 *   - Garantiza que el CommandExecutor nunca ejecute comandos no
 *     registrados.
 *   - Permite inspeccionar comandos por riesgo para permisos y UI.
 *
 * Función:
 *   Exporta crearRegistroComandos como singleton accesible desde
 *   cualquier módulo del DAW.
 */

import type { CommandDefinition, RiskLevel } from '../types/command';

/**
 * Interfaz del registro global de comandos.
 *
 * Garantiza que cada comando esté registrado una sola vez y permite
 * consultas por tipo o por nivel de riesgo.
 */
export interface CommandRegistry {
  /**
   * Registra una nueva definición de comando.
   * @throws Error si el tipo ya está registrado.
   */
  register<T>(cmd: CommandDefinition<T>): void;

  /**
   * Elimina un comando del registro por su tipo.
   * @param type - Tipo del comando a eliminar.
   */
  unregister(type: string): void;

  /**
   * Busca una definición de comando por su tipo.
   * @param type - Tipo del comando.
   * @returns Definición encontrada o `undefined`.
   */
  get(type: string): CommandDefinition | undefined;

  /**
   * Lista todas las definiciones de comandos registradas.
   * @returns Array con todas las definiciones.
   */
  list(): CommandDefinition[];

  /**
   * Lista comandos filtrados por nivel de riesgo.
   * @param risk - Nivel de riesgo a filtrar.
   * @returns Array de definiciones que coinciden con el riesgo.
   */
  listByRisk(risk: RiskLevel): CommandDefinition[];
}

/**
 * Crea una instancia del registry global de comandos.
 *
 * El registry es un singleton práctico; usa `registroComandos` para
 * acceder a la instancia compartida.
 *
 * @returns Registry de comandos vacío.
 */
export function crearRegistroComandos(): CommandRegistry {
  const comandos = new Map<string, CommandDefinition>();

  return {
    register<T>(cmd: CommandDefinition<T>): void {
      if (comandos.has(cmd.type)) {
        throw new Error(`El comando ${cmd.type} ya está registrado`);
      }
      comandos.set(cmd.type, cmd as CommandDefinition);
    },

    unregister(type: string): void {
      comandos.delete(type);
    },

    get(type: string): CommandDefinition | undefined {
      return comandos.get(type);
    },

    list(): CommandDefinition[] {
      return Array.from(comandos.values());
    },

    listByRisk(risk: RiskLevel): CommandDefinition[] {
      return Array.from(comandos.values()).filter(cmd => cmd.risk === risk);
    },
  };
}

/**
 * Instancia singleton del registry de comandos.
 *
 * Úsala para registrar comandos built-in o personalizados en toda
 * la aplicación.
 */
export const registroComandos = crearRegistroComandos();
