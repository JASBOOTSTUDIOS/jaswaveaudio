/**
 * Catálogo de paquetes de plugins (D1). El DAW solo instala paquetes que aparecen en un catálogo con
 * firma Ed25519 válida, y comprueba el SHA-256 de cada zip descargado.
 *
 * Formato firmado: `jwc1.<payload base64url>.<firma base64url>` (firma sobre `jwc1.<payload>`).
 */

import { Router } from 'express';
import { createPrivateKey, sign } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { VerificadorJwt } from '../auth/verificador-jwt.js';
import { exigirAdmin, exigirAutenticacion } from '../http/auth-middleware.js';
import { auditar, type Reloj } from '../license/servicio.js';

export type EntradaCatalogo = { id: string; nombre: string; version: string; url: string; sha256: string; sizeBytes: number };
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
});

export type OpcionesCatalogo = { db: Db; verificar: VerificadorJwt; clavePrivadaPem: string; reloj: Reloj };

export function rutasCatalogo({ db, verificar, clavePrivadaPem, reloj }: OpcionesCatalogo): Router {
  const r = Router();

  /** Catálogo público firmado: última versión de cada paquete. */
  r.get('/', async (_req, res) => {
    const filas = await db.paquetePlugin.findMany();
    const ultimo = new Map<string, (typeof filas)[number]>();
    for (const f of filas) {
      const previo = ultimo.get(f.id);
      if (!previo || compararVersion(f.version, previo.version) > 0) ultimo.set(f.id, f);
    }
    const catalogo: Catalogo = {
      generadoEn: reloj().toISOString(),
      paquetes: [...ultimo.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(({ id, nombre, version, url, sha256, sizeBytes }) => ({ id, nombre, version, url, sha256, sizeBytes })),
    };
    res.json({ catalogo, token: firmarCatalogo(catalogo, clavePrivadaPem) });
  });

  /** Publica versiones (lo usa native/scripts/package-plugins.mjs tras subir los zip). Solo admin. */
  r.post('/', exigirAutenticacion(verificar), exigirAdmin, async (req, res) => {
    const { paquetes } = z.object({ paquetes: z.array(paqueteEsquema).min(1).max(200) }).parse(req.body);
    for (const p of paquetes) {
      await db.paquetePlugin.upsert({
        where: { id_version: { id: p.id, version: p.version } },
        update: { nombre: p.nombre, url: p.url, sha256: p.sha256, sizeBytes: p.sizeBytes },
        create: p,
      });
    }
    await auditar(db, req.identidad!.userId, 'catalogo.publicar', paquetes.map((p) => `${p.id}@${p.version}`).join(','));
    res.json({ publicados: paquetes.length });
  });

  return r;
}
