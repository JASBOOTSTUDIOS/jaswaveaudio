/**
 * API sandboxeada para scripts del DAW.
 *
 * Propósito:
 *   Proveer una API limitada y segura para scripts, permitiendo ejecutar
 *   comandos, consultar estado, suscribirse a eventos y loguear mensajes
 *   sin acceso a DOM ni Node.js `fs` a menos que se conceda explícitamente.
 *
 * Importancia:
 *   - Aísla la ejecución de scripts del resto del sistema.
 *   - Garantiza que los scripts solo puedan operar mediante comandos
 *     registrados, manteniendo la trazabilidad.
 *
 * Función:
 *   Exporta crearApiScripts que recibe el executor y devuelve la API.
 */

import type { ScriptAPI, CommandResult } from '../types/command';
import type { CommandExecutor } from '../state/ejecutor-comandos';
import type { DAWState } from '../types/state';
import type { BusEventos } from '../events/event-bus';

export interface ScriptAPIOptions {
  executor: CommandExecutor;
  busEventos: BusEventos;
  permitirFS?: boolean;
}

export function crearApiScripts(opciones: ScriptAPIOptions): ScriptAPI {
  const { executor, busEventos, permitirFS = false } = opciones;

  return {
    async executeCommand(type: string, payload: unknown): Promise<CommandResult> {
      return executor.execute(type, payload, 'script');
    },

    getState(): DAWState {
      return executor.obtenerEstado();
    },

    subscribe(event: string, handler: Function): { cancelarSuscripcion: () => void } {
      const wrappedHandler = (payload: unknown) => handler(payload);
      const suscripcion = busEventos.on(event, wrappedHandler);
      return {
        cancelarSuscripcion: () => suscripcion.cancelarSuscripcion(),
      };
    },

    log(message: string): void {
      console.log(`[Script] ${message}`);
    },
  };
}
