/**
 * Extensiones `.jwx` (X1): plugins y módulos que se instalan desde un archivo, como los `.vsix` de VS Code.
 * El proceso main verifica e instala; aquí está el flujo de la UI (inspeccionar → confirmar → instalar →
 * recargar plugins y módulos sin reiniciar).
 */

import { cargarPluginsInstalados } from './registro-plugins'

export type EstadoFirma = 'valida' | 'ausente' | 'invalida'

export type InspeccionJwx = {
  id: string
  nombre: string
  version: string
  descripcion: string
  tipo: 'modulo' | 'vst3'
  firma: EstadoFirma
  motivoFirma?: string
  tamano: number
}

export type OrigenExtension = 'catalogo' | 'archivo-firmado' | 'desarrollo'

export type ResultadoInstalacionJwx =
  | { ok: true; ruta: string; origen: OrigenExtension; paquete: InspeccionJwx }
  | { ok: false; error: string; paquete?: InspeccionJwx; requiereConfirmacion?: boolean }

export const ETIQUETA_ORIGEN: Record<OrigenExtension, string> = {
  catalogo: 'Catálogo',
  'archivo-firmado': 'Archivo firmado',
  desarrollo: 'Sin firmar (desarrollo)',
}

export function extensionesDisponibles(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electron?.pluginsInstalarArchivo)
}

export function esArchivoJwx(nombre: string): boolean {
  return /\.jwx$/i.test(nombre.trim())
}

/** Ruta de un .jwx soltado en la ventana (null si no es un .jwx o no hay ruta en disco). */
export function rutaDeArchivoSoltado(archivo: File): string | null {
  if (!esArchivoJwx(archivo.name)) return null
  try {
    const ruta = window.electron?.rutaDeArchivo?.(archivo)
    return ruta && esArchivoJwx(ruta) ? ruta : null
  } catch {
    return null
  }
}

export async function inspeccionarJwx(ruta: string): Promise<{ ok: true; paquete: InspeccionJwx } | { ok: false; error: string }> {
  const e = window.electron
  if (!e?.pluginsInspeccionarArchivo) return { ok: false, error: 'Instalar desde archivo solo está disponible en la app de escritorio' }
  return e.pluginsInspeccionarArchivo(ruta)
}

/** Instala y, si va bien, recarga plugins y módulos (aparecen sin reiniciar). */
export async function instalarJwx(ruta: string, aceptarSinFirma = false): Promise<ResultadoInstalacionJwx> {
  const e = window.electron
  if (!e?.pluginsInstalarArchivo) return { ok: false, error: 'Instalar desde archivo solo está disponible en la app de escritorio' }
  const r = await e.pluginsInstalarArchivo(ruta, { aceptarSinFirma })
  if (r.ok) await cargarPluginsInstalados()
  return r
}

export async function desinstalarExtension(id: string): Promise<{ ok: boolean; error?: string }> {
  const e = window.electron
  if (!e?.pluginsDesinstalar) return { ok: false, error: 'no disponible' }
  const r = await e.pluginsDesinstalar(id)
  if (r.ok) await cargarPluginsInstalados()
  return r
}

export function formatoTamano(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
