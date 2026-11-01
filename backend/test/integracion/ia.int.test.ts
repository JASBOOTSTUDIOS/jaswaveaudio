import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { crearApp } from '../../src/app.js';
import { claveDesdeJwksLocal, crearVerificadorJwt } from '../../src/auth/verificador-jwt.js';
import { crearDb, type Db } from '../../src/db.js';
import { generarParClaves } from '../../src/license/token-licencia.js';
import { crearServicioIA, PRODUCTO_IA, sembrarProductoIA } from '../../src/ia/proveedores.js';
import { crearServicioJasWave } from '../../src/ia/jaswave/servicio.js';
import { claveMaestraDesdeBase64, generarClaveMaestra } from '../../src/seguridad/cifrado.js';
import { crearEmisorPrueba } from '../jwt-local.js';
import { URL_BD_PRUEBAS as URL_DB } from './preparar-bd.js';

const ADMIN = 'admin@jaswave.test';
const CLAVE_PROVEEDOR = 'sk-proveedor-super-secreta';
const CLAVE_PROPIA = 'sk-propia-del-usuario';
const CLAVE_GRUPO = 'sk-del-grupo';
/** El proveedor falso rechaza esta clave al listar modelos. */
const CLAVE_RECHAZADA = 'sk-rechazada';

/** Proveedor falso compatible con OpenAI: devuelve qué Authorization recibió. */
function proveedorFalso() {
  const recibidas: (string | undefined)[] = [];
  const servidor = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (d) => (datos += d));
    req.on('end', () => {
      recibidas.push(req.headers.authorization);
      if (req.headers.authorization === `Bearer ${CLAVE_RECHAZADA}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'clave no válida' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (!req.url?.endsWith('/chat/completions')) {
        res.end(JSON.stringify({ data: [{ id: 'modelo-a' }] }));
        return;
      }
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'respuesta del proveedor' } }] }));
    });
  });
  return { servidor, recibidas };
}

describe('M2 — proveedores de IA en BD con permisos por rol (integración)', () => {
  let db: Db;
  let emisor: Awaited<ReturnType<typeof crearEmisorPrueba>>;
  let app: ReturnType<typeof crearApp>;
  const falso = proveedorFalso();
  let baseUrl = '';

  beforeAll(async () => {
    db = crearDb(URL_DB);
    emisor = await crearEmisorPrueba();
    await new Promise<void>((ok) => falso.servidor.listen(0, '127.0.0.1', () => ok()));
    baseUrl = `http://127.0.0.1:${(falso.servidor.address() as AddressInfo).port}/v1`;
    const verificar = crearVerificadorJwt({ claves: claveDesdeJwksLocal(emisor.jwks), adminsIniciales: [ADMIN] });
    const claveMaestra = claveMaestraDesdeBase64(generarClaveMaestra());
    const ia = crearServicioIA({ db, claveMaestra });
    app = crearApp({
      verificar,
      origenesCors: [],
      ia,
      jaswave: crearServicioJasWave({ db, claveMaestra, permisos: (id) => ia.permisos(id), chat: async () => ({ ok: false, error: 'sin red' }) as never }),
      datos: { db, clavePrivadaPem: generarParClaves().privada, reloj: () => new Date() },
    });
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE "ProveedorIA","RegistroAuditoria","Concesion","AsignacionRol","RolAccion","RolProducto","Accion","Licencia","Usuario","Producto" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await db.$disconnect();
    await new Promise<void>((ok) => falso.servidor.close(() => ok()));
  });

  const admin = async () => `Bearer ${await emisor.emitir({ sub: 'sub-admin', email: ADMIN })}`;
  const usuario = async () => `Bearer ${await emisor.emitir({ sub: 'sub-u1', email: 'u1@jaswave.test' })}`;

  async function crearProveedorAdmin(slug = 'principal') {
    const r = await request(app)
      .post('/admin/ia/proveedores')
      .set('Authorization', await admin())
      .send({ slug, nombre: 'Principal', tipo: 'openai-compatible', baseUrl, modelos: ['modelo-a', 'modelo-b'], apiKey: CLAVE_PROVEEDOR });
    expect(r.status).toBe(201);
    return r.body.proveedor as { id: string; slug: string; tieneClave: boolean };
  }

  /** Rol del asistente con las acciones dadas, asignado al usuario u1 con licencia activa. */
  async function darRol(acciones: string[]) {
    await sembrarProductoIA(db); // lo hace el servidor al arrancar
    const auth = await admin();
    // El usuario se da de alta al llamar por primera vez a la API.
    await request(app).get('/ia/proveedores').set('Authorization', await usuario());
    const u = await db.usuario.findUniqueOrThrow({ where: { email: 'u1@jaswave.test' } });
    const productos = (await request(app).get('/admin/productos').set('Authorization', auth)).body.productos as {
      id: string;
      acciones: { id: string; clave: string }[];
    }[];
    const producto = productos.find((p) => p.id === PRODUCTO_IA)!;
    const rol = (await request(app).post(`/admin/productos/${PRODUCTO_IA}/roles`).set('Authorization', auth).send({ nombre: `rol-${Date.now()}` })).body.rol;
    const accionIds = producto.acciones.filter((a) => acciones.includes(a.clave)).map((a) => a.id);
    expect(accionIds).toHaveLength(acciones.length);
    await request(app).put(`/admin/roles/${rol.id}/acciones`).set('Authorization', auth).send({ accionIds }).expect(200);
    await request(app).put(`/admin/usuarios/${u.id}/roles`).set('Authorization', auth).send({ rolIds: [rol.id] }).expect(200);
    await request(app).put(`/admin/licencias/${u.id}/${PRODUCTO_IA}`).set('Authorization', auth).send({ estado: 'activa' }).expect(200);
    return { usuarioId: u.id, rolId: rol.id };
  }

  const chat = async (cuerpo: object) =>
    request(app).post('/ia/chat').set('Authorization', await usuario()).send({ messages: [{ role: 'user', content: 'hola' }], ...cuerpo });

  it('el admin crea el proveedor: la clave queda cifrada, nunca se devuelve ni se audita, y nace su acción', async () => {
    const p = await crearProveedorAdmin();
    expect(p.tieneClave).toBe(true);
    const lista = await request(app).get('/admin/ia/proveedores').set('Authorization', await admin());
    const fila = await db.proveedorIA.findUniqueOrThrow({ where: { id: p.id } });
    const auditoria = await db.registroAuditoria.findMany();
    for (const texto of [JSON.stringify(lista.body), JSON.stringify(auditoria), Buffer.from(fila.claveCifrada!).toString('utf8')]) {
      expect(texto).not.toContain(CLAVE_PROVEEDOR);
    }
    const acciones = await db.accion.findMany({ where: { productoId: PRODUCTO_IA }, orderBy: { clave: 'asc' } });
    expect(acciones.map((a) => a.clave)).toEqual(['ia.modelo-propio', 'ia.proveedor.principal', 'ia.usar']);
    // Solo administradores
    expect((await request(app).get('/admin/ia/proveedores').set('Authorization', await usuario())).status).toBe(403);
  });

  it('sin rol → 403; con ia.usar + ia.proveedor.x → chat con la clave del servidor; revocar → 403', async () => {
    await crearProveedorAdmin();
    expect((await chat({})).status).toBe(403);

    const { usuarioId } = await darRol(['ia.usar', 'ia.proveedor.principal']);
    const disp = await request(app).get('/ia/proveedores').set('Authorization', await usuario());
    expect(disp.body.permisos).toEqual({ usar: true, modeloPropio: false, proveedores: ['principal'] });
    expect(disp.body.proveedores[0].baseUrl).toBeUndefined();
    const r = await chat({ model: 'modelo-b' });
    expect(r.status).toBe(200);
    expect(r.body.content).toBe('respuesta del proveedor');
    expect(falso.recibidas.at(-1)).toBe(`Bearer ${CLAVE_PROVEEDOR}`);
    expect((await chat({ model: 'otro' })).status).toBe(400);

    await request(app).put(`/admin/licencias/${usuarioId}/${PRODUCTO_IA}`).set('Authorization', await admin()).send({ estado: 'suspendida' }).expect(200);
    expect((await chat({})).status).toBe(403);
  });

  it('ia.usar sin la acción del proveedor no basta', async () => {
    const p = await crearProveedorAdmin();
    await darRol(['ia.usar']);
    expect((await chat({ proveedorId: p.id })).status).toBe(403);
    expect((await chat({})).status).toBe(503);
  });

  it('modelos propios: sin ia.modelo-propio se rechaza; con él, SSRF bloqueado y la credencial local solo para el dueño', async () => {
    await darRol(['ia.usar']);
    const crear = async (cuerpo: object) =>
      request(app).post('/ia/mis-proveedores').set('Authorization', await usuario()).send({ nombre: 'Mío', tipo: 'ollama', modelos: ['llama3'], ...cuerpo });
    expect((await crear({ baseUrl: 'https://modelos.example.com' })).status).toBe(403);

    await darRol(['ia.usar', 'ia.modelo-propio']);
    const ssrf = await crear({ baseUrl: 'http://127.0.0.1:11434', ejecucion: 'servidor' });
    expect(ssrf.status).toBe(400);
    expect(ssrf.body.error.codigo).toBe('url_no_permitida');

    const local = await crear({ baseUrl: 'http://localhost:11434', ejecucion: 'local', apiKey: CLAVE_PROPIA });
    expect(local.status).toBe(201);
    const id = local.body.proveedor.id as string;
    expect(JSON.stringify(local.body)).not.toContain(CLAVE_PROPIA);
    // El servidor no ejecuta modelos locales
    expect((await chat({ proveedorId: id })).status).toBe(409);
    // El dueño obtiene su credencial para ejecutarla en su equipo
    const cred = await request(app).get(`/ia/mis-proveedores/${id}/credencial`).set('Authorization', await usuario());
    expect(cred.body.proveedor).toMatchObject({ apiKey: CLAVE_PROPIA, baseUrl: 'http://localhost:11434' });
    // Otro usuario (aunque sea admin) no la ve por la ruta de usuario
    expect((await request(app).get(`/ia/mis-proveedores/${id}/credencial`).set('Authorization', await admin())).status).toBe(404);
    // El admin la ve listada sin clave
    const deUsuarios = await request(app).get('/admin/ia/proveedores-usuario').set('Authorization', await admin());
    expect(deUsuarios.body.proveedores[0]).toMatchObject({ propietario: 'u1@jaswave.test', tieneClave: true });
    expect(JSON.stringify(deUsuarios.body)).not.toContain(CLAVE_PROPIA);
  });

  it('borrar el proveedor del admin elimina su acción y deja de estar disponible', async () => {
    const p = await crearProveedorAdmin();
    await darRol(['ia.usar', 'ia.proveedor.principal']);
    await request(app).delete(`/admin/ia/proveedores/${p.id}`).set('Authorization', await admin()).expect(204);
    expect(await db.accion.count({ where: { clave: 'ia.proveedor.principal' } })).toBe(0);
    expect((await chat({ proveedorId: p.id })).status).toBe(404);
  });

  it('probar conexión desde el panel admin', async () => {
    const p = await crearProveedorAdmin();
    const r = await request(app).post(`/admin/ia/proveedores/${p.id}/probar`).set('Authorization', await admin());
    expect(r.body).toMatchObject({ estado: 'healthy' });
  });

  it('probar conexión usa las claves del grupo si la principal falla', async () => {
    const auth = await admin();
    const r = await request(app)
      .post('/admin/ia/proveedores')
      .set('Authorization', auth)
      .send({ slug: 'grupo', nombre: 'Grupo', tipo: 'openai-compatible', baseUrl, modelos: ['modelo-a'], apiKey: CLAVE_RECHAZADA });
    const id = r.body.proveedor.id as string;
    await request(app).post(`/admin/ia/proveedores/${id}/claves`).set('Authorization', auth).send({ apiKey: CLAVE_GRUPO, etiqueta: 'segunda' }).expect(201);
    const probar = await request(app).post(`/admin/ia/proveedores/${id}/probar`).set('Authorization', auth);
    expect(probar.body).toMatchObject({ estado: 'healthy' });
    expect(falso.recibidas.at(-1)).toBe(`Bearer ${CLAVE_GRUPO}`);
    expect(JSON.stringify(probar.body)).not.toContain(CLAVE_GRUPO);
  });

  it('la clave principal se puede quitar desde el grupo, pero no pausar', async () => {
    const auth = await admin();
    const p = await crearProveedorAdmin();
    const claves = `/admin/ia/proveedores/${p.id}/claves`;
    const lista = await request(app).get(claves).set('Authorization', auth);
    const principal = (lista.body.claves as { id: string; principal: boolean }[]).find((k) => k.principal)!;
    expect(principal.id).toBe(`${p.id}:principal`);
    const pausar = await request(app).put(`${claves}/${principal.id}`).set('Authorization', auth).send({ activa: false });
    expect(pausar.status).toBe(400);
    expect(pausar.body.error.codigo).toBe('clave_principal');
    await request(app).delete(`${claves}/${principal.id}`).set('Authorization', auth).expect(204);
    const despues = await request(app).get(claves).set('Authorization', auth);
    expect(despues.body.claves).toEqual([]);
    expect((await request(app).put(`${claves}/no-es-id`).set('Authorization', auth).send({})).status).toBe(400);
  });
});
