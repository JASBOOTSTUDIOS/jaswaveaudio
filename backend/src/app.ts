import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import type { VerificadorJwt } from './auth/verificador-jwt.js';
import { exigirAutenticacion } from './http/auth-middleware.js';
import { crearManejadorErrores, type RegistroErrores } from './http/errores.js';
import type { Db } from './db.js';
import { rutasLicencias } from './license/rutas.js';
import { rutasAdmin } from './admin/rutas.js';
import { rutasCatalogo, rutasModulos } from './catalog/rutas.js';
import { rutasHandover } from './handover/rutas.js';
import { rutasAdminIA, rutasIA } from './ia/rutas.js';
import type { ServicioProveedoresIA } from './ia/proveedores.js';
import type { Reloj } from './license/servicio.js';

export type OpcionesApp = {
  verificar: VerificadorJwt;
  origenesCors: string[];
  log?: RegistroErrores;
  /** Proveedores de IA (M2, en BD); null/ausente = IA no configurada (responde 503). */
  ia?: ServicioProveedoresIA | null;
  /** Dependencias de datos y licencias; sin ellas solo quedan /health y /me. */
  datos?: { db: Db; clavePrivadaPem: string; reloj: Reloj };
};

export function crearApp(opciones: OpcionesApp): Express {
  const app = express();
  app.disable('x-powered-by');
  // Datos autenticados y mutables: nada se cachea (el navegador reutilizaba GET tras un PUT).
  app.set('etag', false);
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(helmet());
  app.use(cors({ origin: opciones.origenesCors }));
  // El handover lleva el proyecto completo: su propio límite (8 MB) antes del general de 256 KB.
  if (opciones.datos) {
    const { db, reloj } = opciones.datos;
    app.use('/handover', rutasHandover({ db, verificar: opciones.verificar, reloj }));
  }
  // IA: contexto y herramientas pueden superar 256 KB (límite propio de 4 MB).
  app.use('/ia', rutasIA({ verificar: opciones.verificar, servicio: opciones.ia ?? null }));
  if (opciones.ia?.admin) app.use('/admin/ia', rutasAdminIA({ verificar: opciones.verificar, admin: opciones.ia.admin }));
  // Publicar archivos de módulos (M3, solo admin) lleva el bundle completo en base64.
  app.use('/catalogo/modulos', express.json({ limit: '40mb' }));
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
    app.use('/catalogo', rutasCatalogo({ db, verificar: opciones.verificar, clavePrivadaPem, reloj }));
    app.use('/modulos', rutasModulos({ db }));
  }

  app.use((_req, res) => {
    res.status(404).json({ error: { codigo: 'no_encontrado', mensaje: 'ruta inexistente' } });
  });
  app.use(crearManejadorErrores(opciones.log));
  return app;
}
