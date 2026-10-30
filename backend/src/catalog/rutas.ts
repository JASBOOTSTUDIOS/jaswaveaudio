/**
 * Catálogo de paquetes de plugins (D1) y módulos del DAW (M3). El DAW solo instala paquetes que
 * aparecen en un catálogo con firma Ed25519 válida, y comprueba el SHA-256 de cada zip descargado.
 *
 * Formato firmado: `jwc1.<payload base64url>.<firma base64url>` (firma sobre `jwc1.<payload>`).
 *
 * Los módulos (`entrypoints.ui`) también se publican archivo a archivo para el cliente web, que los
 * carga desde `/modulos/<id>/<versión>/<ruta>` (URLs inmutables; el SHA-256 de cada archivo viaja en el
 * catálogo firmado).
 */

import express, { Router } from 'express';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { VerificadorJwt } from '../auth/verificador-jwt.js';
import { exigirAdmin, exigirAutenticacion } from '../http/auth-middleware.js';
import { auditar, type Reloj } from '../license/servicio.js';
import { ErrorApi } from '../http/errores.js';
import { firmarPaquete } from './firma-paquete.js';

export type EntradaCatalogo = {
  id: string;
  nombre: string;
  version: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  categoria: string;
  plataformas: string[];
  descripcion: string;
  /** Solo módulos del DAW. */
  ui?: string;
  uiEstilos?: string;
  /** Módulos publicados para la web: SHA-256 de cada archivo servido en /modulos. */
  archivos?: Record<string, string>;
};
export type Catalogo = { generadoEn: string; paquetes: EntradaCatalogo[] };

const semver = (v: string) => v.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
function compararVersion(a: string, b: string): number {
  const x = semver(a);
  const y = semver(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? 0;
    const q = y[i] ?? 0;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p - q;
    return String(p) < String(q) ? -1 : 1;
  }
  return 0;
}

export function firmarCatalogo(catalogo: Catalogo, clavePrivadaPem: string): string {
  const payload = Buffer.from(JSON.stringify(catalogo)).toString('base64url');
  const firma = sign(null, Buffer.from(`jwc1.${payload}`), createPrivateKey(clavePrivadaPem)).toString('base64url');
  return `jwc1.${payload}.${firma}`;
}

/** Ruta relativa dentro del paquete: sin '..', sin absolutas, caracteres seguros. */
const rutaArchivo = z
  .string()
  .max(240)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_\-./]*$/, 'ruta inválida')
  .refine((r) => !r.split('/').includes('..') && !r.includes('//'), 'ruta inválida');

/** Rutas de un .jwx que se pueden firmar: como rutaArchivo, más espacios y &() de los bundles VST3. */
const rutaFirmable = z
  .string()
  .max(240)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9 _\-.&()/]*$/, 'ruta inválida')
  .refine((r) => !r.split('/').includes('..') && !r.includes('//'), 'ruta inválida');

const TIPOS: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
  txt: 'text/plain; charset=utf-8',
};
export const tipoDeArchivo = (ruta: string) => TIPOS[ruta.split('.').pop()?.toLowerCase() ?? ''];

const paqueteEsquema = z.object({
  id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+){2,}$/),
  nombre: z.string().min(1).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/),
  // Solo HTTPS (GitHub Releases u otro CDN); en desarrollo se admite http://127.0.0.1/localhost.
  url: z
    .string()
    .url()
    .refine((u) => /^https:\/\//.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u), 'la URL debe ser https'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive().max(2_000_000_000),
  categoria: z.enum(['audio-effect', 'instrument', 'instrument-bundle', 'ai-skill', 'ui-extension', 'bridge']).default('audio-effect'),
  plataformas: z.array(z.enum(['win-x64', 'web'])).max(4).default(['win-x64']),
  descripcion: z.string().max(2000).default(''),
  ui: rutaArchivo.optional(),
  uiEstilos: rutaArchivo.optional(),
});


export type OpcionesCatalogo = { db: Db; verificar: VerificadorJwt; clavePrivadaPem: string; reloj: Reloj };

export function rutasCatalogo({ db, verificar, clavePrivadaPem, reloj }: OpcionesCatalogo): Router {
  const r = Router();

  /** Catálogo público firmado: última versión de cada paquete. */
  r.get('/', async (_req, res) => {
    const filas = await db.paquetePlugin.findMany({ include: { archivos: { select: { ruta: true, sha256: true } } } });
    const ultimo = new Map<string, (typeof filas)[number]>();
    for (const f of filas) {
      const previo = ultimo.get(f.id);
      if (!previo || compararVersion(f.version, previo.version) > 0) ultimo.set(f.id, f);
    }
    const catalogo: Catalogo = {
      generadoEn: reloj().toISOString(),
      paquetes: [...ultimo.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((f) => ({
          id: f.id,
          nombre: f.nombre,
          version: f.version,
          url: f.url,
          sha256: f.sha256,
          sizeBytes: f.sizeBytes,
          categoria: f.categoria,
          plataformas: f.plataformas,
          descripcion: f.descripcion,
          ...(f.entradaUi ? { ui: f.entradaUi } : {}),
          ...(f.entradaEstilos ? { uiEstilos: f.entradaEstilos } : {}),
          ...(f.archivos.length ? { archivos: Object.fromEntries(f.archivos.map((a) => [a.ruta, a.sha256])) } : {}),
        })),
    };
    res.json({ catalogo, token: firmarCatalogo(catalogo, clavePrivadaPem) });
  });

  /** Publica versiones (lo usa native/scripts/package-plugins.mjs tras subir los zip). Solo admin. */
  r.post('/', exigirAutenticacion(verificar), exigirAdmin, async (req, res) => {
    const { paquetes } = z.object({ paquetes: z.array(paqueteEsquema).min(1).max(200) }).parse(req.body);
    for (const p of paquetes) {
      const datos = {
        nombre: p.nombre,
        url: p.url,
        sha256: p.sha256,
        sizeBytes: p.sizeBytes,
        categoria: p.categoria,
        plataformas: p.plataformas,
        descripcion: p.descripcion,
        entradaUi: p.ui ?? null,
        entradaEstilos: p.uiEstilos ?? null,
      };
      await db.paquetePlugin.upsert({ where: { id_version: { id: p.id, version: p.version } }, update: datos, create: { id: p.id, version: p.version, ...datos } });
    }
    await auditar(db, req.identidad!.userId, 'catalogo.publicar', paquetes.map((p) => `${p.id}@${p.version}`).join(','));
    res.json({ publicados: paquetes.length });
  });

  /**
   * Firma un paquete `.jwx` (X1, solo admin): recibe el manifiesto de archivos (ruta → SHA-256) y devuelve
   * `jaswave-firma.json`. La clave privada nunca sale del servidor; la operación queda auditada.
   */
  r.post('/firmar-paquete', exigirAutenticacion(verificar), exigirAdmin, async (req, res) => {
    const { id, version, archivos } = z
      .object({
        id: paqueteEsquema.shape.id,
        version: paqueteEsquema.shape.version,
        archivos: z
          .record(rutaFirmable, z.string().regex(/^[a-f0-9]{64}$/))
          .refine((a) => Object.keys(a).length > 0 && Object.keys(a).length <= 5000, 'entre 1 y 5000 archivos')
          .refine((a) => 'jaswave-plugin.json' in a, 'falta jaswave-plugin.json')
          .refine((a) => !('jaswave-firma.json' in a), 'la firma no se firma a sí misma'),
      })
      .parse(req.body);
    const firma = firmarPaquete(id, version, archivos, clavePrivadaPem);
    await auditar(db, req.identidad!.userId, 'catalogo.firmar-paquete', `${id}@${version}`, { archivos: Object.keys(archivos).length });
    res.json({ firma });
  });

  /**
   * Publica los archivos de un módulo para el cliente web (solo admin). Una versión publicada es inmutable:
   * volver a subir un archivo con otro contenido se rechaza (409); se publica una versión nueva.
   */
  r.post('/modulos/:id/:version/archivos', express.json({ limit: '40mb' }), exigirAutenticacion(verificar), exigirAdmin, async (req, res) => {
    const { id, version } = z.object({ id: paqueteEsquema.shape.id, version: paqueteEsquema.shape.version }).parse(req.params);
    const { archivos } = z
      .object({ archivos: z.array(z.object({ ruta: rutaArchivo, contenido: z.string().max(30_000_000) })).min(1).max(500) })
      .parse(req.body);
    const paquete = await db.paquetePlugin.findUnique({ where: { id_version: { id, version } } });
    if (!paquete) throw new ErrorApi(404, 'paquete_no_encontrado', 'publica antes la versión en el catálogo');
    if (!paquete.entradaUi) throw new ErrorApi(400, 'no_es_modulo', 'el paquete no declara entrypoints.ui');
    if (!paquete.plataformas.includes('web')) throw new ErrorApi(400, 'sin_web', 'el paquete no declara la plataforma web');
    const filas = archivos.map((a) => {
      const tipo = tipoDeArchivo(a.ruta);
      if (!tipo) throw new ErrorApi(400, 'tipo_no_permitido', `tipo de archivo no permitido: ${a.ruta}`);
      const contenido = Buffer.from(a.contenido, 'base64');
      return { paqueteId: id, version, ruta: a.ruta, tipo, contenido, sha256: createHash('sha256').update(contenido).digest('hex') };
    });
    if (!filas.some((f) => f.ruta === paquete.entradaUi)) throw new ErrorApi(400, 'falta_entrada', `falta ${paquete.entradaUi}`);
    const previos = new Map((await db.archivoModulo.findMany({ where: { paqueteId: id, version }, select: { ruta: true, sha256: true } })).map((a) => [a.ruta, a.sha256]));
    for (const f of filas) {
      const previo = previos.get(f.ruta);
      if (previo && previo !== f.sha256) throw new ErrorApi(409, 'version_inmutable', `${f.ruta} ya está publicado con otro contenido: sube una versión nueva`);
    }
    await db.$transaction(filas.filter((f) => !previos.has(f.ruta)).map((f) => db.archivoModulo.create({ data: f })));
    await auditar(db, req.identidad!.userId, 'catalogo.modulo.archivos', `${id}@${version}`, { archivos: filas.length });
    res.json({ archivos: Object.fromEntries(filas.map((f) => [f.ruta, f.sha256])) });
  });

  return r;
}

/**
 * Archivos de módulos para el cliente web: públicos (el código no es secreto; el acceso a funciones de
 * pago lo controla el backend), con caché inmutable y permitidos como script de otro origen (CORP).
 */
export function rutasModulos({ db }: { db: Db }): Router {
  const r = Router();
  r.get('/:id/:version/*ruta', async (req, res) => {
    const partes = (req.params as { ruta?: string[] | string }).ruta;
    const ruta = Array.isArray(partes) ? partes.join('/') : String(partes ?? '');
    const p = z.object({ id: paqueteEsquema.shape.id, version: paqueteEsquema.shape.version }).safeParse(req.params);
    if (!p.success || !rutaArchivo.safeParse(ruta).success) throw new ErrorApi(404, 'no_encontrado', 'archivo no encontrado');
    const a = await db.archivoModulo.findUnique({ where: { paqueteId_version_ruta: { paqueteId: p.data.id, version: p.data.version, ruta } } });
    if (!a) throw new ErrorApi(404, 'no_encontrado', 'archivo no encontrado');
    res.setHeader('Content-Type', a.tipo);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('ETag', `"${a.sha256}"`);
    res.end(Buffer.from(a.contenido));
  });
  return r;
}
