/**
 * Archivos para módulos (M3): diálogos y lectura/escritura a través del DAW. En escritorio usan el puente
 * de Electron (con las mismas concesiones de ruta que el resto del DAW); en la web, guardar descarga el
 * archivo y elegir carpeta no está disponible. Los módulos nunca usan `window.electron` directamente.
 */

import { saveBinaryOrThrow } from '../lib/electron-fs'

/** True en JasWave Desktop (hay disco). */
export function archivosDeEscritorio(): boolean {
  return typeof window !== 'undefined' && typeof window.electron?.fileSaveBinary === 'function'
}

/** Diálogo «guardar como». null si se cancela o no hay escritorio. */
export async function elegirRutaGuardar(nombreSugerido: string): Promise<string | null> {
  const api = typeof window !== 'undefined' ? window.electron : undefined
  if (!api?.dialogSave) return null
  const r = await api.dialogSave(nombreSugerido)
  return r && !r.canceled && r.filePath ? r.filePath : null
}

/** Diálogo para elegir carpeta. null si se cancela o no hay escritorio. */
export async function elegirCarpeta(): Promise<string | null> {
  const api = typeof window !== 'undefined' ? window.electron : undefined
  if (!api?.dialogOpenDirectory) return null
  const r = await api.dialogOpenDirectory()
  return r && !r.canceled && r.filePaths?.[0] ? r.filePaths[0] : null
}

export async function guardarBinario(ruta: string, datos: Uint8Array): Promise<void> {
  await saveBinaryOrThrow(ruta, datos)
}

export async function leerTexto(ruta: string): Promise<string | null> {
  const api = typeof window !== 'undefined' ? window.electron : undefined
  if (!api?.fileRead) return null
  return (await api.fileRead(ruta)) ?? null
}

export async function guardarTexto(ruta: string, texto: string): Promise<void> {
  const api = typeof window !== 'undefined' ? window.electron : undefined
  if (!api?.fileSave) throw new Error('Guardado en disco no disponible')
  const r = await api.fileSave(ruta, texto)
  if (r && r.success === false) throw new Error(r.error || `No se pudo guardar ${ruta}`)
}

/** Web (o sin disco): ofrece el archivo como descarga del navegador. */
export function descargarArchivo(nombre: string, datos: Uint8Array | string, tipo = 'application/octet-stream'): void {
  const blob = new Blob([typeof datos === 'string' ? datos : new Uint8Array(datos)], { type: tipo })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
