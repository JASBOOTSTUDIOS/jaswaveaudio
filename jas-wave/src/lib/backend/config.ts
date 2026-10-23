/**
 * Configuración del backend JasWave y de Supabase Auth (se fija en build con variables VITE_*).
 * Valores por defecto: entorno local (backend/README.md).
 */

type EnvVite = Record<string, string | undefined>

function envVite(): EnvVite {
  // En pruebas con tsx no existe import.meta.env.
  return ((import.meta as unknown as { env?: EnvVite }).env ?? {}) as EnvVite
}

export type ProveedorOAuth = 'google' | 'github'

export type ConfigBackend = {
  apiUrl: string
  supabaseUrl: string
  supabaseAnonKey: string
  proveedoresOAuth: ProveedorOAuth[]
}

export function configBackend(env: EnvVite = envVite()): ConfigBackend {
  const sinBarra = (u: string) => u.replace(/\/+$/, '')
  return {
    apiUrl: sinBarra(env.VITE_API_URL || 'http://127.0.0.1:8787'),
    supabaseUrl: sinBarra(env.VITE_SUPABASE_URL || 'http://127.0.0.1:55321'),
    supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || '',
    proveedoresOAuth: (env.VITE_OAUTH_PROVIDERS || '')
      .split(',')
      .map((p) => p.trim())
      .filter((p): p is ProveedorOAuth => p === 'google' || p === 'github'),
  }
}

export function backendConfigurado(c: ConfigBackend = configBackend()): boolean {
  return Boolean(c.supabaseAnonKey && c.supabaseUrl && c.apiUrl)
}
