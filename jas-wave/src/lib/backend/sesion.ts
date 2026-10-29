/**
 * Sesión de usuario con Supabase Auth (L3) y cliente del backend con el JWT de esa sesión.
 * Correo/contraseña en escritorio y web; OAuth (Google/GitHub) cuando está configurado.
 */

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { backendConfigurado, configBackend, type ProveedorOAuth } from './config'
import { crearClienteApi, type ClienteApi, type Identidad } from './api'

let supabase: SupabaseClient | null = null

/** Espera entre comprobaciones cuando el servidor no responde: 5 s, 10 s, 20 s… hasta 5 min. */
export function esperaTrasFallo(fallosSeguidos: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, fallosSeguidos - 1), 300_000)
}
const ESPERA_SERVIDOR_VIVO_MS = 60_000

/**
 * La renovación automática del token de Supabase reintenta sin parar si el servidor está apagado (p. ej. el
 * Supabase local en desarrollo) y llena la consola de ERR_CONNECTION_REFUSED. Aquí solo se activa mientras el
 * servidor responde a su comprobación de salud; si cae, se detiene y se vuelve a comprobar con espera creciente.
 */
function vigilarServidor(sb: SupabaseClient, urlSalud: string, anonKey: string): void {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return
  let fallos = 0
  const comprobar = async () => {
    let vivo = false
    try {
      const r = await fetch(urlSalud, { headers: { apikey: anonKey }, signal: AbortSignal.timeout(4_000) })
      vivo = r.status < 500
    } catch {
      vivo = false
    }
    if (vivo) {
      fallos = 0
      void sb.auth.startAutoRefresh()
    } else {
      fallos += 1
      void sb.auth.stopAutoRefresh()
    }
    setTimeout(comprobar, vivo ? ESPERA_SERVIDOR_VIVO_MS : esperaTrasFallo(fallos))
  }
  void comprobar()
}

export function clienteSupabase(): SupabaseClient {
  if (!supabase) {
    const c = configBackend()
    if (!backendConfigurado(c)) throw new Error('Falta configurar VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_API_URL')
    supabase = createClient(c.supabaseUrl, c.supabaseAnonKey, {
      // La renovación la gobierna vigilarServidor(): solo corre si el servidor responde.
      auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: true },
    })
    vigilarServidor(supabase, `${c.supabaseUrl}/auth/v1/health`, c.supabaseAnonKey)
  }
  return supabase
}

export async function tokenSesion(): Promise<string | null> {
  if (!backendConfigurado()) return null
  const { data } = await clienteSupabase().auth.getSession()
  return data.session?.access_token ?? null
}

let api: ClienteApi | null = null
export function apiJasWave(): ClienteApi {
  if (!api) api = crearClienteApi({ base: configBackend().apiUrl, token: tokenSesion })
  return api
}

export async function iniciarSesion(email: string, password: string): Promise<void> {
  const { error } = await clienteSupabase().auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos' : error.message)
}

export async function iniciarConProveedor(proveedor: ProveedorOAuth): Promise<void> {
  const { error } = await clienteSupabase().auth.signInWithOAuth({
    provider: proveedor,
    options: { redirectTo: window.location.href },
  })
  if (error) throw new Error(error.message)
}

export async function cerrarSesion(): Promise<void> {
  await clienteSupabase().auth.signOut()
}

export type EstadoSesion = {
  cargando: boolean
  session: Session | null
  identidad: Identidad | null
  error: string | null
  /** El backend no está configurado en este build. */
  sinConfigurar: boolean
}

/** Sesión actual + identidad del backend (incluye `esAdmin`, que el servidor vuelve a validar). */
export function useSesion(): EstadoSesion {
  const sinConfigurar = !backendConfigurado()
  const [estado, setEstado] = useState<EstadoSesion>({ cargando: !sinConfigurar, session: null, identidad: null, error: null, sinConfigurar })

  useEffect(() => {
    if (sinConfigurar) return
    let vivo = true
    const cargarIdentidad = async (session: Session | null) => {
      if (!session) {
        if (vivo) setEstado({ cargando: false, session: null, identidad: null, error: null, sinConfigurar })
        return
      }
      try {
        const identidad = await apiJasWave().me()
        if (vivo) setEstado({ cargando: false, session, identidad, error: null, sinConfigurar })
      } catch (e) {
        if (vivo) setEstado({ cargando: false, session, identidad: null, error: e instanceof Error ? e.message : String(e), sinConfigurar })
      }
    }
    const sb = clienteSupabase()
    void sb.auth.getSession().then(({ data }) => cargarIdentidad(data.session))
    const { data } = sb.auth.onAuthStateChange((_evento, session) => {
      void cargarIdentidad(session)
    })
    return () => {
      vivo = false
      data.subscription.unsubscribe()
    }
  }, [sinConfigurar])

  return estado
}
