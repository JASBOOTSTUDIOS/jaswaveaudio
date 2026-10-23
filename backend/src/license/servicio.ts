import { randomBytes } from 'node:crypto';
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
  await db.dispositivo.create({ data: { usuarioId: usuario.id, nombre: dispositivo, ultimoUso: ahora } });
  return { token: firmarLicencia(carga, clavePrivadaPem), expiraEn: new Date(exp * 1000).toISOString(), productos };
}

/** Código de 8 caracteres legibles para que el usuario lo escriba en el navegador (XXXX-XXXX). */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function codigoUsuarioLegible(): string {
  const bytes = randomBytes(8);
  let s = '';
  for (const b of bytes) s += ALFABETO[b % ALFABETO.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function codigoDispositivoSecreto(): string {
  return randomBytes(32).toString('base64url');
}

/** Registra una acción administrativa o de licencia en la auditoría. */
export async function auditar(db: Db, actorId: string, accion: string, objetivo: string, datos: object = {}) {
  await db.registroAuditoria.create({ data: { actorId, accion, objetivo, datos: datos as object } });
}
