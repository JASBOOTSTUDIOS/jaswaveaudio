/**
 * Prueba con un modelo real (KiloCode): proveedor dado de alta por el admin con la clave cifrada en la BD,
 * acceso por rol y chat / streaming / herramientas a través del gateway. Se omite si no hay clave
 * (IA_PRUEBAS_KILO_API_KEY en el entorno o en backend/.env, que no se sube al repositorio).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { crearApp } from '../../src/app.js';
import { claveDesdeJwksLocal, crearVerificadorJwt } from '../../src/auth/verificador-jwt.js';
import { crearDb, type Db } from '../../src/db.js';
import { generarParClaves } from '../../src/license/token-licencia.js';
import { crearServicioIA, PRODUCTO_IA, sembrarProductoIA } from '../../src/ia/proveedores.js';
import { claveMaestraDesdeBase64, generarClaveMaestra } from '../../src/seguridad/cifrado.js';
import { crearEmisorPrueba } from '../jwt-local.js';
import { URL_BD_PRUEBAS } from './preparar-bd.js';

function claveKilo(): string | undefined {
  if (process.env.IA_PRUEBAS_KILO_API_KEY) return process.env.IA_PRUEBAS_KILO_API_KEY;
  const env = resolve(__dirname, '../../.env');
  if (!existsSync(env)) return undefined;
  const m = readFileSync(env, 'utf8').match(/^IA_PRUEBAS_KILO_API_KEY="?([^"\r\n]+)"?/m);
  return m?.[1];
}

const CLAVE = claveKilo();
const MODELO = process.env.IA_PRUEBAS_MODELO || 'cohere/north-mini-code:free';
const ADMIN = 'admin@jaswave.test';

describe.skipIf(!CLAVE)('IA con modelo real (KiloCode)', () => {
  let db: Db;
  let emisor: Awaited<ReturnType<typeof crearEmisorPrueba>>;
  let app: ReturnType<typeof crearApp>;
  let proveedorId = '';

  const auth = async (email: string) => `Bearer ${await emisor.emitir({ sub: `sub-${email}`, email })}`;

  beforeAll(async () => {
    db = crearDb(URL_BD_PRUEBAS);
    emisor = await crearEmisorPrueba();
    const verificar = crearVerificadorJwt({ claves: claveDesdeJwksLocal(emisor.jwks), adminsIniciales: [ADMIN] });
    app = crearApp({
      verificar,
      origenesCors: [],
      ia: crearServicioIA({ db, claveMaestra: claveMaestraDesdeBase64(generarClaveMaestra()) }),
      datos: { db, clavePrivadaPem: generarParClaves().privada, reloj: () => new Date() },
    });
    await db.$executeRawUnsafe(
      'TRUNCATE "ProveedorIA","RegistroAuditoria","Concesion","AsignacionRol","RolAccion","RolProducto","Accion","Licencia","Usuario","Producto" RESTART IDENTITY CASCADE',
    );
    await sembrarProductoIA(db);

    // El admin da de alta el proveedor; la clave queda cifrada en la BD.
    const alta = await request(app)
      .post('/admin/ia/proveedores')
      .set('Authorization', await auth(ADMIN))
      .send({ slug: 'kilo', nombre: 'Kilo Code', tipo: 'kilocode', baseUrl: 'https://api.kilo.ai/api/gateway', modelos: [MODELO], apiKey: CLAVE });
    expect(alta.status).toBe(201);
    proveedorId = alta.body.proveedor.id;

    // Rol con ia.usar + ia.proveedor.kilo para el usuario de prueba, con licencia activa.
    const a = await auth(ADMIN);
    await request(app).get('/ia/proveedores').set('Authorization', await auth('musico@jaswave.test'));
    const u = await db.usuario.findUniqueOrThrow({ where: { email: 'musico@jaswave.test' } });
    const producto = (await request(app).get('/admin/productos').set('Authorization', a)).body.productos.find((p: { id: string }) => p.id === PRODUCTO_IA);
    const rol = (await request(app).post(`/admin/productos/${PRODUCTO_IA}/roles`).set('Authorization', a).send({ nombre: 'musico' })).body.rol;
    const accionIds = producto.acciones.filter((x: { clave: string }) => ['ia.usar', 'ia.proveedor.kilo'].includes(x.clave)).map((x: { id: string }) => x.id);
    await request(app).put(`/admin/roles/${rol.id}/acciones`).set('Authorization', a).send({ accionIds }).expect(200);
    await request(app).put(`/admin/usuarios/${u.id}/roles`).set('Authorization', a).send({ rolIds: [rol.id] }).expect(200);
    await request(app).put(`/admin/licencias/${u.id}/${PRODUCTO_IA}`).set('Authorization', a).send({ estado: 'activa' }).expect(200);
  }, 60_000);

  afterAll(async () => {
    await db?.$disconnect();
  });

  it('el usuario con rol chatea con el modelo real; la clave nunca sale del servidor', async () => {
    const r = await request(app)
      .post('/ia/chat')
      .set('Authorization', await auth('musico@jaswave.test'))
      .send({ messages: [{ role: 'user', content: 'Responde únicamente con la palabra: listo' }], maxTokens: 800 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.success, JSON.stringify(r.body)).toBe(true);
    expect(String(r.body.content).toLowerCase()).toContain('listo');
    expect(JSON.stringify(r.body)).not.toContain(CLAVE!);
  }, 90_000);

  it('streaming SSE con el modelo real', async () => {
    const r = await request(app)
      .post('/ia/chat/stream')
      .set('Authorization', await auth('musico@jaswave.test'))
      .send({ proveedorId, messages: [{ role: 'user', content: 'Cuenta del 1 al 5 separados por comas.' }], maxTokens: 800 })
      .buffer(true)
      .parse((res, cb) => {
        let t = '';
        res.on('data', (d: Buffer) => (t += d.toString()));
        res.on('end', () => cb(null, t));
      });
    const eventos = String(r.body)
      .split('\n\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)));
    const texto = eventos.filter((e) => e.type === 'delta').map((e) => e.text).join('');
    expect(eventos.at(-1), JSON.stringify(eventos.at(-1))).toMatchObject({ type: 'done', result: { success: true } });
    expect(texto).toMatch(/1.*2.*3.*4.*5/s);
  }, 90_000);

  it('herramientas nativas: el modelo pide transport.setBpm con el valor pedido', async () => {
    const r = await request(app)
      .post('/ia/chat')
      .set('Authorization', await auth('musico@jaswave.test'))
      .send({
        messages: [{ role: 'user', content: 'Pon el tempo del proyecto a 97 BPM usando la herramienta.' }],
        tools: [
          {
            name: 'transport.setBpm',
            description: 'Cambia el tempo del proyecto en BPM',
            parameters: { type: 'object', properties: { bpm: { type: 'number' } }, required: ['bpm'] },
          },
        ],
        toolChoice: 'required',
        maxTokens: 800,
      });
    expect(r.body.success, JSON.stringify(r.body)).toBe(true);
    expect(r.body.toolCalls?.[0], JSON.stringify(r.body)).toMatchObject({ name: 'transport.setBpm', arguments: { bpm: 97 } });
  }, 90_000);

  it('sin el rol, el mismo modelo se rechaza', async () => {
    const r = await request(app)
      .post('/ia/chat')
      .set('Authorization', await auth('sinrol@jaswave.test'))
      .send({ messages: [{ role: 'user', content: 'hola' }] });
    expect(r.status).toBe(403);
  });
});
