import type { DAWState } from '../types/state';
import type { CommandExecutor, CambioReplicable } from '../state/ejecutor-comandos';
import { aplicarInstantaneaParcial, capturarInstantaneaParcial } from '../state/instantanea-parcial';
import { conEntorno, nuevoEntorno } from '../state/entorno-determinista';
import { withUpdatedStateRevision } from '../state/state-revision';
import type { CargaCambio } from './protocolo';
import type { AplicadorCambios } from './replica';
import { deserializarInstantanea, serializarInstantanea } from './instantanea-serializable';

/**
 * Crea el aplicador determinista a partir de un ejecutor **dedicado** (no el de la UI): sus pilas,
 * historial y listeners no importan; solo se usa para reejecutar comandos sobre un estado dado.
 */
export function crearAplicador(ejecutorDedicado: CommandExecutor): AplicadorCambios {
  return async (estado: DAWState, carga: CargaCambio): Promise<DAWState | null> => {
    if (carga.modo === 'resultado') {
      const inst = deserializarInstantanea(carga.instantanea);
      return conEntorno(carga.entorno, () => withUpdatedStateRevision(aplicarInstantaneaParcial(estado, inst, 'despues')));
    }
    ejecutorDedicado.reemplazarEstado(estado, { limpiarPila: true });
    const r = await ejecutorDedicado.batch(
      carga.comandos.map((c) => ({ type: c.type, payload: c.payload, entorno: c.entorno })),
      'user',
      carga.userId,
    );
    return r.success ? ejecutorDedicado.obtenerEstado() : null;
  };
}

/** Convierte un cambio local del ejecutor en la carga que viaja al servidor. */
export function cargaDesdeCambio(cambio: CambioReplicable): CargaCambio | null {
  if (cambio.modo === 'operacion') {
    return { id: cambio.id, userId: cambio.userId, modo: 'operacion', comandos: cambio.comandos };
  }
  const inst = capturarInstantaneaParcial(cambio.antes, cambio.despues);
  if (!inst || (!inst.proyecto && !inst.pistas)) return null; // solo cambió estado local (transporte)
  return {
    id: cambio.id,
    userId: cambio.userId,
    modo: 'resultado',
    origen: cambio.origen,
    entorno: nuevoEntorno(),
    instantanea: serializarInstantanea(inst),
  };
}
