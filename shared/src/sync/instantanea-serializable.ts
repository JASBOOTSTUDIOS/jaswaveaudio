/**
 * Instantánea parcial apta para la red: JSON plano (sin Map) y solo con el lado `despues`, que es lo
 * único que necesita una réplica para aplicar el cambio. El transporte no viaja: es estado local de
 * cada usuario (en V5 va por el canal de presencia).
 *
 * JSON descarta las claves con valor `undefined`, que en una instantánea significan "borrar la
 * clave"; por eso las claves borradas viajan en una lista aparte.
 */

import type { Track } from '../types/tracks';
import type { CambioClaves, CambioPista, InstantaneaParcial } from '../state/instantanea-parcial';

type Registro = Record<string, unknown>;

/** Valores nuevos (sin `undefined`) + claves a borrar. */
export type ClavesSerializadas = { valores: Registro; borradas: string[] };

type CambioPistaSerializado =
  | { modo: 'campos'; despues: ClavesSerializadas }
  | { modo: 'entera'; despues: Track | null };

export type InstantaneaSerializada = {
  proyecto: ClavesSerializadas | null;
  pistas: { ordenDespues: string[]; cambios: [string, CambioPistaSerializado][] } | null;
};

function serializarClaves(r: Registro): ClavesSerializadas {
  const valores: Registro = {};
  const borradas: string[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (v === undefined) borradas.push(k);
    else valores[k] = v;
  }
  return { valores, borradas };
}

function deserializarClaves(c: ClavesSerializadas): CambioClaves {
  const despues: Registro = { ...c.valores };
  for (const k of c.borradas) despues[k] = undefined;
  return { antes: {}, despues };
}

export function serializarInstantanea(inst: InstantaneaParcial): InstantaneaSerializada {
  return {
    proyecto: inst.proyecto ? serializarClaves(inst.proyecto.despues) : null,
    pistas: inst.pistas
      ? {
          ordenDespues: inst.pistas.ordenDespues,
          cambios: [...inst.pistas.cambios.entries()].map(([id, c]): [string, CambioPistaSerializado] =>
            c.modo === 'campos'
              ? [id, { modo: 'campos', despues: serializarClaves(c.cambio.despues) }]
              : [id, { modo: 'entera', despues: c.despues ?? null }],
          ),
        }
      : null,
  };
}

/** Reconstruye una instantánea aplicable con `aplicarInstantaneaParcial(…, 'despues')`. */
export function deserializarInstantanea(s: InstantaneaSerializada): InstantaneaParcial {
  return {
    proyecto: s.proyecto ? deserializarClaves(s.proyecto) : null,
    pistas: s.pistas
      ? {
          ordenAntes: [],
          ordenDespues: s.pistas.ordenDespues,
          cambios: new Map<string, CambioPista>(
            s.pistas.cambios.map(([id, c]): [string, CambioPista] =>
              c.modo === 'campos'
                ? [id, { modo: 'campos', cambio: deserializarClaves(c.despues) }]
                : [id, { modo: 'entera', antes: undefined, despues: c.despues ?? undefined }],
            ),
          ),
        }
      : null,
    transporte: null,
  };
}
