/**
 * Serialización JSON de DAWState con excepciones documentadas
 * (Map/ArrayBuffer de cache → marcadores sin datos binarios).
 */

import type { DAWState } from '../types/state';
import type { ValorJSON } from '../events/evento-dominio';
import { crearEstadoInicial } from './estado-inicial';

const TIPO_MAP = '__jaswaveMap';
const TIPO_AB = '__jaswaveArrayBufferOmitido';

function reemplazar(_clave: string, valor: unknown): unknown {
  if (valor instanceof Map) {
    const entradas: [string, unknown][] = [];
    for (const [k, v] of valor.entries()) {
      entradas.push([String(k), reemplazar('', v)]);
    }
    return { [TIPO_MAP]: true, entradas };
  }
  if (valor instanceof ArrayBuffer) {
    return { [TIPO_AB]: true, byteLength: valor.byteLength };
  }
  return valor;
}

function revivir(_clave: string, valor: unknown): unknown {
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
    const obj = valor as Record<string, unknown>;
    if (obj[TIPO_MAP] === true && Array.isArray(obj.entradas)) {
      return new Map(obj.entradas as [string, unknown][]);
    }
    if (obj[TIPO_AB] === true) {
      return new ArrayBuffer(Number(obj.byteLength) || 0);
    }
  }
  return valor;
}

/** Serializa DAWState a JSON string sin perder estructura (buffers de cache omitidos). */
export function serializarEstado(estado: DAWState, pretty = false): string {
  return JSON.stringify(estado, reemplazar, pretty ? 2 : undefined);
}

/** Deserializa JSON a DAWState. Restaura Maps; ArrayBuffers quedan vacíos (recomputables). */
export function deserializarEstado(json: string | ValorJSON): DAWState {
  const texto = typeof json === 'string' ? json : JSON.stringify(json);
  const parseado = JSON.parse(texto, revivir) as DAWState;
  if (!parseado || typeof parseado !== 'object' || !parseado.project) {
    throw new Error('JSON no representa un DAWState válido');
  }
  return parseado;
}

/** Round-trip de conveniencia con baseline de factory si faltan campos. */
export function clonarEstadoViaJSON(estado: DAWState): DAWState {
  return deserializarEstado(serializarEstado(estado));
}

/** Fusiona un estado parcial sobre el estado inicial (útil en import). */
export function fusionarConEstadoInicial(parcial: Partial<DAWState>): DAWState {
  const base = crearEstadoInicial();
  return {
    ...base,
    ...parcial,
    project: { ...base.project, ...(parcial.project ?? {}) },
    transport: { ...base.transport, ...(parcial.transport ?? {}) },
    selection: { ...base.selection, ...(parcial.selection ?? {}) },
    ui: { ...base.ui, ...(parcial.ui ?? {}) },
  } as DAWState;
}
