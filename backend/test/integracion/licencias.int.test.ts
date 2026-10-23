import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { crearApp } from '../../src/app.js';
import { claveDesdeJwksLocal, crearVerificadorJwt } from '../../src/auth/verificador-jwt.js';
import { crearDb, type Db } from '../../src/db.js';
import { generarParClaves, verificarLicencia } from '../../src/license/token-licencia.js';
import { crearEmisorPrueba } from '../jwt-local.js';

import { URL_BD_PRUEBAS as URL_DB } from './preparar-bd.js';
const PRODUCTO = 'com.jaswave.plugin.param-eq';
const ADMIN = 'admin@jaswave.test';

describe('L1 — licencias, roles y permisos (integración con Postgres)', () => {
  let db: Db;
  let emisor: Awaited<ReturnType<typeof crearEmisorPrueba>>;
  let claves: ReturnType<typeof generarParClaves>;
  let app: ReturnType<typeof crearApp>;
  let tiempo = new Date('2026-10-23T12:00:00Z');

  beforeAll(async () => {
    db = crearDb(URL_DB);
    emisor = await crearEmisorPrueba();
    claves = generarParClaves();
    const verificar = crearVerificadorJwt({ claves: claveDesdeJwksLocal(emisor.jwks), adminsIniciales: [ADMIN] });
    app = crearApp({
      verificar,
      origenesCors: [],
      datos: { db, clavePrivadaPem: claves.privada, reloj: () => tiempo },
    });
  });

  beforeEach(async () => {
    tiempo = new Date('2026-10-23T12:00:00Z');
    await db.$executeRawUnsafe(
      'TRUNCATE "RegistroAuditoria","Concesion","AsignacionRol","RolAccion","RolProducto","Accion","Licencia","Dispositivo","CodigoDispositivo","Usuario","Producto" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  const tokenDe = (email: string, sub: string) => emisor.emitir({ sub, email });

  /** Prepara: producto con dos acciones, rol "mezcla" con una, usuario con ese rol y licencia activa. */
  async function prepararEscenario() {
    const adminToken = await tokenDe(ADMIN, 'sub-admin');
    const send = (m: 'get' | 'post' | 'put' | 'delete', ruta: string, cuerpo?: object, token = adminToken) => {
      const req = request(app)[m](ruta).set('Authorization', `Bearer ${token}`);
      return cuerpo !== undefined ? req.send(cuerpo) : req;
    };
    await send('post', '/admin/productos', { id: PRODUCTO, nombre: 'EQ Paramétrico' }).expect(201);
    const a1 = (await send('post', `/admin/productos/${PRODUCTO}/acciones`, { clave: 'eq.banda', descripcion: 'bandas' })).body.accion;
    const a2 = (await send('post', `/admin/productos/${PRODUCTO}/acciones`, { clave: 'eq.exportar' })).body.accion;
    const rol = (await send('post', `/admin/productos/${PRODUCTO}/roles`, { nombre: 'mezcla' })).body.rol;
    await send('put', `/admin/roles/${rol.id}/acciones`, { accionIds: [a1.id] }).expect(200);
    const usuario = (await send('post', '/admin/usuarios', { email: 'Artista@Ejemplo.com' })).body.usuario;
    await send('put', `/admin/usuarios/${usuario.id}/roles`, { rolIds: [rol.id] }).expect(200);
    await send('put', `/admin/licencias/${usuario.id}/${PRODUCTO}`, { estado: 'activa' }).expect(200);
    return { send, a1, a2, rol, usuario, adminToken };
  }

  it('el listado de productos incluye las acciones de cada rol (matriz del panel admin)', async () => {
    const { send, a1, rol } = await prepararEscenario();
    const r = await send('get', '/admin/productos');
    const producto = r.body.productos.find((p: { id: string }) => p.id === PRODUCTO);
    const rolListado = producto.roles.find((x: { id: string }) => x.id === rol.id);
    expect(rolListado.acciones).toEqual([{ accionId: a1.id }]);
  });

  it('un no-admin no puede usar el panel admin', async () => {
    const token = await tokenDe('persona@x.com', 'sub-x');
    const r = await request(app).get('/admin/productos').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(403);
  });

  it('flujo completo device-code: start → aprobar en navegador → poll entrega licencia firmada', async () => {
    const { usuario } = await prepararEscenario();
    const sesionUsuario = await tokenDe('artista@ejemplo.com', 'sub-artista');

    const start = await request(app).post('/license/device/start').send({ productoId: PRODUCTO, dispositivo: 'Reaper-PC' }).expect(201);
    const { codigoDispositivo, codigoUsuario } = start.body;

    const pendiente = await request(app).post('/license/device/poll').send({ codigoDispositivo, dispositivo: 'Reaper-PC' });
    expect(pendiente.body.estado).toBe('pendiente');

    await request(app).post('/license/device/aprobar').set('Authorization', `Bearer ${sesionUsuario}`).send({ codigoUsuario }).expect(200);

    const aprobado = await request(app).post('/license/device/poll').send({ codigoDispositivo, dispositivo: 'Reaper-PC' });
    expect(aprobado.body.estado).toBe('aprobado');
    const carga = verificarLicencia(aprobado.body.token, claves.publica, Math.floor(tiempo.getTime() / 1000));
    expect(carga.sub).toBe(usuario.id);
    expect(carga.productos[PRODUCTO]).toEqual(['eq.banda']);
    expect(carga.exp - carga.iat).toBe(24 * 60 * 60);

    // Un código ya consumido no se puede reutilizar.
    await request(app).post('/license/device/poll').send({ codigoDispositivo, dispositivo: 'Reaper-PC' }).expect(404);
  });

  it('un deny directo quita la acción aunque el rol la otorgue', async () => {
    const { send, a1, usuario } = await prepararEscenario();
    await send('put', `/admin/usuarios/${usuario.id}/concesiones`, { accionId: a1.id, efecto: 'deny' }).expect(200);
    const sesion = await tokenDe('artista@ejemplo.com', 'sub-artista');
    const r = await request(app).post('/license/refresh').set('Authorization', `Bearer ${sesion}`).send({ dispositivo: 'PC' });
    expect(r.status).toBe(403);
    expect(r.body.error.codigo).toBe('sin_licencia');
  });

  it('un allow directo añade una acción sin rol', async () => {
    const { send, a2, usuario } = await prepararEscenario();
    await send('put', `/admin/usuarios/${usuario.id}/concesiones`, { accionId: a2.id, efecto: 'allow' }).expect(200);
    const sesion = await tokenDe('artista@ejemplo.com', 'sub-artista');
    const r = await request(app).post('/license/refresh').set('Authorization', `Bearer ${sesion}`).send({ dispositivo: 'PC' }).expect(200);
    const carga = verificarLicencia(r.body.token, claves.publica, Math.floor(tiempo.getTime() / 1000));
    expect(carga.productos[PRODUCTO]).toEqual(['eq.banda', 'eq.exportar']);
  });

  it('suspender la licencia deja sin acceso en el siguiente refresco', async () => {
    const { send, usuario } = await prepararEscenario();
    const sesion = await tokenDe('artista@ejemplo.com', 'sub-artista');
    await request(app).post('/license/refresh').set('Authorization', `Bearer ${sesion}`).send({ dispositivo: 'PC' }).expect(200);

    await send('put', `/admin/licencias/${usuario.id}/${PRODUCTO}`, { estado: 'suspendida' }).expect(200);
    const r = await request(app).post('/license/refresh').set('Authorization', `Bearer ${sesion}`).send({ dispositivo: 'PC' });
    expect(r.status).toBe(403);
  });

  it('una concesión con expiración deja de contar después de la fecha', async () => {
    const { send, a2, usuario } = await prepararEscenario();
    await send('put', `/admin/usuarios/${usuario.id}/concesiones`, {
      accionId: a2.id,
      efecto: 'allow',
      expiraEn: '2026-10-24T00:00:00.000Z',
    }).expect(200);
    const sesion = await tokenDe('artista@ejemplo.com', 'sub-artista');
    tiempo = new Date('2026-10-25T00:00:00Z');
    const r = await request(app).post('/license/refresh').set('Authorization', `Bearer ${sesion}`).send({ dispositivo: 'PC' }).expect(200);
    const carga = verificarLicencia(r.body.token, claves.publica, Math.floor(tiempo.getTime() / 1000));
    expect(carga.productos[PRODUCTO]).toEqual(['eq.banda']);
  });

  it('un código de dispositivo caducado no se aprueba y el poll lo marca caducado', async () => {
    await prepararEscenario();
    const start = await request(app).post('/license/device/start').send({ productoId: PRODUCTO, dispositivo: 'PC' }).expect(201);
    tiempo = new Date(tiempo.getTime() + 11 * 60 * 1000);
    const sesion = await tokenDe('artista@ejemplo.com', 'sub-artista');
    await request(app).post('/license/device/aprobar').set('Authorization', `Bearer ${sesion}`).send({ codigoUsuario: start.body.codigoUsuario }).expect(404);
    const poll = await request(app).post('/license/device/poll').send({ codigoDispositivo: start.body.codigoDispositivo, dispositivo: 'PC' });
    expect(poll.body.estado).toBe('caducado');
  });

  it('cada cambio administrativo queda en la auditoría con el actor', async () => {
    const { send, usuario } = await prepararEscenario();
    await send('put', `/admin/licencias/${usuario.id}/${PRODUCTO}`, { estado: 'revocada' }).expect(200);
    const r = await send('get', '/admin/auditoria');
    const acciones = r.body.registros.map((x: { accion: string }) => x.accion);
    expect(acciones).toEqual(expect.arrayContaining(['producto.crear', 'rol.acciones', 'licencia.estado']));
    expect(r.body.registros[0].actorId).toBe('sub-admin');
  });

  it('no se puede asignar una acción de otro producto a un rol', async () => {
    const { send, rol } = await prepararEscenario();
    await send('post', '/admin/productos', { id: 'com.jaswave.plugin.otro', nombre: 'Otro' }).expect(201);
    const otra = (await send('post', '/admin/productos/com.jaswave.plugin.otro/acciones', { clave: 'otro.x' })).body.accion;
    const r = await send('put', `/admin/roles/${rol.id}/acciones`, { accionIds: [otra.id] });
    expect(r.status).toBe(400);
  });
it('crear un producto duplicado devuelve 409, no 500', async () => {
    const { send } = await prepararEscenario();
    const r = await send('post', '/admin/productos', { id: PRODUCTO, nombre: 'Repetido' });
    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('conflicto');
  });

  it('datos inválidos devuelven 400 con detalles, no 500', async () => {
    const adminToken = await tokenDe(ADMIN, 'sub-admin');
    const r = await request(app).post('/admin/productos').set('Authorization', `Bearer ${adminToken}`).send({ id: 'X Mayúsculas', nombre: '' });
    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('datos_invalidos');
  });

  it('eliminar un producto inexistente devuelve 404', async () => {
    const { send } = await prepararEscenario();
    const r = await send('delete', '/admin/productos/com.jaswave.plugin.nada');
    expect(r.status).toBe(404);
  });
});
