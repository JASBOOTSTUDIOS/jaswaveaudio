/**
 * Contrato con el backend de sincronización (WebSocket `/sync`).
 *
 * El backend es independiente y trata `payload` como opaco: lo ordena (seq), lo persiste y lo
 * difunde. Este módulo define qué viaja dentro de `payload` cuando `comando === 'jaswave.cambio'`.
 * Debe mantenerse alineado con `backend/src/sync/protocolo.ts`.
 */

import type { EntornoComando } from '../state/entorno-determinista';
import type { RelojVectorial } from './reloj-vectorial';
import type { InstantaneaSerializada } from './instantanea-serializable';

/** Códigos de cierre del WebSocket. */
export const CIERRE_SYNC = {
  NO_AUTENTICADO: 4001,
  SESION_CERRADA: 4002,
  SIN_LATIDO: 4003,
} as const;

export const COMANDO_CAMBIO = 'jaswave.cambio';

/** Carga útil de un cambio replicado (lo que viaja en `payload`). */
export type CargaCambio =
  | {
      id: string;
      userId: string;
      modo: 'operacion';
      comandos: { type: string; payload: unknown; entorno: EntornoComando }[];
    }
  | {
      id: string;
      userId: string;
      modo: 'resultado';
      origen: string;
      /** Entorno con el que aplicar la instantánea (marca de tiempo del autor). */
      entorno: EntornoComando;
      instantanea: InstantaneaSerializada;
    };

/** Mensajes que envía el cliente. */
export type MensajeClienteSync =
  | { tipo: 'sala.unirse'; salaId: string; desdeSeq: number }
  | {
      tipo: 'comando';
      salaId: string;
      clienteId: string;
      comando: typeof COMANDO_CAMBIO;
      payload: CargaCambio;
      vclock: RelojVectorial;
      baseSeq: number;
    }
  | { tipo: 'auth.refresh'; token: string }
  | { tipo: 'ping' };

/** Cambio confirmado por el servidor (con orden total `seq`). */
export type CambioConfirmado = {
  salaId: string;
  seq: number;
  autorId: string;
  clienteId: string;
  comando: string;
  payload: CargaCambio;
  vclock: RelojVectorial;
  baseSeq: number;
  creadoEn: string;
};

/** Mensajes que envía el servidor. */
export type MensajeServidorSync =
  | { tipo: 'sala.unido'; salaId: string; rol: 'owner' | 'editor' | 'viewer'; ultimoSeq: number }
  | ({ tipo: 'comando.aplicado' } & CambioConfirmado)
  | { tipo: 'auth.renovado'; expiraEn: string }
  | { tipo: 'error'; codigo: string; mensaje: string }
  | { tipo: 'pong' };
