import type { NextFunction, Request, Response } from 'express';
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

export function manejadorErrores(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ErrorApi) {
    res.status(err.estado).json({ error: { codigo: err.codigo, mensaje: err.message } });
    return;
  }
  if (err instanceof ErrorAutenticacion) {
    res.status(401).json({ error: { codigo: 'no_autenticado', mensaje: err.message } });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { codigo: 'json_invalido', mensaje: 'JSON mal formado' } });
    return;
  }
  res.status(500).json({ error: { codigo: 'interno', mensaje: 'error interno' } });
}
