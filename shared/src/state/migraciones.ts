/**
 * Runner de migraciones de esquema para DAWState.
 *
 * Propósito:
 *   Aplicar migraciones de versión de esquema sobre DAWState de forma
 *   secuencial y reversible cuando sea posible.
 *
 * Importancia:
 *   - Garantiza compatibilidad hacia adelante y hacia atrás.
 *   - Centraliza la lógica de evolución del esquema.
 *   - Facilita la actualización de proyectos antiguos.
 *
 * Función:
 *   Exporta ejecutarMigraciones que aplica un array de DAWStateMigration
 *   sobre un DAWState y devuelve el estado resultante.
 */

import type { DAWState } from '../types/state';
import type { DAWStateMigration } from '../types/state';

export interface ResultadoMigracion {
  exito: boolean;
  versionOrigen: string;
  versionDestino: string;
  migracionesAplicadas: string[];
  errores: { migracion: string; mensaje: string }[];
}

export function ejecutarMigraciones(estado: DAWState, migraciones: DAWStateMigration[]): ResultadoMigracion {
  const resultado: ResultadoMigracion = {
    exito: true,
    versionOrigen: estado.esquemaVersion,
    versionDestino: estado.esquemaVersion,
    migracionesAplicadas: [],
    errores: [],
  };

  let estadoActual = estado;
  for (const migracion of migraciones) {
    if (migracion.versionOrigen !== estadoActual.esquemaVersion) {
      resultado.errores.push({
        migracion: migracion.versionDestino,
        mensaje: `Versión origen ${migracion.versionOrigen} no coincide con estado actual ${estadoActual.esquemaVersion}`,
      });
      resultado.exito = false;
      continue;
    }

    try {
      for (const paso of migracion.migraciones) {
        estadoActual = paso.ejecutar(estadoActual);
      }
      resultado.migracionesAplicadas.push(migracion.versionDestino);
      resultado.versionDestino = migracion.versionDestino;
    } catch (error: any) {
      resultado.errores.push({
        migracion: migracion.versionDestino,
        mensaje: error?.message ?? String(error),
      });
      resultado.exito = false;
    }
  }

  return resultado;
}
