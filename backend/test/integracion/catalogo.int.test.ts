import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createHash, createPublicKey, verify } from 'node:crypto';
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

  describe('M3 — módulos del DAW para la web', () => {
    const modulo = (version = '1.0.0') => ({
      id: 'com.jaswave.modulo.midi-md',
      nombre: 'MIDI · Markdown',
      version,
      url: `https://github.com/jaswave/plugins/releases/download/v${version}/midi-md.zip`,
      sha256: sha('e'),
      sizeBytes: 999,
      categoria: 'ui-extension',
      plataformas: ['win-x64', 'web'],
      descripcion: 'Clip MIDI como Markdown',
      ui: 'dist/modulo.js',
      uiEstilos: 'dist/modulo.css',
    });
    const subir = async (archivos: { ruta: string; contenido: string }[], email = ADMIN, version = '1.0.0') =>
      request(app)
        .post(`/catalogo/modulos/com.jaswave.modulo.midi-md/${version}/archivos`)
        .set('Authorization', `Bearer ${await emisor.emitir({ sub: 'sub-' + email, email })}`)
        .send({ archivos: archivos.map((a) => ({ ruta: a.ruta, contenido: Buffer.from(a.contenido).toString('base64') })) });
    const JS = 'export default { id: "com.jaswave.modulo.midi-md" }'

    it('se publica el módulo y sus archivos; el catálogo firmado lleva entradas y hashes; se sirven con caché inmutable y CORP', async () => {
      await publicar([modulo()]).then((r) => expect(r.status).toBe(200));
      const r = await subir([
        { ruta: 'dist/modulo.js', contenido: JS },
        { ruta: 'dist/modulo.css', contenido: '.x{}' },
      ]);
      expect(r.status).toBe(200);
      const cat = (await request(app).get('/catalogo')).body.catalogo.paquetes[0];
      expect(cat).toMatchObject({ categoria: 'ui-extension', plataformas: ['win-x64', 'web'], ui: 'dist/modulo.js', uiEstilos: 'dist/modulo.css' });
      expect(cat.archivos['dist/modulo.js']).toBe(createHash('sha256').update(JS).digest('hex'));
      const js = await request(app).get('/modulos/com.jaswave.modulo.midi-md/1.0.0/dist/modulo.js');
      expect(js.status).toBe(200);
      expect(js.headers['content-type']).toContain('text/javascript');
      expect(js.headers['cache-control']).toContain('immutable');
      expect(js.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(js.text).toBe(JS);
    });

    it('una versión publicada es inmutable; solo admin publica; tipos y rutas peligrosas se rechazan', async () => {
      await publicar([modulo()]);
      await subir([{ ruta: 'dist/modulo.js', contenido: JS }]).then((r) => expect(r.status).toBe(200));
      expect((await subir([{ ruta: 'dist/modulo.js', contenido: JS + ';' }])).status).toBe(409);
      expect((await subir([{ ruta: 'dist/modulo.js', contenido: JS }], 'otro@jaswave.test')).status).toBe(403);
      expect((await subir([{ ruta: 'dist/modulo.js', contenido: JS }, { ruta: 'dist/x.exe', contenido: 'MZ' }])).status).toBe(400);
      expect((await subir([{ ruta: '../escape.js', contenido: JS }])).status).toBe(400);
      expect((await request(app).get('/modulos/com.jaswave.modulo.midi-md/1.0.0/..%2F..%2Fetc')).status).toBe(404);
      expect((await request(app).get('/modulos/com.jaswave.modulo.midi-md/9.9.9/dist/modulo.js')).status).toBe(404);
    });

    it('un plugin VST sin entrypoints.ui no admite archivos web', async () => {
      await publicar([eq('1.0.0')]);
      const r = await request(app)
        .post('/catalogo/modulos/com.jaswave.plugin.param-eq/1.0.0/archivos')
        .set('Authorization', `Bearer ${await emisor.emitir({ sub: 'sub-a', email: ADMIN })}`)
        .send({ archivos: [{ ruta: 'dist/modulo.js', contenido: 'eA==' }] });
      expect(r.status).toBe(400);
    });
  });

  describe('X1 — firma de paquetes .jwx', () => {
    const firmar = async (cuerpo: object, email = ADMIN) =>
      request(app)
        .post('/catalogo/firmar-paquete')
        .set('Authorization', `Bearer ${await emisor.emitir({ sub: 'sub-' + email, email })}`)
        .send(cuerpo);
    const archivos = {
      'jaswave-plugin.json': sha('1'),
      'vst3/JasWave Utility.vst3/Contents/x86_64-win/JasWave Utility.vst3': sha('2'),
      'dist/chunks/a.js': sha('3'),
    };

    it('el admin obtiene jaswave-firma.json; la firma verifica con la clave pública y queda auditada', async () => {
      const r = await firmar({ id: 'com.jaswave.plugin.utility-tool', version: '1.2.0', archivos });
      expect(r.status).toBe(200);
      const f = r.body.firma;
      expect(f).toMatchObject({ version: 1, id: 'com.jaswave.plugin.utility-tool', versionPaquete: '1.2.0', archivos });
      const ordenados = Object.fromEntries(Object.keys(archivos).sort().map((k) => [k, archivos[k as keyof typeof archivos]]));
      const mensaje = Buffer.from(`jwx1.${JSON.stringify({ id: f.id, version: '1.2.0', archivos: ordenados })}`);
      expect(verify(null, mensaje, createPublicKey(claves.publica), Buffer.from(f.firma, 'base64url'))).toBe(true);
      const audit = await db.registroAuditoria.findFirst({ where: { accion: 'catalogo.firmar-paquete' } });
      expect(audit?.objetivo).toBe('com.jaswave.plugin.utility-tool@1.2.0');
    });

    it('solo admin; rechaza rutas peligrosas, hashes inválidos, firmar la propia firma o sin manifiesto', async () => {
      expect((await firmar({ id: 'com.jaswave.plugin.x', version: '1.0.0', archivos }, 'musico@jaswave.test')).status).toBe(403);
      for (const malos of [
        { ...archivos, '../fuera.dll': sha('4') },
        { ...archivos, '/abs.dll': sha('4') },
        { ...archivos, 'dist/x.js': 'no-es-hash' },
        { ...archivos, 'jaswave-firma.json': sha('4') },
        { 'dist/a.js': sha('4') },
      ]) {
        expect((await firmar({ id: 'com.jaswave.plugin.utility-tool', version: '1.0.0', archivos: malos })).status).toBe(400);
      }
    });
  });
});
