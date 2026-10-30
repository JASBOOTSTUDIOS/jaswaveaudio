import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { claveDesdeJwksLocal, crearVerificadorJwt } from '../src/auth/verificador-jwt.js';
import { crearEmisorPrueba } from './jwt-local.js';

describe('B0 — API base y autenticación', () => {
  let emisor: Awaited<ReturnType<typeof crearEmisorPrueba>>;
  let app: ReturnType<typeof crearApp>;

  beforeAll(async () => {
    emisor = await crearEmisorPrueba();
    const verificar = crearVerificadorJwt({
      claves: claveDesdeJwksLocal(emisor.jwks),
      adminsIniciales: ['admin@jaswave.test'],
    });
    app = crearApp({ verificar, origenesCors: ['http://localhost:5173'] });
  });

  it('/health responde 200 sin autenticación', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('ok');
  });

  it('/me sin token devuelve 401', async () => {
    const r = await request(app).get('/me');
    expect(r.status).toBe(401);
    expect(r.body.error.codigo).toBe('no_autenticado');
  });

  it('/me con token válido devuelve la identidad', async () => {
    const token = await emisor.emitir({ sub: 'u1', email: 'Persona@Ejemplo.com' });
    const r = await request(app).get('/me').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.identidad).toMatchObject({ userId: 'u1', email: 'persona@ejemplo.com', esAdmin: false });
  });

  it('un correo de ADMIN_EMAILS obtiene esAdmin', async () => {
    const token = await emisor.emitir({ sub: 'u2', email: 'admin@jaswave.test' });
    const r = await request(app).get('/me').set('Authorization', `Bearer ${token}`);
    expect(r.body.identidad.esAdmin).toBe(true);
  });

  it('token expirado o de otro emisor se rechaza', async () => {
    const expirado = await emisor.emitir({ sub: 'u3', email: 'x@y.z', exp: Math.floor(Date.now() / 1000) - 10 });
    const r = await request(app).get('/me').set('Authorization', `Bearer ${expirado}`);
    expect(r.status).toBe(401);
  });

  it('las respuestas no se cachean (no-store, sin ETag)', async () => {
    const token = await emisor.emitir({ sub: 'u1', email: 'a@b.c' });
    const r = await request(app).get('/me').set('Authorization', `Bearer ${token}`);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers.etag).toBeUndefined();
  });

  it('ruta inexistente devuelve 404 JSON', async () => {
    const r = await request(app).get('/no-existe');
    expect(r.status).toBe(404);
  });
});
