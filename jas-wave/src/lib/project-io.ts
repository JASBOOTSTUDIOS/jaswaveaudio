/**
 * Operaciones de proyecto compartidas entre UI, atajos y file-service.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { crearEstadoInicial } from '../../../shared/src'
import { clearSessionSnapshot, saveSessionNow } from './session-persist'

export type ResultadoIO = {
  success: boolean
  error?: string | { code?: string; message?: string }
  path?: string
  canceled?: boolean
  requiereConfirmacion?: boolean
}

function mensajeError(error: ResultadoIO['error']): string | undefined {
  if (!error) return undefined
  if (typeof error === 'string') return error
  return error.message ?? error.code
}

export async function guardarProyectoIO(tienda: TiendaDAW): Promise<ResultadoIO> {
  const state = tienda.obtenerEstado()

  if (!state.project.ruta && window.electron?.dialogSave) {
    const dialog = await window.electron.dialogSave()
    if (dialog.canceled || !dialog.filePath) return { success: false, error: 'Canceled', canceled: true }
    const ruta = dialog.filePath.endsWith('.jaswave') ? dialog.filePath : `${dialog.filePath}.jaswave`
    const upd = await tienda.executor.execute('project.update', { datos: { ruta } })
    if (!upd.success) return { success: false, error: upd.error }
    const result = await tienda.executor.execute('project.save', { ruta })
    return { success: result.success, error: result.error, path: ruta }
  }

  if (!state.project.ruta) {
    return { success: false, error: 'Debe indicar una ruta de guardado' }
  }

  const result = await tienda.executor.execute('project.save', {})
  return { success: result.success, error: result.error, path: state.project.ruta }
}

export async function guardarProyectoComoIO(tienda: TiendaDAW): Promise<ResultadoIO> {
  if (!window.electron?.dialogSave) return { success: false, error: 'No dialog available' }
  const dialog = await window.electron.dialogSave()
  if (dialog.canceled || !dialog.filePath) return { success: false, error: 'Canceled', canceled: true }
  const ruta = dialog.filePath.endsWith('.jaswave') ? dialog.filePath : `${dialog.filePath}.jaswave`
  const upd = await tienda.executor.execute('project.update', { datos: { ruta } })
  if (!upd.success) return { success: false, error: upd.error }
  const result = await tienda.executor.execute('project.save', { ruta })
  return { success: result.success, error: result.error, path: ruta }
}

export async function abrirProyectoIO(tienda: TiendaDAW): Promise<ResultadoIO> {
  if (!window.electron?.projectOpenDialog) return { success: false, error: 'Not in Electron' }
  const result = await window.electron.projectOpenDialog()
  if (result.canceled) return { success: false, canceled: true, error: 'Canceled' }
  if (!result.success || !result.path) {
    return { success: false, error: result.error ?? 'No se pudo abrir el proyecto' }
  }

  // Camino canónico: Command System + FileService
  const loaded = await tienda.executor.execute('project.load', { ruta: result.path })
  if (!loaded.success) {
    return { success: false, error: loaded.error ?? 'Error al cargar proyecto' }
  }
  return { success: true, path: result.path }
}

export async function nuevoProyectoIO(tienda: TiendaDAW, nombre = 'Sin título'): Promise<ResultadoIO> {
  const actual = tienda.obtenerEstado()
  if (actual.project?.modificado) {
    const closeAttempt = await tienda.executor.execute('project.close', {})
    if (closeAttempt.success && (closeAttempt.result as { requiereConfirmacion?: boolean })?.requiereConfirmacion) {
      return { success: false, requiereConfirmacion: true, error: 'Hay cambios sin guardar' }
    }
  }

  const result = await tienda.executor.execute('project.new', { nombre })
  if (!result.success) {
    if (!nombre.trim()) {
      tienda.reemplazarEstado(crearEstadoInicial())
      await clearSessionSnapshot()
      await saveSessionNow(tienda)
      return { success: true }
    }
    return { success: false, error: result.error }
  }
  await clearSessionSnapshot()
  await saveSessionNow(tienda)
  return { success: true }
}

export async function cerrarProyectoIO(tienda: TiendaDAW, opts?: { forzar?: boolean }): Promise<ResultadoIO> {
  const result = await tienda.executor.execute('project.close', {
    ...(opts?.forzar ? { forzar: true } : {}),
  })
  if (result.success && (result.result as { requiereConfirmacion?: boolean })?.requiereConfirmacion) {
    return { success: true, requiereConfirmacion: true }
  }
  return { success: result.success, error: result.error }
}

export { mensajeError }
