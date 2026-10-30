import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

export type Identidad = {
  userId: string;
  email: string;
  roles: string[];
  esAdmin: boolean;
};

export type VerificadorJwt = (token: string) => Promise<Identidad>;

export class ErrorAutenticacion extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorAutenticacion';
  }
}

export type OpcionesVerificador = {
  /** Clave de firma (JWKS remoto de Supabase o local en tests). */
  claves: JWTVerifyGetKey;
  emisor?: string;
  /** Correos de super-admin iniciales (se comparan en minúsculas). */
  adminsIniciales: string[];
};

/** Construye un verificador: firma asimétrica vía JWKS, emisor y audiencia `authenticated`. */
export function crearVerificadorJwt(opciones: OpcionesVerificador): VerificadorJwt {
  const admins = new Set(opciones.adminsIniciales.map((e) => e.toLowerCase()));
  return async (token: string): Promise<Identidad> => {
    let payload: JWTPayload;
    try {
      const resultado = await jwtVerify(token, opciones.claves, {
        ...(opciones.emisor ? { issuer: opciones.emisor } : {}),
        audience: 'authenticated',
        algorithms: ['RS256', 'ES256', 'EdDSA'],
      });
      payload = resultado.payload;
    } catch {
      throw new ErrorAutenticacion('token inválido o expirado');
    }
    const userId = typeof payload.sub === 'string' ? payload.sub : '';
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (!userId || !email) throw new ErrorAutenticacion('token sin identidad');
    const roles = Array.isArray(payload.roles) ? payload.roles.filter((r): r is string => typeof r === 'string') : [];
    return { userId, email, roles, esAdmin: admins.has(email) || roles.includes('admin') };
  };
}

export function claveDesdeJwksRemoto(url: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(url));
}

export function claveDesdeJwksLocal(jwks: { keys: object[] }): JWTVerifyGetKey {
  return createLocalJWKSet(jwks as Parameters<typeof createLocalJWKSet>[0]);
}
