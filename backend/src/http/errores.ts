import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorAutenticacion } from '../auth/verificador-jwt.js';

export class ErrorApi extends Error {
  constructor(
    public readonly estado: number,
    public readonly codigo: string,
    message: string,
  ) {
    super(message);
    this.name = 'ErrorApi';
  }
}

export type RegistroErrores = { error: (obj: object, msg: string) => void };

/** Errores conocidos de Prisma (por código) traducidos a respuestas HTTP con sentido. */
const ERRORES_PRISMA: Record<string, { estado: number; codigo: string; mensaje: string }> = {
  P2002: { estado: 409, codigo: 'conflicto', mensaje: 'ya existe un registro con esos datos' },
  P2025: { estado: 404, codigo: 'no_encontrado', mensaje: 'registro no encontrado' },
  P2003: { estado: 400, codigo: 'referencia_invalida', mensaje: 'referencia a un registro inexistente' },
};

function codigoPrisma(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { name?: unknown; code?: unknown };
  return e.name === 'PrismaClientKnownRequestError' && typeof e.code === 'string' ? e.code : null;
}

export function crearManejadorErrores(log?: RegistroErrores) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof ErrorApi) {
      res.status(err.estado).json({ error: { codigo: err.codigo, mensaje: err.message } });
      return;
    }
    if (err instanceof ErrorAutenticacion) {
      res.status(401).json({ error: { codigo: 'no_autenticado', mensaje: err.message } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: { codigo: 'datos_invalidos', mensaje: 'datos no válidos', detalles: err.issues } });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: { codigo: 'json_invalido', mensaje: 'JSON mal formado' } });
      return;
    }
    const prisma = codigoPrisma(err);
    const conocido = prisma ? ERRORES_PRISMA[prisma] : undefined;
    if (conocido) {
      res.status(conocido.estado).json({ error: { codigo: conocido.codigo, mensaje: conocido.mensaje } });
      return;
    }
    log?.error({ err, metodo: req.method, ruta: req.originalUrl }, 'error no controlado');
    res.status(500).json({ error: { codigo: 'interno', mensaje: 'error interno' } });
  };
}
