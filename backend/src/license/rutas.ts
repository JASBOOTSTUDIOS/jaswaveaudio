import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { Reloj } from './servicio.js';
import { accionesEfectivas, codigoDispositivoSecreto, codigoUsuarioLegible, emitirLicencia, sincronizarUsuario } from './servicio.js';
import { exigirAutenticacion } from '../http/auth-middleware.js';
import { ErrorApi } from '../http/errores.js';
import type { VerificadorJwt } from '../auth/verificador-jwt.js';

const CADUCIDAD_CODIGO_MS = 10 * 60 * 1000;

export type OpcionesLicencias = {
  db: Db;
  verificar: VerificadorJwt;
  clavePrivadaPem: string;
  reloj: Reloj;
};

const iniciarEsquema = z.object({ productoId: z.string().min(1).max(200), dispositivo: z.string().min(1).max(120) });
const pollEsquema = z.object({ codigoDispositivo: z.string().min(10).max(200), dispositivo: z.string().min(1).max(120) });
const aprobarEsquema = z.object({ codigoUsuario: z.string().min(4).max(20) });
const refrescarEsquema = z.object({ dispositivo: z.string().min(1).max(120) });

export function rutasLicencias(opciones: OpcionesLicencias): Router {
  const { db, verificar, clavePrivadaPem, reloj } = opciones;
  const r = Router();
  const autenticado = exigirAutenticacion(verificar);

  /** El VST inicia el flujo: obtiene un código que el usuario aprueba en el navegador. */
  r.post('/device/start', async (req, res) => {
    const { productoId, dispositivo } = iniciarEsquema.parse(req.body);
    const producto = await db.producto.findUnique({ where: { id: productoId } });
    if (!producto) throw new ErrorApi(404, 'producto_no_encontrado', 'producto desconocido');
    const caducaEn = new Date(reloj().getTime() + CADUCIDAD_CODIGO_MS);
    const fila = await db.codigoDispositivo.create({
      data: {
        codigoDispositivo: codigoDispositivoSecreto(),
        codigoUsuario: codigoUsuarioLegible(),
        productoId,
        caducaEn,
      },
    });
    res.status(201).json({
      codigoDispositivo: fila.codigoDispositivo,
      codigoUsuario: fila.codigoUsuario,
      caducaEn: caducaEn.toISOString(),
      intervaloSeg: 5,
      dispositivo,
    });
  });

  /** El usuario aprueba el código desde una sesión autenticada (web de JasWave). */
  r.post('/device/aprobar', autenticado, async (req, res) => {
    const { codigoUsuario } = aprobarEsquema.parse(req.body);
    const fila = await db.codigoDispositivo.findUnique({ where: { codigoUsuario: codigoUsuario.toUpperCase() } });
    if (!fila || fila.caducaEn.getTime() <= reloj().getTime() || fila.estado !== 'pendiente') {
      throw new ErrorApi(404, 'codigo_invalido', 'código inexistente, caducado o ya usado');
    }
    const usuario = await sincronizarUsuario(db, req.identidad!);
    const acciones = await accionesEfectivas(db, usuario.id, fila.productoId, reloj());
    if (acciones.length === 0) {
      throw new ErrorApi(403, 'sin_licencia', 'tu cuenta no tiene acceso a este producto');
    }
    await db.codigoDispositivo.update({
      where: { codigoDispositivo: fila.codigoDispositivo },
      data: { estado: 'aprobado', usuarioId: usuario.id },
    });
    res.json({ ok: true });
  });

  /** El VST consulta el código; cuando está aprobado recibe la licencia firmada (una sola vez). */
  r.post('/device/poll', async (req, res) => {
    const { codigoDispositivo, dispositivo } = pollEsquema.parse(req.body);
    const fila = await db.codigoDispositivo.findUnique({ where: { codigoDispositivo } });
    if (!fila) throw new ErrorApi(404, 'codigo_invalido', 'código desconocido');
    if (fila.caducaEn.getTime() <= reloj().getTime()) {
      await db.codigoDispositivo.delete({ where: { codigoDispositivo } });
      res.json({ estado: 'caducado' });
      return;
    }
    if (fila.estado === 'pendiente' || !fila.usuarioId) {
      res.json({ estado: 'pendiente' });
      return;
    }
    const usuario = await db.usuario.findUniqueOrThrow({ where: { id: fila.usuarioId } });
    await db.codigoDispositivo.delete({ where: { codigoDispositivo } });
    const licencia = await emitirLicencia(db, clavePrivadaPem, usuario, dispositivo, reloj);
    res.json({ estado: 'aprobado', ...licencia });
  });

  /** Renueva la licencia firmada (24 h) para el dispositivo autenticado. */
  r.post('/refresh', autenticado, async (req, res) => {
    const { dispositivo } = refrescarEsquema.parse(req.body);
    const usuario = await sincronizarUsuario(db, req.identidad!);
    const licencia = await emitirLicencia(db, clavePrivadaPem, usuario, dispositivo, reloj);
    res.json({ estado: 'aprobado', ...licencia });
  });

  return r;
}
