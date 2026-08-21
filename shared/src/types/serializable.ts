/**
 * Interfaz de serialización del dominio JasWave.
 *
 * Propósito:
 *   Establecer el contrato mínimo que deben cumplir las entidades
 *   serializables del DAW para persistencia, intercambio y replay.
 *
 * Importancia:
 *   - Garantiza que todo el estado del proyecto pueda convertirse a JSON
 *     y restaurarse sin pérdida.
 *   - Permite implementar guardado, carga, exportación y sincronización
 *     en nube de forma uniforme.
 *   - Excluye explícitamente buffers binarios, estado DSP y waveforms
 *     de runtime, que se reconstruyen o referencian.
 *
 * Función:
 *   Exporta la interfaz Serializable con toJSON y fromJSON, más helpers
 *   de serialización/deserialización para colecciones y validación
 *   de esquemas.
 */

import type { ValorJSON } from '../events/evento-dominio';

export interface Serializable {
  toJSON(): ValorJSON;
  fromJSON(json: ValorJSON): Serializable;
  version: string;
  tipo: string;
}

export function serializar<T extends Serializable>(objeto: T): ValorJSON {
  return objeto.toJSON();
}

export function deserializar<T extends Serializable>(clase: { new (): T }, json: ValorJSON): T {
  const instancia = new clase();
  return instancia.fromJSON(json) as T;
}
