import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { crearApp } from '../../src/app.js';
import { claveDesdeJwksLocal, crearVerificadorJwt } from '../../src/auth/verificador-jwt.js';
import { crearDb, type Db } from '../../src/db.js';
import { generarParClaves } from '../../src/license/token-licencia.js';
import { crearEmisorPrueba } from '../jwt-local.js';
import { URL_BD_PRUEBAS } from './preparar-bd.js';

describe('H1 — handover web → escritorio', () => {
  let db: Db;
  let emisor: Awaited<ReturnType<typeof crearEmisorPrueba>>;
  let app: ReturnType<typeof crearApp>;
  let ahora = new Date('2026-10-23T12:00:00Z');

  beforeAll(async () => {
    db = crearDb(URL_BD_PRUEBAS);
    emisor = await crearEmisorPrueba();
    const verificar = crearVerificadorJwt({ claves: claveDesdeJwksLocal(emisor.jwks), adminsIniciales: [] });
    app = crearApp({ verificar, origenesCors: [], datos: { db, clavePrivadaPem: generarParClaves().privada, reloj: () => ahora } });
  });
  beforeEach(async () => {
    ahora = new Date('2026-10-23T12:00:00Z');
    await db.$executeRawUnsafe('TRUNCATE "TokenHandover" CASCADE');
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const crear = async (cuerpo: object) =>
    request(app)
      .post('/handover')
      .set('Authorization', `Bearer ${await emisor.emitir({ sub: 'sub-web', email: 'web@x.com' })}`)
      .send(cuerpo);

  const datos = { proyecto: { nombre: 'Demo', tracks: [] }, transporte: { posicion: 16, reproduciendo: true }, seleccion: { clips: ['c1'] } };
  const sesion = { access_token: 'a'.repeat(40), refresh_token: 'r'.repeat(20) };

  it('crea un enlace jaswave:// de un solo uso que restaura datos y sesión', async () => {
    const r = await crear({ datos, sesion });
    expect(r.status).toBe(201);
    expect(r.body.url).toBe(`jaswave://abrir?token=${r.body.token}`);
    const canje = await request(app).post('/handover/canjear').send({ token: r.body.token });
    expect(canje.status).toBe(200);
    expect(canje.body).toEqual({ datos, sesion });
    expect((await request(app).post('/handover/canjear').send({ token: r.body.token })).status).toBe(404);
  });

  it('caduca a los 60 s', async () => {
    const r = await crear({ datos });
    ahora = new Date(ahora.getTime() + 61_000);
    expect((await request(app).post('/handover/canjear').send({ token: r.body.token })).status).toBe(404);
  });

  it('en la base solo hay un hash y un blob cifrado (ni el token ni la sesión en claro)', async () => {
    const r = await crear({ datos, sesion });
    const filas = await db.tokenHandover.findMany();
    expect(filas).toHaveLength(1);
    const crudo = JSON.stringify(filas[0]) + Buffer.from(filas[0]!.cifrado).toString('latin1');
    expect(crudo).not.toContain(r.body.token);
    expect(crudo).not.toContain(sesion.refresh_token);
    expect(crudo).not.toContain('Demo');
  });

  it('acepta proyectos grandes (> 256 KB) y exige sesión para crear', async () => {
    const grande = { proyecto: { notas: 'x'.repeat(1_000_000) } };
    expect((await crear({ datos: grande })).status).toBe(201);
    expect((await request(app).post('/handover').send({ datos })).status).toBe(401);
  });

  it('dos canjes simultáneos: solo uno obtiene los datos', async () => {
    const r = await crear({ datos });
    const [a, b] = await Promise.all([
      request(app).post('/handover/canjear').send({ token: r.body.token }),
      request(app).post('/handover/canjear').send({ token: r.body.token }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
  });
});
