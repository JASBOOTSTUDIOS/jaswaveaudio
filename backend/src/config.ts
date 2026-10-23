import { z } from 'zod';

const esquema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  /** URL del JWKS de Supabase Auth (claves públicas para verificar JWT). */
  SUPABASE_JWKS_URL: z.string().url().optional(),
  /** Emisor esperado de los JWT (p. ej. http://127.0.0.1:55321/auth/v1). */
  JWT_ISSUER: z.string().optional(),
  /** Correos con rol de super-admin (separados por coma). */
  ADMIN_EMAILS: z.string().default(''),
  /** Conexión Postgres (Supabase local por defecto). */
  DATABASE_URL: z.string().optional(),
  /** Clave privada Ed25519 (PEM, PKCS8) para firmar licencias. */
  LICENSE_SIGNING_KEY_PEM: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** Clave maestra (32 bytes en base64) para cifrar las claves de los proveedores de IA en la BD. */
  IA_CLAVE_MAESTRA: z.string().optional(),
});

export type Configuracion = {
  puerto: number;
  entorno: 'development' | 'test' | 'production';
  nivelLog: string;
  jwksUrl?: string;
  emisorJwt?: string;
  adminsIniciales: string[];
  urlBaseDatos?: string;
  clavePrivadaLicencia?: string;
  origenesCors: string[];
  claveMaestraIA?: string;
};

export function cargarConfiguracion(entorno: NodeJS.ProcessEnv = process.env): Configuracion {
  const v = esquema.parse(entorno);
  return {
    puerto: v.PORT,
    entorno: v.NODE_ENV,
    nivelLog: v.LOG_LEVEL,
    ...(v.SUPABASE_JWKS_URL ? { jwksUrl: v.SUPABASE_JWKS_URL } : {}),
    ...(v.JWT_ISSUER ? { emisorJwt: v.JWT_ISSUER } : {}),
    adminsIniciales: v.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    ...(v.DATABASE_URL ? { urlBaseDatos: v.DATABASE_URL } : {}),
    // En .env el PEM va en una línea con `\n` literales; aquí se restauran los saltos reales.
    ...(v.LICENSE_SIGNING_KEY_PEM ? { clavePrivadaLicencia: v.LICENSE_SIGNING_KEY_PEM.replace(/\\n/g, '\n') } : {}),
    origenesCors: v.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    ...(v.IA_CLAVE_MAESTRA ? { claveMaestraIA: v.IA_CLAVE_MAESTRA } : {}),
  };
}
