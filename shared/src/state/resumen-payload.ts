/**
 * Utilidades para acotar el crecimiento de historial y auditoría.
 *
 * Propósito:
 *   Evitar que el historial de comandos y el registro de auditoría retengan
 *   payloads enormes (p. ej. waveforms, proyectos completos, estado de plugins)
 *   y crezcan sin límite durante sesiones largas.
 */

/** Máximo de entradas por defecto en historial / auditoría (ring buffer). */
export const MAX_ENTRADAS_REGISTRO = 2000;

/** Tamaño máximo (aprox. en bytes UTF-16 / chars JSON) de un payload retenido. */
export const MAX_BYTES_PAYLOAD_REGISTRO = 64 * 1024;

export interface PayloadResumido {
  __resumido: true;
  /** Tamaño aproximado del payload original serializado (chars JSON). */
  bytes: number;
  /** Primeras claves del objeto original (si era objeto). */
  claves?: string[];
  tipo: string;
}

/**
 * Devuelve el payload tal cual si es pequeño; si su serialización supera
 * `maxBytes` (o no es serializable) devuelve un resumen ligero.
 */
export function resumirPayloadParaRegistro(payload: unknown, maxBytes = MAX_BYTES_PAYLOAD_REGISTRO): unknown {
  if (payload === null || payload === undefined) return payload;
  const tipo = Array.isArray(payload) ? 'array' : typeof payload;
  if (tipo !== 'object' && tipo !== 'array') {
    if (typeof payload === 'string' && payload.length > maxBytes) {
      return { __resumido: true, bytes: payload.length, tipo: 'string' } satisfies PayloadResumido;
    }
    return payload;
  }
  let bytes: number;
  try {
    bytes = JSON.stringify(payload)?.length ?? 0;
  } catch {
    return { __resumido: true, bytes: -1, tipo, claves: clavesDe(payload) } satisfies PayloadResumido;
  }
  if (bytes <= maxBytes) return payload;
  return { __resumido: true, bytes, tipo, claves: clavesDe(payload) } satisfies PayloadResumido;
}

function clavesDe(payload: unknown): string[] | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  return Object.keys(payload as Record<string, unknown>).slice(0, 20);
}

/** Inserta al final y descarta las entradas más antiguas por encima de `max`. */
export function agregarAcotado<T>(lista: T[], entrada: T, max = MAX_ENTRADAS_REGISTRO): void {
  lista.push(entrada);
  if (lista.length > max) {
    lista.splice(0, lista.length - max);
  }
}
