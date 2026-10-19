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
import {
  agregarAcotado,
  MAX_BYTES_PAYLOAD_REGISTRO,
  MAX_ENTRADAS_REGISTRO,
  resumirPayloadParaRegistro,
} from './resumen-payload';

export interface AuditLog {
  log(entry: CommandLogEntry): void;
  list(filtro?: { source?: CommandLogEntry['source']; success?: boolean; limit?: number }): CommandLogEntry[];
  clear(): void;
}

export interface OpcionesRegistroAuditoria {
  /** Máximo de entradas retenidas (ring buffer). Default 2000. */
  maxEntradas?: number;
  /** Payloads serializados por encima de este tamaño se guardan resumidos. Default 64KB. */
  maxBytesPayload?: number;
}

export function crearRegistroAuditoria(opciones?: OpcionesRegistroAuditoria): AuditLog {
  const entradas: CommandLogEntry[] = [];
  const maxEntradas = Math.max(1, opciones?.maxEntradas ?? MAX_ENTRADAS_REGISTRO);
  const maxBytes = opciones?.maxBytesPayload ?? MAX_BYTES_PAYLOAD_REGISTRO;

  return {
    log(entry: CommandLogEntry): void {
      agregarAcotado(entradas, { ...entry, payload: resumirPayloadParaRegistro(entry.payload, maxBytes) }, maxEntradas);
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
