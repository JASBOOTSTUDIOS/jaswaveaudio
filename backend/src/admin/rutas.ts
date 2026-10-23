import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { VerificadorJwt } from '../auth/verificador-jwt.js';
import { exigirAdmin, exigirAutenticacion } from '../http/auth-middleware.js';
import { ErrorApi } from '../http/errores.js';
import { auditar } from '../license/servicio.js';

const idEsquema = z.object({ id: z.string().min(1).max(200) });

const productoEsquema = z.object({
  id: z.string().regex(/^[a-z0-9.\-]{3,120}$/, 'id de producto en minúsculas, puntos o guiones'),
  nombre: z.string().min(1).max(120),
});
const accionEsquema = z.object({
  clave: z.string().regex(/^[a-z0-9][a-z0-9.\-]{1,120}$/, 'clave de acción en minúsculas'),
  descripcion: z.string().max(400).default(''),
});
const rolEsquema = z.object({ nombre: z.string().min(1).max(80) });
const accionesDeRolEsquema = z.object({ accionIds: z.array(z.string()).max(500) });
const asignarRolesEsquema = z.object({ rolIds: z.array(z.string()).max(500) });
const concesionEsquema = z.object({
  accionId: z.string().min(1),
  efecto: z.enum(['allow', 'deny']),
  expiraEn: z.string().datetime().nullable().optional(),
});
const licenciaEsquema = z.object({ estado: z.enum(['activa', 'suspendida', 'revocada']) });
const usuarioEsquema = z.object({ email: z.string().email().max(254).transform((e) => e.toLowerCase()) });

export type OpcionesAdmin = { db: Db; verificar: VerificadorJwt };

/** Panel admin: todas las rutas exigen sesión y rol de administrador (validado en servidor). */
export function rutasAdmin({ db, verificar }: OpcionesAdmin): Router {
  const r = Router();
  r.use(exigirAutenticacion(verificar), exigirAdmin);

  const actor = (req: { identidad?: { userId: string } }) => req.identidad?.userId ?? 'desconocido';

  // ---------- Productos ----------
  r.get('/productos', async (_req, res) => {
    const productos = await db.producto.findMany({
      orderBy: { id: 'asc' },
      include: { acciones: { orderBy: { clave: 'asc' } }, roles: { orderBy: { nombre: 'asc' } } },
    });
    res.json({ productos });
  });

  r.post('/productos', async (req, res) => {
    const datos = productoEsquema.parse(req.body);
    const producto = await db.producto.create({ data: datos });
    await auditar(db, actor(req), 'producto.crear', producto.id, datos);
    res.status(201).json({ producto });
  });

  r.delete('/productos/:id', async (req, res) => {
    const { id } = idEsquema.parse(req.params);
    await db.producto.delete({ where: { id } });
    await auditar(db, actor(req), 'producto.eliminar', id);
    res.status(204).end();
  });

  // ---------- Acciones y roles de un producto ----------
  r.post('/productos/:id/acciones', async (req, res) => {
    const { id } = idEsquema.parse(req.params);
    const datos = accionEsquema.parse(req.body);
    const accion = await db.accion.create({ data: { productoId: id, ...datos } });
    await auditar(db, actor(req), 'accion.crear', `${id}#${datos.clave}`, datos);
    res.status(201).json({ accion });
  });

  r.delete('/acciones/:id', async (req, res) => {
    const { id } = idEsquema.parse(req.params);
    const accion = await db.accion.delete({ where: { id } });
    await auditar(db, actor(req), 'accion.eliminar', `${accion.productoId}#${accion.clave}`);
    res.status(204).end();
  });

  r.post('/productos/:id/roles', async (req, res) => {
    const { id } = idEsquema.parse(req.params);
    const datos = rolEsquema.parse(req.body);
    const rol = await db.rolProducto.create({ data: { productoId: id, nombre: datos.nombre } });
    await auditar(db, actor(req), 'rol.crear', `${id}#${datos.nombre}`);
    res.status(201).json({ rol });
  });

  /** Reemplaza el conjunto de acciones de un rol. */
  r.put('/roles/:id/acciones', async (req, res) => {
    const { id } = idEsquema.parse(req.params);
    const { accionIds } = accionesDeRolEsquema.parse(req.body);
    const rol = await db.rolProducto.findUniqueOrThrow({ where: { id } }).catch(() => {
      throw new ErrorApi(404, 'rol_no_encontrado', 'rol desconocido');
    });
    const acciones = await db.accion.findMany({ where: { id: { in: accionIds }, productoId: rol.productoId } });
    if (acciones.length !== new Set(accionIds).size) {
      throw new ErrorApi(400, 'accion_ajena', 'alguna acción no pertenece al producto del rol');
    }
    await db.$transaction([
      db.rolAccion.deleteMany({ where: { rolId: id } }),
      db.rolAccion.createMany({ data: acciones.map((a) => ({ rolId: id, accionId: a.id })) }),
    ]);
    await auditar(db, actor(req), 'rol.acciones', id, { accionIds });
    res.json({ ok: true });
  });

  // ---------- Usuarios: alta por correo, roles y permisos directos ----------
  r.get('/usuarios', async (_req, res) => {
    const usuarios = await db.usuario.findMany({
      orderBy: { email: 'asc' },
      include: { roles: { include: { rol: true } }, licencias: true, concesiones: { include: { accion: true } } },
    });
    res.json({ usuarios });
  });

  r.post('/usuarios', async (req, res) => {
    const { email } = usuarioEsquema.parse(req.body);
    const usuario = await db.usuario.upsert({ where: { email }, update: {}, create: { email } });
    await auditar(db, actor(req), 'usuario.alta', email);
    res.status(201).json({ usuario });
  });

  r.put('/usuarios/:id/roles', async (req, res) => {
    const { id } = idEsquema.parse(req.params);
    const { rolIds } = asignarRolesEsquema.parse(req.body);
    await db.$transaction([
      db.asignacionRol.deleteMany({ where: { usuarioId: id } }),
      db.asignacionRol.createMany({ data: rolIds.map((rolId) => ({ usuarioId: id, rolId })) }),
    ]);
    await auditar(db, actor(req), 'usuario.roles', id, { rolIds });
    res.json({ ok: true });
  });

  r.put('/usuarios/:id/concesiones', async (req, res) => {
    const { id } = idEsquema.parse(req.params);
    const datos = concesionEsquema.parse(req.body);
    const accion = await db.accion.findUnique({ where: { id: datos.accionId } });
    if (!accion) throw new ErrorApi(404, 'accion_no_encontrada', 'acción desconocida');
    const concesion = await db.concesion.upsert({
      where: { usuarioId_accionId: { usuarioId: id, accionId: accion.id } },
      update: { efecto: datos.efecto, expiraEn: datos.expiraEn ? new Date(datos.expiraEn) : null },
      create: {
        usuarioId: id,
        productoId: accion.productoId,
        accionId: accion.id,
        efecto: datos.efecto,
        expiraEn: datos.expiraEn ? new Date(datos.expiraEn) : null,
      },
    });
    await auditar(db, actor(req), 'usuario.concesion', `${id}#${accion.clave}`, { efecto: datos.efecto });
    res.json({ concesion });
  });

  r.delete('/usuarios/:id/concesiones/:accionId', async (req, res) => {
    const { id, accionId } = z.object({ id: z.string(), accionId: z.string() }).parse(req.params);
    await db.concesion.deleteMany({ where: { usuarioId: id, accionId } });
    await auditar(db, actor(req), 'usuario.concesion.quitar', `${id}#${accionId}`);
    res.status(204).end();
  });

  // ---------- Licencias ----------
  /** Activa, suspende o revoca la licencia de un usuario para un producto. */
  r.put('/licencias/:usuarioId/:productoId', async (req, res) => {
    const { usuarioId, productoId } = z.object({ usuarioId: z.string(), productoId: z.string() }).parse(req.params);
    const { estado } = licenciaEsquema.parse(req.body);
    const licencia = await db.licencia.upsert({
      where: { usuarioId_productoId: { usuarioId, productoId } },
      update: { estado },
      create: { usuarioId, productoId, estado },
    });
    await auditar(db, actor(req), 'licencia.estado', `${usuarioId}@${productoId}`, { estado });
    res.json({ licencia });
  });

  r.get('/auditoria', async (req, res) => {
    const limite = Math.min(Number(req.query.limite ?? 100) || 100, 500);
    const registros = await db.registroAuditoria.findMany({ orderBy: { creadoEn: 'desc' }, take: limite });
    res.json({ registros });
  });

  return r;
}
