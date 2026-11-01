import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Db } from '../db.js';
import type { Identidad } from '../auth/verificador-jwt.js';
import { resolverAcciones, type EstadoLicenciaDominio } from './permisos.js';
import { firmarLicencia, VIGENCIA_LICENCIA_SEGUNDOS, type CargaLicencia } from './token-licencia.js';
import { ErrorApi } from '../http/errores.js';

export type Reloj = () => Date;

/** Crea o vincula el Usuario de una identidad de Supabase (por sub, o por correo si el admin lo creó antes). */
export async function sincronizarUsuario(db: Db, identidad: Identidad) {
  const porSub = await db.usuario.findUnique({ where: { subAuth: identidad.userId } });
  if (porSub) return porSub;
  const porCorreo = await db.usuario.findUnique({ where: { email: identidad.email } });
  if (porCorreo) {
    return db.usuario.update({ where: { id: porCorreo.id }, data: { subAuth: identidad.userId } });
  }
  return db.usuario.create({ data: { subAuth: identidad.userId, email: identidad.email } });
}

/** Acciones efectivas de un usuario sobre un producto (roles + concesiones − denegaciones). */
export async function accionesEfectivas(db: Db, usuarioId: string, productoId: string, ahora: Date): Promise<string[]> {
  const [licencia, asignaciones, concesiones] = await Promise.all([
    db.licencia.findUnique({ where: { usuarioId_productoId: { usuarioId, productoId } } }),
    db.asignacionRol.findMany({
      where: { usuarioId, rol: { productoId } },
      include: { rol: { include: { acciones: { include: { accion: true } } } } },
    }),
    db.concesion.findMany({
      where: { usuarioId, productoId },
      include: { accion: true },
    }),
  ]);
  const accionesDeRoles = asignaciones.flatMap((a) => a.rol.acciones.map((ra) => ra.accion.clave));
  return resolverAcciones({
    estadoLicencia: (licencia?.estado ?? null) as EstadoLicenciaDominio | null,
    accionesDeRoles,
    concesiones: concesiones.map((c) => ({ accionClave: c.accion.clave, efecto: c.efecto, expiraEn: c.expiraEn })),
    ahora,
  });
}

/** Productos sobre los que el usuario tiene al menos una licencia o rol. */
export async function productosDelUsuario(db: Db, usuarioId: string): Promise<string[]> {
  const [licencias, asignaciones] = await Promise.all([
    db.licencia.findMany({ where: { usuarioId }, select: { productoId: true } }),
    db.asignacionRol.findMany({ where: { usuarioId }, select: { rol: { select: { productoId: true } } } }),
  ]);
  return [...new Set([...licencias.map((l) => l.productoId), ...asignaciones.map((a) => a.rol.productoId)])].sort();
}

export async function emitirLicencia(
  db: Db,
  clavePrivadaPem: string,
  usuario: { id: string; email: string },
  dispositivo: string,
  reloj: Reloj,
): Promise<{ token: string; expiraEn: string; productos: Record<string, string[]> }> {
  const ahora = reloj();
  const productos: Record<string, string[]> = {};
  for (const productoId of await productosDelUsuario(db, usuario.id)) {
    const acciones = await accionesEfectivas(db, usuario.id, productoId, ahora);
    if (acciones.length > 0) productos[productoId] = acciones;
  }
  if (Object.keys(productos).length === 0) {
    throw new ErrorApi(403, 'sin_licencia', 'el usuario no tiene productos concedidos');
  }
  const iat = Math.floor(ahora.getTime() / 1000);
  const exp = iat + VIGENCIA_LICENCIA_SEGUNDOS;
  const carga: CargaLicencia = { sub: usuario.id, email: usuario.email, dispositivo, productos, iat, exp };
  return { token: firmarLicencia(carga, clavePrivadaPem), expiraEn: new Date(exp * 1000).toISOString(), productos };
}

/** Hash SHA-256 (hex) del token de dispositivo: en BD nunca se guarda el token en claro. */
export function hashTokenDispositivo(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Registra un dispositivo nuevo del usuario y devuelve su token secreto (solo se entrega una vez). */
export async function registrarDispositivo(db: Db, usuarioId: string, nombre: string, ahora: Date) {
  const token = randomBytes(32).toString('base64url');
  const d = await db.dispositivo.create({
    data: { usuarioId, nombre, hashToken: hashTokenDispositivo(token), ultimoUso: ahora },
  });
  return { dispositivoId: d.id, tokenDispositivo: token };
}

/**
 * Localiza el dispositivo por su token actual o el inmediatamente anterior (gracia de una rotación,
 * por si la respuesta de la renovación previa se perdió). No modifica nada.
 */
export async function buscarDispositivoPorToken(db: Db, tokenPresentado: string) {
  const hash = hashTokenDispositivo(tokenPresentado);
  const d = await db.dispositivo.findFirst({ where: { OR: [{ hashToken: hash }, { hashAnterior: hash }] } });
  if (!d || d.revocado) throw new ErrorApi(401, 'dispositivo_revocado', 'dispositivo desconocido o revocado');
  return { dispositivo: d, hashPresentado: hash };
}

/** Rota el token (llamar solo tras emitir la licencia con éxito, para no dejar al equipo sin token válido). */
export async function rotarTokenDispositivo(
  db: Db,
  encontrado: Awaited<ReturnType<typeof buscarDispositivoPorToken>>,
  nombre: string,
  ahora: Date,
): Promise<string> {
  const { dispositivo: d, hashPresentado } = encontrado;
  const nuevo = randomBytes(32).toString('base64url');
  await db.dispositivo.update({
    where: { id: d.id },
    // La gracia solo cubre el token actual: si se presentó el anterior, éste deja de valer.
    data: {
      hashAnterior: d.hashToken === hashPresentado ? hashPresentado : null,
      hashToken: hashTokenDispositivo(nuevo),
      nombre,
      ultimoUso: ahora,
    },
  });
  return nuevo;
}

/** Código de 8 caracteres legibles para que el usuario lo escriba en el navegador (XXXX-XXXX), sin sesgo. */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function codigoUsuarioLegible(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function codigoDispositivoSecreto(): string {
  return randomBytes(32).toString('base64url');
}

/** Registra una acción administrativa o de licencia en la auditoría. */
export async function auditar(db: Db, actorId: string, accion: string, objetivo: string, datos: object = {}) {
  await db.registroAuditoria.create({ data: { actorId, accion, objetivo, datos: datos as object } });
}
