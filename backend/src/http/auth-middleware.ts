import type { NextFunction, Request, Response } from 'express';
import { ErrorAutenticacion, type Identidad, type VerificadorJwt } from '../auth/verificador-jwt.js';
import { ErrorApi } from './errores.js';

declare module 'express-serve-static-core' {
  interface Request {
    identidad?: Identidad;
  }
}

/** Exige un Bearer válido; deja la identidad en `req.identidad`. */
export function exigirAutenticacion(verificar: VerificadorJwt) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const cabecera = req.headers.authorization ?? '';
    const [esquema, token] = cabecera.split(' ');
    if (esquema !== 'Bearer' || !token) {
      next(new ErrorAutenticacion('falta Bearer token'));
      return;
    }
    try {
      req.identidad = await verificar(token);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function exigirAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.identidad?.esAdmin) {
    next(new ErrorApi(403, 'prohibido', 'solo administradores'));
    return;
  }
  next();
}
