import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import type { VerificadorJwt } from './auth/verificador-jwt.js';
import { exigirAutenticacion } from './http/auth-middleware.js';
import { crearManejadorErrores, type RegistroErrores } from './http/errores.js';
import type { Db } from './db.js';
import { rutasLicencias } from './license/rutas.js';
import { rutasAdmin } from './admin/rutas.js';
import type { Reloj } from './license/servicio.js';

export type OpcionesApp = {
  verificar: VerificadorJwt;
  origenesCors: string[];
  log?: RegistroErrores;
  /** Dependencias de datos y licencias; sin ellas solo quedan /health y /me. */
  datos?: { db: Db; clavePrivadaPem: string; reloj: Reloj };
};

export function crearApp(opciones: OpcionesApp): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: opciones.origenesCors }));
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => {
    res.json({ estado: 'ok', servicio: 'jaswave-backend' });
  });

  app.get('/me', exigirAutenticacion(opciones.verificar), (req, res) => {
    res.json({ identidad: req.identidad });
  });

  if (opciones.datos) {
    const { db, clavePrivadaPem, reloj } = opciones.datos;
    app.use('/license', rutasLicencias({ db, verificar: opciones.verificar, clavePrivadaPem, reloj }));
    app.use('/admin', rutasAdmin({ db, verificar: opciones.verificar }));
  }

  app.use((_req, res) => {
    res.status(404).json({ error: { codigo: 'no_encontrado', mensaje: 'ruta inexistente' } });
  });
  app.use(crearManejadorErrores(opciones.log));
  return app;
}
