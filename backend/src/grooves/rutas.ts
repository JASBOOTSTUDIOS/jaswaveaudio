/**
 * Rutas del catálogo de grooves MIDI.
 *  - Usuario autenticado (`/grooves`): índice con revisión global y descarga de cada .mid.
 *  - Administrador (`/admin/grooves`): alta (uno, lote o zip), edición, reemplazo, activar, borrar y mover estilos.
 */

import express, { Router } from 'express';
import { z } from 'zod';
import type { VerificadorJwt } from '../auth/verificador-jwt.js';
import { exigirAdmin, exigirAutenticacion } from '../http/auth-middleware.js';
import { ErrorApi } from '../http/errores.js';
import { decodificarBase64, type ServicioGroovesCatalogo } from './servicio.js';
import { TEXTO_CONSENTIMIENTO, VERSION_CONSENTIMIENTO, type ServicioPropuestasGroove } from './propuestas.js';
import { MAX_LOTE, base64Mid, esquemaArchivo, esquemaEstilo, esquemaId, esquemaMetadatos, MAX_ZIP_BYTES } from './validacion.js';

const parametroId = (v: unknown) => esquemaId.parse(v);

function enviarMid(res: express.Response, bytes: Uint8Array, sha256: string): void {
  res.setHeader('Content-Type', 'audio/midi');
  res.setHeader('Content-Length', String(bytes.byteLength));
  res.setHeader('X-Groove-Sha256', sha256);
  res.end(Buffer.from(bytes));
}

export function rutasGrooves(o: { verificar: VerificadorJwt; servicio: ServicioGroovesCatalogo; propuestas: ServicioPropuestasGroove }): Router {
  const r = Router();
  r.use(express.json({ limit: '512kb' }));
  r.use(exigirAutenticacion(o.verificar));

  /** Texto y versión de consentimiento vigentes (la app los muestra tal cual). */
  r.get('/consentimiento', (_req, res) => {
    res.json({ version: VERSION_CONSENTIMIENTO, texto: TEXTO_CONSENTIMIENTO });
  });

  /** Un usuario propone un groove suyo para el catálogo: solo con consentimiento explícito. */
  r.post('/propuestas', async (req, res) => {
    const d = esquemaMetadatos
      .partial()
      .extend({
        nombre: esquemaMetadatos.shape.nombre,
        estilo: esquemaMetadatos.shape.estilo,
        base64: base64Mid,
        consentimiento: z.object({ aceptado: z.boolean(), version: z.string().max(40) }).strict(),
      })
      .strict()
      .parse(req.body);
    const { base64, ...resto } = d;
    const r2 = await o.propuestas.proponer(req.identidad!.userId, { ...resto, contenido: decodificarBase64(base64) });
    res.status(r2.repetida ? 200 : 201).json(r2);
  });
  r.get('/propuestas/mias', async (req, res) => {
    res.json({ propuestas: await o.propuestas.mias(req.identidad!.userId) });
  });

  /** `?desde=<revisión>`: si coincide con la actual, 304 sin cuerpo (no hay nada nuevo). */
  r.get('/indice', async (req, res) => {
    const { desde } = z.object({ desde: z.coerce.number().int().min(0).optional() }).parse(req.query);
    const i = await o.servicio.indice(desde);
    if (i.sinCambios) {
      res.setHeader('X-Grooves-Revision', String(i.revision));
      res.status(304).end();
      return;
    }
    res.json({ revision: i.revision, total: i.grooves.length, grooves: i.grooves });
  });

  r.get('/:id/archivo', async (req, res) => {
    const a = await o.servicio.archivo(parametroId(req.params.id), true);
    enviarMid(res, a.bytes, a.sha256);
  });
  return r;
}

const metadatosParciales = esquemaMetadatos.partial().extend({ archivo: esquemaArchivo.optional() });

export function rutasAdminGrooves(o: { verificar: VerificadorJwt; servicio: ServicioGroovesCatalogo; propuestas: ServicioPropuestasGroove }): Router {
  const r = Router();
  const s = o.servicio;
  // El zip llega en base64 (hasta 12 MB → ~16 MB).
  r.use(express.json({ limit: `${Math.ceil((MAX_ZIP_BYTES * 4) / 3 / 1024 / 1024) + 2}mb` }));
  r.use(exigirAutenticacion(o.verificar), exigirAdmin);
  const actor = (req: express.Request) => req.identidad!.userId;

  // ---------- Propuestas de usuarios ----------
  const idPropuesta = z.string().uuid();
  r.get('/propuestas', async (req, res) => {
    const q = z.object({ estado: z.enum(['pendiente', 'aprobada', 'rechazada', 'duplicada']).optional(), vista: z.enum(['unicas', 'con-similares', 'todas']).optional() }).parse(req.query);
    res.json(await o.propuestas.listar({ ...(q.estado ? { estado: q.estado } : {}), ...(q.vista ? { vista: q.vista } : {}) }));
  });
  r.post('/propuestas/recalcular', async (_req, res) => {
    res.json({ recalculadas: await o.propuestas.recalcular() });
  });
  r.get('/propuestas/:id/archivo', async (req, res) => {
    const a = await o.propuestas.archivo(idPropuesta.parse(req.params.id));
    enviarMid(res, a.bytes, a.sha256);
  });
  r.get('/propuestas/:id/comparar', async (req, res) => {
    const q = z.object({ tipo: z.enum(['groove', 'propuesta']), con: z.string().min(1).max(80) }).parse(req.query);
    res.json(await o.propuestas.comparar(idPropuesta.parse(req.params.id), { tipo: q.tipo, id: q.con }));
  });
  r.post('/propuestas/:id/aprobar', async (req, res) => {
    const d = z.object({ cambios: esquemaMetadatos.partial().optional(), varianteDe: esquemaId.optional(), nota: z.string().max(300).optional() }).strict().parse(req.body ?? {});
    res.json(await o.propuestas.aprobar(actor(req), idPropuesta.parse(req.params.id), { ...(d.cambios ? { cambios: d.cambios } : {}), ...(d.varianteDe ? { varianteDe: d.varianteDe } : {}), ...(d.nota ? { nota: d.nota } : {}) }));
  });
  r.post('/propuestas/:id/rechazar', async (req, res) => {
    const { nota } = z.object({ nota: z.string().max(300).default('') }).strict().parse(req.body ?? {});
    res.json({ propuesta: await o.propuestas.rechazar(actor(req), idPropuesta.parse(req.params.id), nota) });
  });
  r.post('/propuestas/:id/marcar-duplicada', async (req, res) => {
    const d = z.object({ nota: z.string().max(300).default(''), de: esquemaId.optional() }).strict().parse(req.body ?? {});
    res.json({ propuesta: await o.propuestas.marcarDuplicada(actor(req), idPropuesta.parse(req.params.id), d.nota, d.de) });
  });

  r.get('/', async (_req, res) => {
    res.json(await s.listarAdmin());
  });

  r.post('/', async (req, res) => {
    const d = esquemaMetadatos
      .partial()
      .extend({ nombre: esquemaMetadatos.shape.nombre, estilo: esquemaMetadatos.shape.estilo, base64: base64Mid, id: esquemaId.optional(), archivo: esquemaArchivo.optional() })
      .strict()
      .parse(req.body);
    const { base64, ...resto } = d;
    res.status(201).json({ groove: await s.crear(actor(req), { ...resto, contenido: decodificarBase64(base64) }) });
  });

  r.post('/lote', async (req, res) => {
    const d = z
      .object({
        archivos: z.array(z.object({ nombre: z.string().min(1).max(200), carpeta: z.string().max(81).optional(), base64: base64Mid })).min(1).max(MAX_LOTE).optional(),
        zip: z.string().max(Math.ceil((MAX_ZIP_BYTES * 4) / 3) + 8).regex(/^[A-Za-z0-9+/]*={0,2}$/).optional(),
        estilo: esquemaEstilo.optional(),
        reemplazar: z.boolean().default(false),
      })
      .strict()
      .refine((x) => Boolean(x.archivos) !== Boolean(x.zip), 'envía «archivos» o «zip», no ambos')
      .parse(req.body);
    const resultado = await s.importarLote(actor(req), {
      ...(d.archivos ? { archivos: d.archivos.map((a) => ({ nombre: a.nombre, ...(a.carpeta ? { carpeta: a.carpeta } : {}), contenido: decodificarBase64(a.base64) })) } : {}),
      ...(d.zip ? { zip: Buffer.from(d.zip, 'base64') } : {}),
      ...(d.estilo ? { estilo: d.estilo } : {}),
      reemplazar: d.reemplazar,
    });
    res.json(resultado);
  });

  r.post('/estilos/renombrar', async (req, res) => {
    const d = z.object({ actual: esquemaEstilo, nuevo: esquemaEstilo }).strict().parse(req.body);
    res.json(await s.renombrarEstilo(actor(req), d.actual, d.nuevo));
  });

  r.get('/:id/archivo', async (req, res) => {
    const a = await s.archivo(parametroId(req.params.id), false);
    enviarMid(res, a.bytes, a.sha256);
  });

  r.put('/:id', async (req, res) => {
    const d = metadatosParciales.strict().parse(req.body);
    if (!Object.keys(d).length) throw new ErrorApi(400, 'sin_cambios', 'no hay nada que cambiar');
    res.json({ groove: await s.editar(actor(req), parametroId(req.params.id), d) });
  });

  r.put('/:id/archivo', async (req, res) => {
    const { base64 } = z.object({ base64: base64Mid }).strict().parse(req.body);
    res.json({ groove: await s.reemplazarArchivo(actor(req), parametroId(req.params.id), decodificarBase64(base64)) });
  });

  r.put('/:id/activo', async (req, res) => {
    const { activo } = z.object({ activo: z.boolean() }).strict().parse(req.body);
    res.json({ groove: await s.fijarActivo(actor(req), parametroId(req.params.id), activo) });
  });

  r.delete('/:id', async (req, res) => {
    await s.borrar(actor(req), parametroId(req.params.id));
    res.status(204).end();
  });

  return r;
}
