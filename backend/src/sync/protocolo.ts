import { z } from 'zod';

/** Códigos de cierre del WebSocket de sincronización. */
export const CIERRE = {
  /** Sin token, token inválido o expirado. */
  NO_AUTENTICADO: 4001,
  /** Sesión reemplazada o cerrada por el servidor. */
  SESION_CERRADA: 4002,
  /** Latido perdido (no respondió a ping). */
  SIN_LATIDO: 4003,
} as const;

/** Las instantáneas de cambios "resultado" incluyen pistas completas: margen holgado pero acotado. */
export const TAMANO_MAX_PAYLOAD_BYTES = 512 * 1024;

const salaId = z.string().min(1).max(64);

export const mensajeCliente = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('sala.unirse'), salaId, desdeSeq: z.number().int().min(0).default(0) }),
  z.object({
    tipo: z.literal('comando'),
    salaId,
    clienteId: z.string().min(1).max(64),
    /** Tipo del comando de dominio (p. ej. "nota.insertar"). */
    comando: z.string().min(1).max(120),
    payload: z.record(z.unknown()),
    /** Reloj vectorial del cliente en el momento de emitir (informativo para la reconciliación). */
    vclock: z.record(z.number().int().nonnegative()).default({}),
    /** Último seq que el cliente había visto al emitir (para reconciliar). */
    baseSeq: z.number().int().min(0).default(0),
  }),
  z.object({ tipo: z.literal('auth.refresh'), token: z.string().min(10) }),
  z.object({ tipo: z.literal('ping') }),
]);

export type MensajeCliente = z.infer<typeof mensajeCliente>;

export type MensajeServidor =
  | { tipo: 'sala.unido'; salaId: string; rol: string; ultimoSeq: number }
  | { tipo: 'comando.aplicado'; salaId: string; seq: number; autorId: string; clienteId: string; comando: string; payload: Record<string, unknown>; vclock: Record<string, number>; baseSeq: number; creadoEn: string }
  | { tipo: 'auth.renovado'; expiraEn: string }
  | { tipo: 'error'; codigo: string; mensaje: string; referencia?: string }
  | { tipo: 'pong' };
