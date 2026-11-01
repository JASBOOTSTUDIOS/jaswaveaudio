/**
 * Licencia del equipo (L3): tras iniciar sesión, el DAW renueva la licencia firmada, la guarda para
 * que los VST JasWave de este equipo la usen (también en otros DAW) y aplica las funciones concedidas
 * a las herramientas de IA de los plugins. Renueva sola antes de que venza (vigencia 24 h).
 */

import { configurarLicenciasPlugins } from '../plugins/registro-plugins'
import { ErrorApiCliente, type ClienteApi } from './api'

export type CargaLicenciaLocal = {
  sub: string
  email: string
  dispositivo: string
  productos: Record<string, string[]>
  iat: number
  exp: number
}

/** Lee la carga de una licencia jwl1 sin verificar la firma (solo para mostrarla; el VST la verifica). */
export function leerCargaLicencia(token: string): CargaLicenciaLocal | null {
  const partes = token.split('.')
  if (partes.length !== 3 || partes[0] !== 'jwl1') return null
  try {
    const b64 = partes[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    )
    const c = JSON.parse(json) as CargaLicenciaLocal
    return typeof c.exp === 'number' && c.productos && typeof c.productos === 'object' ? c : null
  } catch {
    return null
  }
}

export type EstadoLicenciaEquipo =
  | { estado: 'activa'; productos: Record<string, string[]>; expiraEn: Date }
  | { estado: 'sin-licencia' }
  | { estado: 'error'; mensaje: string }

/** Margen de renovación: se renueva cuando quedan menos de 6 h. */
export const MARGEN_RENOVACION_MS = 6 * 60 * 60 * 1000

export type PuertoLicenciaLocal = {
  nombreEquipo: () => Promise<string>
  leerTokenDispositivo: () => Promise<string | null>
  guardar: (datos: { token: string; tokenDispositivo: string }) => Promise<unknown>
}

/** Puerto de escritorio (Electron); en web no hay almacenamiento compartido con VST. */
export function puertoEscritorio(): PuertoLicenciaLocal | null {
  const e = typeof window !== 'undefined' ? window.electron : undefined
  if (!e?.licenciaGuardar || !e.licenciaTokenDispositivo) return null
  return {
    nombreEquipo: async () => (await e.equipoNombre?.()) || 'Equipo JasWave',
    leerTokenDispositivo: () => e.licenciaTokenDispositivo!(),
    guardar: (d) => e.licenciaGuardar!(d),
  }
}

export async function renovarLicenciaEquipo(api: ClienteApi, puerto: PuertoLicenciaLocal | null): Promise<EstadoLicenciaEquipo> {
  try {
    const dispositivo = puerto ? await puerto.nombreEquipo() : 'Navegador'
    const tokenDispositivo = puerto ? (await puerto.leerTokenDispositivo()) ?? undefined : undefined
    const r = await api.refrescarLicencia({ dispositivo, ...(tokenDispositivo ? { tokenDispositivo } : {}) })
    if (puerto) await puerto.guardar({ token: r.token, tokenDispositivo: r.tokenDispositivo })
    configurarLicenciasPlugins((productId) => r.productos[productId] ?? [])
    return { estado: 'activa', productos: r.productos, expiraEn: new Date(r.expiraEn) }
  } catch (e) {
    if (e instanceof ErrorApiCliente && e.codigo === 'sin_licencia') {
      configurarLicenciasPlugins(() => [])
      return { estado: 'sin-licencia' }
    }
    return { estado: 'error', mensaje: e instanceof Error ? e.message : String(e) }
  }
}

/** Ms hasta la próxima renovación (mínimo 1 min; reintento en 5 min si hubo error). */
export function msHastaRenovar(estado: EstadoLicenciaEquipo, ahora = Date.now()): number {
  if (estado.estado !== 'activa') return 5 * 60 * 1000
  return Math.max(60_000, estado.expiraEn.getTime() - MARGEN_RENOVACION_MS - ahora)
}
