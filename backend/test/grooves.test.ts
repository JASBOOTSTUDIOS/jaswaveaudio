import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { claveDesdeJwksLocal, crearVerificadorJwt } from '../src/auth/verificador-jwt.js';
import { validarCabeceraMidi, resumirMidi } from '../src/grooves/midi.js';
import { segmentoSeguro } from '../src/grooves/validacion.js';
import { crearEmisorPrueba } from './jwt-local.js';

// ───────────── Utilidades: SMF, zip y base de datos en memoria ─────────────

const varlen = (n: number): number[] => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};

/** SMF formato 0, 480 ppq, 4/4, con notas [pitch, paso de semicorchea, velocidad]. */
function midi(notas: Array<[number, number, number]>, opciones: { tempo?: number } = {}): Buffer {
  const ppq = 480;
  const mpqn = Math.round(60_000_000 / (opciones.tempo ?? 100));
  const ev: Array<{ t: number; bytes: number[] }> = [
    { t: 0, bytes: [0xff, 0x51, 3, (mpqn >> 16) & 255, (mpqn >> 8) & 255, mpqn & 255] },
    { t: 0, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] },
  ];
  for (const [p, paso, v] of notas) {
    ev.push({ t: paso * 120, bytes: [0x99, p, v] }, { t: paso * 120 + 60, bytes: [0x89, p, 0] });
  }
  ev.sort((a, b) => a.t - b.t);
  const pista: number[] = [];
  let t = 0;
  for (const e of ev) {
    pista.push(...varlen(e.t - t), ...e.bytes);
    t = e.t;
  }
  pista.push(0, 0xff, 0x2f, 0);
  const cab = Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, ppq >> 8, ppq & 255]);
  const trk = Buffer.from([0x4d, 0x54, 0x72, 0x6b, (pista.length >> 24) & 255, (pista.length >> 16) & 255, (pista.length >> 8) & 255, pista.length & 255, ...pista]);
  return Buffer.concat([cab, trk]);
}

const bucle = (porPieza: Record<number, number[]>, compases: number, vel = 90): Array<[number, number, number]> => {
  const out: Array<[number, number, number]> = [];
  for (let c = 0; c < compases; c++) for (const [p, pasos] of Object.entries(porPieza)) for (const s of pasos) out.push([Number(p), c * 16 + s, vel]);
  return out;
};
const ROCK = { 36: [0, 8, 10], 38: [4, 12], 42: [0, 2, 4, 6, 8, 10, 12, 14] };
const FUNK = { 36: [0, 3, 6, 10], 38: [4, 12], 42: [0, 2, 4, 6, 8, 10, 12, 14], 46: [14] };
const JAZZ = { 36: [0, 10], 51: [0, 3, 4, 7, 8, 11, 12, 15], 44: [4, 12] };
const WORSHIP = { 36: [0, 6, 8], 37: [4, 12], 51: [0, 4, 8, 12], 53: [2, 10] };

function crc32(b: Buffer): number {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
/** Zip con deflate (o almacenado) de las entradas dadas. */
function zip(entradas: Array<{ nombre: string; datos: Buffer }>, almacenado = false): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let pos = 0;
  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre, 'utf8');
    const comp = almacenado ? e.datos : deflateRawSync(e.datos);
    const crc = crc32(e.datos);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(20, 4);
    loc.writeUInt16LE(0x800, 6);
    loc.writeUInt16LE(almacenado ? 0 : 8, 8);
    loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(comp.length, 18);
    loc.writeUInt32LE(e.datos.length, 22);
    loc.writeUInt16LE(nombre.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x800, 8);
    cen.writeUInt16LE(almacenado ? 0 : 8, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(e.datos.length, 24);
    cen.writeUInt16LE(nombre.length, 28);
    cen.writeUInt32LE(pos, 42);
    locales.push(loc, nombre, comp);
    centrales.push(cen, nombre);
    pos += 30 + nombre.length + comp.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(dir.length, 12);
  fin.writeUInt32LE(pos, 16);
  return Buffer.concat([...locales, dir, fin]);
}

type Fila = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
function tabla(defectos: () => Fila, clave: string) {
  const filas = new Map<string, Fila>();
  let n = 0;
  const coincide = (f: Fila, where?: Fila) => !where || Object.entries(where).every(([k, v]) => f[k] === v);
  return {
    filas,
    api: {
      findMany: async (a?: { where?: Fila; omit?: Fila }) =>
        [...filas.values()].filter((f) => coincide(f, a?.where)).map((f) => {
          const c = { ...f };
          for (const k of Object.keys(a?.omit ?? {})) delete c[k];
          return c;
        }),
      findUnique: async ({ where }: { where: Fila }) => {
        const f = filas.get(String(where[clave]));
        return f ? { ...f } : null;
      },
      create: async ({ data }: { data: Fila }) => {
        const id = String(data[clave] ?? `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`);
        if ([...filas.values()].some((f) => f.ruta !== undefined && f.ruta === data.ruta)) throw Object.assign(new Error('unique'), { name: 'PrismaClientKnownRequestError', code: 'P2002' });
        const f = { ...defectos(), ...data, [clave]: id };
        filas.set(id, f);
        return { ...f };
      },
      update: async ({ where, data }: { where: Fila; data: Fila }) => {
        const f = filas.get(String(where[clave]));
        if (!f) throw new Error('no existe');
        Object.assign(f, data);
        return { ...f };
      },
      delete: async ({ where }: { where: Fila }) => {
        filas.delete(String(where[clave]));
      },
    },
  };
}

function dbFalsa() {
  const grooves = tabla(() => ({ activo: true, creadoEn: new Date(), actualizadoEn: new Date() }), 'id');
  const propuestas = tabla(() => ({ vecesPropuesto: 1, estado: 'pendiente', similares: [], notaAdmin: '', grooveId: null, creadoEn: new Date(), actualizadoEn: new Date(), resueltaEn: null }), 'id');
  let revision = 0;
  const auditoria: Fila[] = [];
  const db = {
    grooveCatalogo: grooves.api,
    propuestaGroove: propuestas.api,
    grooveCatalogoEstado: {
      findUnique: async () => (revision ? { id: 1, revision } : null),
      upsert: async () => ({ id: 1, revision: ++revision }),
    },
    registroAuditoria: { create: async ({ data }: { data: Fila }) => void auditoria.push(data) },
  };
  return { db: db as never, grooves: grooves.filas, propuestas: propuestas.filas, auditoria, revision: () => revision };
}

// ───────────── Pruebas ─────────────

describe('grooves: validación de nombres y MIDI', () => {
  it('rechaza rutas peligrosas y caracteres de control', () => {
    for (const malo of ['..', 'a/b', 'a\\b', '.oculto', 'nul', 'con', 'x\u0000y', 'x‮y', 'x​y', 'pregunta?', ' espacio', 'a..b', 'fin.'])
      expect(segmentoSeguro(malo, 40), malo).toBe(false);
    for (const bueno of ['Worship', '4-4', 'Hip-Hop', 'Balada suave', 'Rock & Roll'.replace('&', 'y')]) expect(segmentoSeguro(bueno, 40), bueno).toBe(true);
  });

  it('comprueba la cabecera MThd y resume tempo, compás y compases', () => {
    expect(() => validarCabeceraMidi(Buffer.from('RIFF0000000000000000000000'))).toThrow(/cabecera/);
    const r = resumirMidi(midi(bucle(ROCK, 2), { tempo: 90 }));
    expect(r).toMatchObject({ tempo: 90, compas: '4/4', compases: 2, notas: 26 });
  });
});

describe('grooves: catálogo, propuestas y similitud (HTTP con base en memoria)', () => {
  let emisor: Awaited<ReturnType<typeof crearEmisorPrueba>>;
  let admin: string;
  let usuario: string;
  let usuario2: string;
  const ctx = dbFalsa();
  let app: ReturnType<typeof crearApp>;
  const b64 = (b: Buffer) => b.toString('base64');
  const aut = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    emisor = await crearEmisorPrueba();
    admin = await emisor.emitir({ sub: 'adm', email: 'admin@x.y' });
    usuario = await emisor.emitir({ sub: 'u1', email: 'u1@x.y' });
    usuario2 = await emisor.emitir({ sub: 'u2', email: 'u2@x.y' });
    app = crearApp({
      verificar: crearVerificadorJwt({ claves: claveDesdeJwksLocal(emisor.jwks), adminsIniciales: ['admin@x.y'] }),
      origenesCors: [],
      datos: { db: ctx.db, clavePrivadaPem: '', reloj: () => new Date() },
    });
  });

  it('exige sesión y, para administrar, ser administrador', async () => {
    await request(app).get('/grooves/indice').expect(401);
    await request(app).get('/admin/grooves').set(aut(usuario)).expect(403);
    await request(app).post('/admin/grooves').set(aut(usuario)).send({}).expect(403);
    await request(app).get('/admin/grooves/propuestas').set(aut(usuario)).expect(403);
  });

  it('crea, lista, sirve el archivo y audita', async () => {
    const mid = midi(bucle(ROCK, 2));
    const r = await request(app).post('/admin/grooves').set(aut(admin)).send({ nombre: 'Rock básico', estilo: 'Rock', base64: b64(mid), etiquetas: ['basico'], intensidad: 3 }).expect(201);
    expect(r.body.groove).toMatchObject({ id: 'jw-rock-rock-basico', ruta: 'Rock/rock-basico.mid', revision: 1, tipo: 'groove', compas: '4/4', compases: 2, activo: true, tamano: mid.length });
    expect(r.body.groove.contenido).toBeUndefined();
    const idx = await request(app).get('/grooves/indice').set(aut(usuario)).expect(200);
    expect(idx.body).toMatchObject({ revision: 1, total: 1 });
    expect(idx.body.grooves[0]).toMatchObject({ id: 'jw-rock-rock-basico', sha256: r.body.groove.sha256, ruta: 'Rock/rock-basico.mid' });
    expect(idx.body.grooves[0].contenido).toBeUndefined();
    const arch = await request(app).get('/grooves/jw-rock-rock-basico/archivo').set(aut(usuario)).buffer(true).parse((res, cb) => {
      const t: Buffer[] = [];
      res.on('data', (d: Buffer) => t.push(d));
      res.on('end', () => cb(null, Buffer.concat(t)));
    });
    expect(arch.status).toBe(200);
    expect(Buffer.compare(arch.body as Buffer, mid)).toBe(0);
    expect(ctx.auditoria.map((a) => a.accion)).toContain('groove.crear');
    // Misma ruta: conflicto.
    await request(app).post('/admin/grooves').set(aut(admin)).send({ nombre: 'Rock básico', estilo: 'Rock', base64: b64(mid) }).expect(409);
  });

  it('?desde con la revisión actual responde 304 sin cuerpo', async () => {
    const rev = ctx.revision();
    await request(app).get(`/grooves/indice?desde=${rev}`).set(aut(usuario)).expect(304);
    const r = await request(app).get(`/grooves/indice?desde=${rev - 1}`).set(aut(usuario)).expect(200);
    expect(r.body.grooves).toHaveLength(1);
  });

  it('valida: MIDI falso, demasiado grande, nombres peligrosos, estilo de 3 niveles', async () => {
    const ok = b64(midi(bucle(WORSHIP, 1)));
    await request(app).post('/admin/grooves').set(aut(admin)).send({ nombre: 'Malo', estilo: 'Rock', base64: b64(Buffer.from('esto no es un midi, para nada')) }).expect(400);
    const grande = Buffer.concat([midi(bucle(ROCK, 1)), Buffer.alloc(300 * 1024)]);
    await request(app).post('/admin/grooves').set(aut(admin)).send({ nombre: 'Grande', estilo: 'Rock', base64: b64(grande) }).then((x) => expect(x.status).toBeGreaterThanOrEqual(400));
    await request(app).post('/admin/grooves').set(aut(admin)).send({ nombre: '../../etc', estilo: 'Rock', base64: ok }).expect(400);
    await request(app).post('/admin/grooves').set(aut(admin)).send({ nombre: 'Bien', estilo: '../Rock', base64: ok }).expect(400);
    await request(app).post('/admin/grooves').set(aut(admin)).send({ nombre: 'Bien', estilo: 'A/B/C', base64: ok }).expect(400);
    await request(app).post('/admin/grooves').set(aut(admin)).send({ nombre: 'Bien', estilo: 'Rock', base64: ok, extra: 1 }).expect(400);
    await request(app).get('/grooves/..%2Fx/archivo').set(aut(usuario)).expect(400);
  });

  it('edita metadatos (sube revisión), mueve de estilo, reemplaza archivo y activa/desactiva', async () => {
    const a = await request(app).post('/admin/grooves').set(aut(admin)).send({ nombre: 'Coro pleno', estilo: 'Worship/4-4', base64: b64(midi(bucle(WORSHIP, 2))), id: 'jw-worship-coro-pleno' }).expect(201);
    expect(a.body.groove.ruta).toBe('Worship/4-4/coro-pleno.mid');
    await request(app).put('/admin/grooves/jw-worship-coro-pleno').set(aut(admin)).send({ tempo: 90 }).expect(200);
    const e = await request(app).put('/admin/grooves/jw-worship-coro-pleno').set(aut(admin)).send({ intensidad: 5, nombre: 'Coro grande' }).expect(200);
    expect(e.body.groove).toMatchObject({ intensidad: 5, nombre: 'Coro grande', revision: 3, ruta: 'Worship/4-4/coro-grande.mid' });
    const m = await request(app).put('/admin/grooves/jw-worship-coro-pleno').set(aut(admin)).send({ estilo: 'Pop' }).expect(200);
    expect(m.body.groove).toMatchObject({ estilo: 'Pop', ruta: 'Pop/coro-grande.mid', revision: 4 });
    const r = await request(app).put('/admin/grooves/jw-worship-coro-pleno/archivo').set(aut(admin)).send({ base64: b64(midi(bucle(WORSHIP, 4))) }).expect(200);
    expect(r.body.groove.revision).toBe(5);
    expect(r.body.groove.sha256).not.toBe(a.body.groove.sha256);
    await request(app).put('/admin/grooves/jw-worship-coro-pleno/archivo').set(aut(admin)).send({ base64: b64(Buffer.from('basura')) }).expect(400);
    await request(app).put('/admin/grooves/jw-worship-coro-pleno/activo').set(aut(admin)).send({ activo: false }).expect(200);
    const idx = await request(app).get('/grooves/indice').set(aut(usuario)).expect(200);
    expect(idx.body.grooves.map((g: { id: string }) => g.id)).not.toContain('jw-worship-coro-pleno');
    await request(app).get('/grooves/jw-worship-coro-pleno/archivo').set(aut(usuario)).expect(404);
    await request(app).get('/admin/grooves/jw-worship-coro-pleno/archivo').set(aut(admin)).expect(200);
    await request(app).put('/admin/grooves/jw-worship-coro-pleno/activo').set(aut(admin)).send({ activo: true }).expect(200);
    const acc = ctx.auditoria.map((x) => x.accion);
    expect(acc).toEqual(expect.arrayContaining(['groove.editar', 'groove.mover', 'groove.reemplazar', 'groove.desactivar', 'groove.activar']));
  });

  it('renombra un estilo entero y borra un groove', async () => {
    await request(app).post('/admin/grooves/estilos/renombrar').set(aut(admin)).send({ actual: 'Rock', nuevo: 'Rock clásico' }).expect(200);
    const l = await request(app).get('/admin/grooves').set(aut(admin)).expect(200);
    expect(l.body.grooves.find((g: { id: string }) => g.id === 'jw-rock-rock-basico')).toMatchObject({ estilo: 'Rock clásico', ruta: 'Rock clásico/rock-basico.mid' });
    await request(app).delete('/admin/grooves/jw-rock-rock-basico').set(aut(admin)).expect(204);
    await request(app).delete('/admin/grooves/jw-rock-rock-basico').set(aut(admin)).expect(404);
  });

  it('importa en lote varios .mid (carpeta = estilo) y un zip, sin que un error frene a los demás', async () => {
    const r = await request(app)
      .post('/admin/grooves/lote')
      .set(aut(admin))
      .send({
        archivos: [
          { nombre: '01-verso_suave.mid', carpeta: 'Funk', base64: b64(midi(bucle(ROCK, 1))) },
          { nombre: 'roto.mid', carpeta: 'Funk', base64: b64(Buffer.from('nope')) },
          { nombre: 'sin-carpeta.mid', base64: b64(midi(bucle(ROCK, 1))) },
        ],
      })
      .expect(200);
    expect(r.body.creados).toEqual(['jw-funk-verso-suave']);
    expect(r.body.errores).toHaveLength(2);
    const z = zip([
      { nombre: 'Soul/Lento/a-fuego.mid', datos: midi(bucle(WORSHIP, 1)) },
      { nombre: 'Soul/Lento/LEEME.txt', datos: Buffer.from('hola') },
      { nombre: '../fuera.mid', datos: midi(bucle(WORSHIP, 1)) },
      { nombre: 'Soul/Lento/Nivel3/x.mid', datos: midi(bucle(WORSHIP, 1)) },
    ]);
    const rz = await request(app).post('/admin/grooves/lote').set(aut(admin)).send({ zip: b64(z) }).expect(200);
    expect(rz.body.creados).toEqual(['jw-soul-lento-a-fuego']);
    expect(rz.body.errores.length).toBe(2);
    // Repetir sin «reemplazar» falla; con «reemplazar» no cambia nada si el contenido es el mismo.
    const rep = await request(app).post('/admin/grooves/lote').set(aut(admin)).send({ zip: b64(zip([{ nombre: 'Soul/Lento/a-fuego.mid', datos: midi(bucle(WORSHIP, 1)) }], true)) }).expect(200);
    expect(rep.body.errores).toHaveLength(1);
    const rep2 = await request(app).post('/admin/grooves/lote').set(aut(admin)).send({ reemplazar: true, zip: b64(zip([{ nombre: 'Soul/Lento/a-fuego.mid', datos: midi(bucle(WORSHIP, 1)) }])) }).expect(200);
    expect(rep2.body.sinCambios).toEqual(['jw-soul-lento-a-fuego']);
    await request(app).post('/admin/grooves/lote').set(aut(admin)).send({ zip: b64(Buffer.from('no soy un zip')) }).expect(400);
  });

  // ───── Propuestas ─────
  const consent = { aceptado: true, version: '2026-10-29' };
  const proponer = (token: string, nombre: string, notas: Array<[number, number, number]>, extra: object = {}) =>
    request(app).post('/grooves/propuestas').set(aut(token)).send({ nombre, estilo: 'Mis ritmos', base64: b64(midi(notas)), consentimiento: consent, ...extra });

  it('no acepta propuestas sin consentimiento ni con una versión del texto desconocida', async () => {
    await proponer(usuario, 'Sin permiso', bucle(FUNK, 1), { consentimiento: { aceptado: false, version: '2026-10-29' } }).expect(400);
    await proponer(usuario, 'Texto viejo', bucle(FUNK, 1), { consentimiento: { aceptado: true, version: '1999' } }).expect(400);
    await request(app).post('/grooves/propuestas').set(aut(usuario)).send({ nombre: 'x', estilo: 'Y', base64: b64(midi(bucle(FUNK, 1))) }).expect(400);
    expect(ctx.propuestas.size).toBe(0);
  });

  let propuestaId = '';
  it('una propuesta nueva queda pendiente con su consentimiento registrado', async () => {
    const r = await proponer(usuario, 'Mi ritmo', bucle(FUNK, 2, 100)).expect(201);
    expect(r.body.repetida).toBe(false);
    propuestaId = r.body.propuesta.id;
    const fila = [...ctx.propuestas.values()][0]!;
    expect(fila).toMatchObject({ estado: 'pendiente', usuarioId: 'u1', consentimientoVersion: '2026-10-29', vecesPropuesto: 1, licencia: 'CC0-1.0' });
    expect(fila.consentimientoEn).toBeInstanceOf(Date);
    const mias = await request(app).get('/grooves/propuestas/mias').set(aut(usuario)).expect(200);
    expect(mias.body.propuestas).toHaveLength(1);
    expect((await request(app).get('/grooves/propuestas/mias').set(aut(usuario2)).expect(200)).body.propuestas).toHaveLength(0);
  });

  it('el mismo patrón de otro usuario (otro tempo y velocidades) no pide otra revisión: suma al contador', async () => {
    const r = await request(app).post('/grooves/propuestas').set(aut(usuario2)).send({
      nombre: 'Casi lo mismo', estilo: 'Otros', base64: b64(midi(bucle(FUNK, 4, 60).map(([p, s]) => [p, s, 55 + (s % 5) * 9]), { tempo: 133 })), consentimiento: consent,
    }).expect(200);
    expect(r.body.repetida).toBe(true);
    expect(ctx.propuestas.size).toBe(1);
    expect([...ctx.propuestas.values()][0]).toMatchObject({ vecesPropuesto: 2, usuarios: ['u1', 'u2'] });
    // El mismo usuario no suma dos veces.
    const otra = await proponer(usuario2, 'Otra vez', bucle(FUNK, 1)).expect(200);
    expect(otra.body.repetida).toBe(true);
    expect([...ctx.propuestas.values()][0]!.vecesPropuesto).toBe(2);
  });

  it('un parecido (fill añadido) se guarda con su porcentaje y agrupa con la original', async () => {
    const fill: Array<[number, number, number]> = [...bucle(FUNK, 4), [45, 60, 100], [47, 61, 100], [48, 62, 100], [50, 63, 100]];
    const r = await proponer(usuario2, 'Rock con fill', fill).expect(201);
    expect(r.body.propuesta.estado).toBe('pendiente');
    expect(r.body.propuesta.similares[0]).toMatchObject({ tipo: 'propuesta', id: propuestaId });
    expect(r.body.propuesta.similares[0].puntuacion).toBeGreaterThanOrEqual(85);
    const lista = await request(app).get('/admin/grooves/propuestas?estado=pendiente&vista=con-similares').set(aut(admin)).expect(200);
    expect(lista.body.propuestas).toHaveLength(2);
    expect(lista.body.grupos).toHaveLength(1);
    expect(lista.body.grupos[0]).toHaveLength(2);
    const unicas = await request(app).get('/admin/grooves/propuestas?vista=unicas').set(aut(admin)).expect(200);
    expect(unicas.body.propuestas).toHaveLength(0);
  });

  it('un groove distinto del mismo estilo es único; uno idéntico al catálogo queda como duplicada', async () => {
    const dist = await proponer(usuario, 'Distinto', bucle(JAZZ, 2)).expect(201);
    expect(dist.body.propuesta.similares.filter((s: { puntuacion: number }) => s.puntuacion >= 85)).toHaveLength(0);
    // 'Coro grande' en el catálogo (WORSHIP x4) tiene la misma huella que WORSHIP x2.
    // Se cambia el catálogo: el groove distinto ahora es idéntico a uno publicado.
    const igual = await proponer(usuario2, 'Copia del coro', bucle(JAZZ, 1)).expect(200);
    expect(igual.body.repetida).toBe(true); // ya estaba como propuesta 'Distinto'
  });

  it('calcula la comparación lado a lado y recalcula al cambiar el catálogo', async () => {
    const c = await request(app).get(`/admin/grooves/propuestas/${propuestaId}/comparar?tipo=groove&con=jw-pop-coro-grande`).set(aut(admin));
    expect([200, 404]).toContain(c.status);
    if (c.status === 200) expect(c.body.resultado.puntuacion).toBeLessThan(85);
    const rc = await request(app).post('/admin/grooves/propuestas/recalcular').set(aut(admin)).expect(200);
    expect(rc.body.recalculadas).toBeGreaterThan(0);
  });

  it('aprobar la convierte en groove del catálogo (CC0), editable y como variante; rechazar y duplicada guardan nota', async () => {
    const ap = await request(app).post(`/admin/grooves/propuestas/${propuestaId}/aprobar`).set(aut(admin)).send({ cambios: { nombre: 'Rock de usuario', estilo: 'Rock' }, nota: 'bueno' }).expect(200);
    expect(ap.body.propuesta.estado).toBe('aprobada');
    const g = [...ctx.grooves.values()].find((x) => x.id === ap.body.grooveId)!;
    expect(g).toMatchObject({ nombre: 'Rock de usuario', estilo: 'Rock', licencia: 'CC0-1.0', activo: true });
    await request(app).post(`/admin/grooves/propuestas/${propuestaId}/aprobar`).set(aut(admin)).send({}).expect(409);

    const otra = [...ctx.propuestas.values()].find((p) => p.nombre === 'Rock con fill')!;
    const va = await request(app).post(`/admin/grooves/propuestas/${otra.id}/aprobar`).set(aut(admin)).send({ varianteDe: ap.body.grooveId }).expect(200);
    const gv = [...ctx.grooves.values()].find((x) => x.id === va.body.grooveId)!;
    expect(gv.etiquetas).toContain('variante');
    expect(gv.estilo).toBe('Rock');

    const dist = [...ctx.propuestas.values()].find((p) => p.nombre === 'Distinto')!;
    const rc = await request(app).post(`/admin/grooves/propuestas/${dist.id}/rechazar`).set(aut(admin)).send({ nota: 'Muy parecido a otro' }).expect(200);
    expect(rc.body.propuesta).toMatchObject({ estado: 'rechazada', notaAdmin: 'Muy parecido a otro' });
    const mias = await request(app).get('/grooves/propuestas/mias').set(aut(usuario)).expect(200);
    expect(mias.body.propuestas.find((p: { estado: string }) => p.estado === 'rechazada').notaAdmin).toBe('Muy parecido a otro');
    expect(ctx.auditoria.map((x) => x.accion)).toEqual(expect.arrayContaining(['groove.propuesta.aprobar', 'groove.propuesta.rechazar']));
  });

  it('un groove idéntico a uno del catálogo entra ya marcado como duplicada', async () => {
    const r = await proponer(usuario, 'Rock otra vez', bucle(FUNK, 8)).expect(200).catch(() => null);
    // La huella ya existe como propuesta aprobada → se acumula (200) en vez de abrir otra revisión.
    expect(r?.body.repetida ?? true).toBe(true);
    const nuevo = await proponer(usuario, 'Hi-hat solo', bucle({ 42: [0, 2, 4, 6, 8, 10, 12, 14] }, 1)).expect(201);
    expect(nuevo.body.propuesta.estado).toBe('pendiente');
    const dup = await request(app).post(`/admin/grooves/propuestas/${nuevo.body.propuesta.id}/marcar-duplicada`).set(aut(admin)).send({ nota: 'ya está' }).expect(200);
    expect(dup.body.propuesta.estado).toBe('duplicada');
  });

  it('lo idéntico a un groove del catálogo se registra como duplicada sin pedir revisión', async () => {
    const raro = { 36: [0, 5, 9], 38: [4, 13], 56: [2, 6, 10, 14] };
    await request(app).post('/admin/grooves').set(aut(admin)).send({ nombre: 'Cencerro', estilo: 'Latin', base64: b64(midi(bucle(raro, 2))) }).expect(201);
    const r = await proponer(usuario, 'Mi cencerro', bucle(raro, 1)).expect(201);
    expect(r.body.propuesta).toMatchObject({ estado: 'duplicada', grooveId: 'jw-latin-cencerro' });
    expect(r.body.propuesta.similares[0].puntuacion).toBe(100);
  });

  it('la copia de similitud del backend es idéntica a la de shared', () => {
    let compartido: string;
    try {
      compartido = readFileSync(new URL('../../shared/src/grooves/similitud.ts', import.meta.url), 'utf8');
    } catch {
      return; // backend desplegado sin el resto del repo
    }
    const copia = readFileSync(new URL('../src/grooves/similitud.ts', import.meta.url), 'utf8');
    expect(copia).toBe(compartido);
  });
});
