import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { crearApp } from '../../src/app.js';
import { claveDesdeJwksLocal, crearVerificadorJwt } from '../../src/auth/verificador-jwt.js';
import { crearDb, type Db } from '../../src/db.js';
import { generarParClaves, verificarLicencia } from '../../src/license/token-licencia.js';
import { crearEmisorPrueba } from '../jwt-local.js';
import { URL_BD_PRUEBAS } from './preparar-bd.js';

const PRODUCTO = 'com.jaswave.plugin.param-eq';
const ADMIN = 'admin@jaswave.test';

describe('L1 — renovación por token de dispositivo (VST sin sesión)', () => {
  let db: Db;
  let emisor: Awaited<ReturnType<typeof crearEmisorPrueba>>;
  let claves: ReturnType<typeof generarParClaves>;
  let app: ReturnType<typeof crearApp>;
  const tiempo = new Date('2026-10-23T12:00:00Z');

  beforeAll(async () => {
    db = crearDb(URL_BD_PRUEBAS);
    emisor = await crearEmisorPrueba();
    claves = generarParClaves();
    const verificar = crearVerificadorJwt({ claves: claveDesdeJwksLocal(emisor.jwks), adminsIniciales: [ADMIN] });
    app = crearApp({ verificar, origenesCors: [], datos: { db, clavePrivadaPem: claves.privada, reloj: () => tiempo } });
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE "RegistroAuditoria","Concesion","AsignacionRol","RolAccion","RolProducto","Accion","Licencia","Dispositivo","CodigoDispositivo","Usuario","Producto" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Usuario con licencia activa y una acción; devuelve el token de dispositivo obtenido por device-code. */
  async function activarDispositivo() {
    const admin = await emisor.emitir({ sub: 'sub-admin', email: ADMIN });
    const send = (m: 'post' | 'put', ruta: string, cuerpo: object) =>
      request(app)[m](ruta).set('Authorization', `Bearer ${admin}`).send(cuerpo);
    await send('post', '/admin/productos', { id: PRODUCTO, nombre: 'EQ' }).expect(201);
    const acc = (await send('post', `/admin/productos/${PRODUCTO}/acciones`, { clave: 'eq.bandas' })).body.accion;
    const usuario = (await send('post', '/admin/usuarios', { email: 'artista@x.com' })).body.usuario;
    await send('put', `/admin/usuarios/${usuario.id}/concesiones`, { accionId: acc.id, efecto: 'allow' }).expect(200);
    await send('put', `/admin/licencias/${usuario.id}/${PRODUCTO}`, { estado: 'activa' }).expect(200);

    const start = await request(app).post('/license/device/start').send({ productoId: PRODUCTO, dispositivo: 'Reaper' }).expect(201);
    const sesion = await emisor.emitir({ sub: 'sub-artista', email: 'artista@x.com' });
    await request(app).post('/license/device/aprobar').set('Authorization', `Bearer ${sesion}`).send({ codigoUsuario: start.body.codigoUsuario }).expect(200);
    const poll = await request(app).post('/license/device/poll').send({ codigoDispositivo: start.body.codigoDispositivo, dispositivo: 'Reaper' }).expect(200);
    expect(poll.body.estado).toBe('aprobado');
    expect(typeof poll.body.tokenDispositivo).toBe('string');
    return { send, usuario, sesion, t0: poll.body.tokenDispositivo as string };
  }

  const renovar = (token: string) => request(app).post('/license/device/renovar').send({ tokenDispositivo: token, dispositivo: 'Reaper' });

  it('renovar con el token entrega licencia válida y rota el token', async () => {
    const { t0 } = await activarDispositivo();
    const r = await renovar(t0).expect(200);
    const carga = verificarLicencia(r.body.token, claves.publica, Math.floor(tiempo.getTime() / 1000));
    expect(carga.productos[PRODUCTO]).toEqual(['eq.bandas']);
    expect(r.body.tokenDispositivo).not.toBe(t0);
  });

  it('el token anterior vale una sola vez (gracia por respuesta perdida) y luego se rechaza', async () => {
    const { t0 } = await activarDispositivo();
    await renovar(t0).expect(200); // t0 → t1 (t1 nunca llegó al cliente)
    await renovar(t0).expect(200); // gracia: t0 sigue valiendo una vez → t2
    const tercera = await renovar(t0);
    expect(tercera.status).toBe(401);
    expect(tercera.body.error.codigo).toBe('dispositivo_revocado');
  });

  it('un dispositivo revocado por el admin no puede renovar', async () => {
    const { send, usuario, t0 } = await activarDispositivo();
    const lista = await request(app).get(`/admin/usuarios/${usuario.id}/dispositivos`).set('Authorization', `Bearer ${await emisor.emitir({ sub: 'sub-admin', email: ADMIN })}`);
    expect(lista.body.dispositivos).toHaveLength(1);
    await send('put', `/admin/dispositivos/${lista.body.dispositivos[0].id}`, { revocado: true }).expect(200);
    expect((await renovar(t0)).status).toBe(401);
  });

  it('con la licencia suspendida la renovación da 403 y NO rota el token', async () => {
    const { send, usuario, t0 } = await activarDispositivo();
    await send('put', `/admin/licencias/${usuario.id}/${PRODUCTO}`, { estado: 'suspendida' }).expect(200);
    expect((await renovar(t0)).status).toBe(403);
    await send('put', `/admin/licencias/${usuario.id}/${PRODUCTO}`, { estado: 'activa' }).expect(200);
    await renovar(t0).expect(200); // el mismo token sigue siendo válido
  });

  it('el DAW con sesión registra el equipo sin token y rota el suyo si lo envía', async () => {
    const { sesion } = await activarDispositivo();
    const a = await request(app).post('/license/refresh').set('Authorization', `Bearer ${sesion}`).send({ dispositivo: 'Estudio' }).expect(200);
    const b = await request(app).post('/license/refresh').set('Authorization', `Bearer ${sesion}`).send({ dispositivo: 'Estudio', tokenDispositivo: a.body.tokenDispositivo }).expect(200);
    expect(b.body.tokenDispositivo).not.toBe(a.body.tokenDispositivo);
    expect(await db.dispositivo.count()).toBe(2); // Reaper (device-code) + Estudio
  });

  it('en BD solo se guardan hashes, nunca el token en claro', async () => {
    const { t0 } = await activarDispositivo();
    const filas = await db.dispositivo.findMany();
    expect(JSON.stringify(filas)).not.toContain(t0);
  });
});
