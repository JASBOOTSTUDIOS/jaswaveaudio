import type { Db } from '../db.js';
import type { RolSala } from '../generated/prisma/client.js';
import { TAMANO_MAX_PAYLOAD_BYTES, type MensajeCliente } from './protocolo.js';
import { ErrorApi } from '../http/errores.js';

type ComandoEntrante = Extract<MensajeCliente, { tipo: 'comando' }>;

/** Serializa operaciones por sala: los seq quedan contiguos aunque lleguen comandos concurrentes. */
const colas = new Map<string, Promise<unknown>>();
function enSerie<T>(salaId: string, tarea: () => Promise<T>): Promise<T> {
  const previa = colas.get(salaId) ?? Promise.resolve();
  const actual = previa.catch(() => undefined).then(tarea);
  colas.set(salaId, actual);
  // La limpieza no debe propagar el rechazo: quien espera `actual` ya recibe el error.
  const limpiar = () => {
    if (colas.get(salaId) === actual) colas.delete(salaId);
  };
  actual.then(limpiar, limpiar);
  return actual;
}

export async function rolEnSala(db: Db, salaId: string, usuarioId: string): Promise<RolSala | null> {
  const m = await db.miembroSala.findUnique({ where: { salaId_usuarioId: { salaId, usuarioId } } });
  return m?.rol ?? null;
}

const PUEDE_ESCRIBIR: ReadonlySet<RolSala> = new Set<RolSala>(['owner', 'editor']);

export type ComandoAplicado = {
  salaId: string;
  seq: number;
  autorId: string;
  clienteId: string;
  comando: string;
  payload: Record<string, unknown>;
  vclock: Record<string, number>;
  baseSeq: number;
  creadoEn: string;
};

/** Valida permisos y tamaño, asigna el siguiente seq y persiste el comando. */
export function aplicarComando(db: Db, autorId: string, mensaje: ComandoEntrante): Promise<ComandoAplicado> {
  const tamano = Buffer.byteLength(JSON.stringify(mensaje.payload), 'utf8');
  if (tamano > TAMANO_MAX_PAYLOAD_BYTES) {
    throw new ErrorApi(413, 'payload_grande', 'el payload supera 64 KB');
  }
  return enSerie(mensaje.salaId, async () => {
    const rol = await rolEnSala(db, mensaje.salaId, autorId);
    if (!rol) throw new ErrorApi(403, 'no_miembro', 'no eres miembro de la sala');
    if (!PUEDE_ESCRIBIR.has(rol)) throw new ErrorApi(403, 'sin_permiso', 'tu rol es de solo lectura');

    const ultimo = await db.comandoSala.findFirst({
      where: { salaId: mensaje.salaId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    const seq = (ultimo?.seq ?? 0) + 1;
    const fila = await db.comandoSala.create({
      data: {
        salaId: mensaje.salaId,
        seq,
        autorId,
        clienteId: mensaje.clienteId,
        tipo: mensaje.comando,
        payload: mensaje.payload as object,
        vclock: mensaje.vclock,
      },
    });
    return {
      salaId: fila.salaId,
      seq: fila.seq,
      autorId: fila.autorId,
      clienteId: fila.clienteId,
      comando: fila.tipo,
      payload: fila.payload as Record<string, unknown>,
      vclock: fila.vclock as Record<string, number>,
      baseSeq: mensaje.baseSeq,
      creadoEn: fila.creadoEn.toISOString(),
    };
  });
}

/** Comandos con seq > desdeSeq, en orden, para reconectar sin perder cambios. */
export async function comandosDesde(db: Db, salaId: string, desdeSeq: number): Promise<ComandoAplicado[]> {
  const filas = await db.comandoSala.findMany({
    where: { salaId, seq: { gt: desdeSeq } },
    orderBy: { seq: 'asc' },
  });
  return filas.map((f) => ({
    salaId: f.salaId,
    seq: f.seq,
    autorId: f.autorId,
    clienteId: f.clienteId,
    comando: f.tipo,
    payload: f.payload as Record<string, unknown>,
    vclock: f.vclock as Record<string, number>,
    baseSeq: 0,
    creadoEn: f.creadoEn.toISOString(),
  }));
}

export async function ultimoSeq(db: Db, salaId: string): Promise<number> {
  const u = await db.comandoSala.findFirst({ where: { salaId }, orderBy: { seq: 'desc' }, select: { seq: true } });
  return u?.seq ?? 0;
}
