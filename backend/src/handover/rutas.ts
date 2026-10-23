/**
 * Handover web → escritorio (H1). La web guarda el estado de trabajo (proyecto, cursor, selección,
 * reproducción, sala) y la sesión; obtiene un token de un solo uso válido 60 s y abre
 * `jaswave://abrir?token=…`. JasWave Desktop canjea el token y restaura todo sin pedir login.
 *
 * El contenido se cifra con AES-256-GCM con una clave derivada del token: en la base de datos solo
 * hay un hash del token y un blob ilegible sin él.
 */

import express, { Router } from 'express';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { VerificadorJwt } from '../auth/verificador-jwt.js';
import { exigirAutenticacion } from '../http/auth-middleware.js';
import { ErrorApi } from '../http/errores.js';
import { sincronizarUsuario, type Reloj } from '../license/servicio.js';

export const VIGENCIA_HANDOVER_MS = 60_000;
const LIMITE_CUERPO = '8mb';

const hashToken = (token: string) => createHash('sha256').update(`handover:${token}`).digest('hex');
const claveDeToken = (token: string) => createHash('sha256').update(`clave:${token}`).digest();

export function cifrar(token: string, datos: unknown): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', claveDeToken(token), iv);
  const cuerpo = Buffer.concat([c.update(JSON.stringify(datos), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), cuerpo]);
}

export function descifrar(token: string, blob: Buffer): unknown {
  const d = createDecipheriv('aes-256-gcm', claveDeToken(token), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8'));
}

const crearEsquema = z.object({
  /** Estado de trabajo: proyecto, transporte, selección, sala… (opaco para el backend). */
  datos: z.record(z.unknown()),
  /** Sesión de Supabase de la web para continuar sin volver a iniciar sesión. */
  sesion: z.object({ access_token: z.string().min(20), refresh_token: z.string().min(10) }).optional(),
});
const canjearEsquema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/) });

export type OpcionesHandover = { db: Db; verificar: VerificadorJwt; reloj: Reloj };

export function rutasHandover({ db, verificar, reloj }: OpcionesHandover): Router {
  const r = Router();
  r.use(express.json({ limit: LIMITE_CUERPO }));

  r.post('/', exigirAutenticacion(verificar), async (req, res) => {
    const { datos, sesion } = crearEsquema.parse(req.body);
    const usuario = await sincronizarUsuario(db, req.identidad!);
    const token = randomBytes(32).toString('base64url');
    const caducaEn = new Date(reloj().getTime() + VIGENCIA_HANDOVER_MS);
    // Limpieza oportunista de tokens vencidos.
    await db.tokenHandover.deleteMany({ where: { caducaEn: { lt: reloj() } } });
    await db.tokenHandover.create({
      data: { hash: hashToken(token), usuarioId: usuario.id, cifrado: cifrar(token, { datos, sesion }), caducaEn },
    });
    res.status(201).json({ token, url: `jaswave://abrir?token=${token}`, caducaEn: caducaEn.toISOString() });
  });

  /** Canje de un solo uso: el token es la credencial (sale del navegador del propio usuario). */
  r.post('/canjear', async (req, res) => {
    const { token } = canjearEsquema.parse(req.body);
    const hash = hashToken(token);
    // deleteMany devuelve cuántas filas borró: garantiza un solo canje aunque lleguen dos a la vez.
    const fila = await db.tokenHandover.findUnique({ where: { hash } });
    const borradas = fila ? (await db.tokenHandover.deleteMany({ where: { hash } })).count : 0;
    if (!fila || borradas === 0 || fila.caducaEn.getTime() <= reloj().getTime()) {
      throw new ErrorApi(404, 'handover_invalido', 'el enlace caducó o ya se usó; vuelve a abrir desde la web');
    }
    const contenido = descifrar(token, Buffer.from(fila.cifrado)) as { datos: unknown; sesion?: unknown };
    res.json(contenido);
  });

  return r;
}
