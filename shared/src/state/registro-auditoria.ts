/**
 * Registro de auditoría de ejecuciones de comandos.
 *
 * Propósito:
 *   Mantener un log operacional de todas las ejecuciones de comandos
 *   con trazabilidad de fuente, usuario, timestamp y resultado.
 *
 * Importancia:
 *   - Permite depuración y cumplimiento sin promocionar automáticamente
 *     entradas a memoria de IA.
 *   - Es operacional, no semántico.
 *
 * Función:
 *   Exporta AuditLog y crearRegistroAuditoria.
 */

import type { CommandLogEntry } from '../types/command';

export interface AuditLog {
  log(entry: CommandLogEntry): void;
  list(filtro?: { source?: CommandLogEntry['source']; success?: boolean; limit?: number }): CommandLogEntry[];
  clear(): void;
}

export function crearRegistroAuditoria(): AuditLog {
  const entradas: CommandLogEntry[] = [];

  return {
    log(entry: CommandLogEntry): void {
      entradas.push(entry);
    },

    list(filtro?: { source?: CommandLogEntry['source']; success?: boolean; limit?: number }): CommandLogEntry[] {
      let resultado = [...entradas];
      if (filtro?.source) {
        resultado = resultado.filter(e => e.source === filtro.source);
      }
      if (filtro?.success !== undefined) {
        resultado = resultado.filter(e => e.result === (filtro.success ? 'success' : 'failure'));
      }
      if (filtro?.limit) {
        resultado = resultado.slice(-filtro.limit);
      }
      return resultado;
    },

    clear(): void {
      entradas.length = 0;
    },
  };
}

export const registroAuditoria = crearRegistroAuditoria();
