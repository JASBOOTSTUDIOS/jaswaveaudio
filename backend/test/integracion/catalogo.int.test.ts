import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createPublicKey, verify } from 'node:crypto';
import { crearApp } from '../../src/app.js';
import { claveDesdeJwksLocal, crearVerificadorJwt } from '../../src/auth/verificador-jwt.js';
import { crearDb, type Db } from '../../src/db.js';
import { generarParClaves } from '../../src/license/token-licencia.js';
import { crearEmisorPrueba } from '../jwt-local.js';
import { URL_BD_PRUEBAS } from './preparar-bd.js';

const ADMIN = 'admin@jaswave.test';
const sha = (c: string) => c.repeat(64).slice(0, 64);

describe('D1 — catálogo firmado de paquetes de plugins', () => {
  let db: Db;
  let emisor: Awaited<ReturnType<typeof crearEmisorPrueba>>;
  let claves: ReturnType<typeof generarParClaves>;
  let app: ReturnType<typeof crearApp>;

  beforeAll(async () => {
    db = crearDb(URL_BD_PRUEBAS);
    emisor = await crearEmisorPrueba();
    claves = generarParClaves();
    const verificar = crearVerificadorJwt({ claves: claveDesdeJwksLocal(emisor.jwks), adminsIniciales: [ADMIN] });
    app = crearApp({ verificar, origenesCors: [], datos: { db, clavePrivadaPem: claves.privada, reloj: () => new Date('2026-10-23T12:00:00Z') } });
  });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "PaquetePlugin","RegistroAuditoria" CASCADE');
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const publicar = async (paquetes: object[], email = ADMIN) =>
    request(app)
      .post('/catalogo')
      .set('Authorization', `Bearer ${await emisor.emitir({ sub: 'sub-' + email, email })}`)
      .send({ paquetes });

  const eq = (version: string, s = 'a') => ({
    id: 'com.jaswave.plugin.param-eq',
    nombre: 'JasWave EQ Parametric Pro',
    version,
    url: `https://github.com/jaswave/plugins/releases/download/v${version}/param-eq.zip`,
    sha256: sha(s),
    sizeBytes: 1234,
  });

  it('el catálogo es público, va firmado y la firma verifica con la clave pública', async () => {
    await publicar([eq('1.0.0')]).then((r) => expect(r.status).toBe(200));
    const r = await request(app).get('/catalogo').expect(200);
    const [v, payload, firma] = r.body.token.split('.');
    expect(v).toBe('jwc1');
    expect(verify(null, Buffer.from(`jwc1.${payload}`), createPublicKey(claves.publica), Buffer.from(firma, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual(r.body.catalogo);
    expect(r.body.catalogo.paquetes).toHaveLength(1);
  });

  it('expone solo la última versión de cada paquete (orden semver, no alfabético)', async () => {
    await publicar([eq('1.2.0', 'b'), eq('1.10.0', 'c'), eq('1.9.3', 'd')]);
    const r = await request(app).get('/catalogo');
    expect(r.body.catalogo.paquetes.map((p: { version: string }) => p.version)).toEqual(['1.10.0']);
  });

  it('rechaza URLs no https, hashes inválidos y publicaciones de no-admins; audita las válidas', async () => {
    expect((await publicar([{ ...eq('1.0.0'), url: 'http://evil.example/x.zip' }])).status).toBe(400);
    expect((await publicar([{ ...eq('1.0.0'), sha256: 'xyz' }])).status).toBe(400);
    expect((await publicar([eq('1.0.0')], 'persona@x.com')).status).toBe(403);
    await publicar([eq('1.0.0')]);
    const auditoria = await db.registroAuditoria.findMany();
    expect(auditoria.map((a) => a.accion)).toEqual(['catalogo.publicar']);
  });
});
