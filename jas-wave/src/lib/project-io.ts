/**
 * Operaciones de proyecto compartidas entre UI, atajos y file-service.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { crearEstadoInicial } from '../../../shared/src'
import { esNombreSinTitulo, nombreAlGuardar } from '../../../shared/src/project/ciclo-vida'
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

function rutaNormalizada(filePath: string): string {
  return filePath.endsWith('.jaswave') ? filePath : `${filePath}.jaswave`
}

function nombreSugeridoDialogo(nombre: string | undefined): string | undefined {
  if (!nombre || esNombreSinTitulo(nombre)) return undefined
  return `${nombre}.jaswave`
}

async function persistirRutaYGuardar(tienda: TiendaDAW, ruta: string): Promise<ResultadoIO> {
  const nombre = nombreAlGuardar(tienda.obtenerEstado().project.nombre, ruta)
  const upd = await tienda.executor.execute('project.update', { datos: { ruta, nombre } })
  if (!upd.success) return { success: false, error: upd.error }
  const result = await tienda.executor.execute('project.save', { ruta })
  return { success: result.success, error: result.error, path: ruta }
}

export async function guardarProyectoIO(tienda: TiendaDAW): Promise<ResultadoIO> {
  try {
    const { snapshotLoadedPluginsIntoProject } = await import('./plugin/track-vst-runtime')
    await snapshotLoadedPluginsIntoProject(tienda)
  } catch {
    /* best-effort: guardar aunque falle el snapshot VST */
  }

  const state = tienda.obtenerEstado()

  if (!state.project.ruta && window.electron?.dialogSave) {
    const dialog = await window.electron.dialogSave(nombreSugeridoDialogo(state.project.nombre))
    if (dialog.canceled || !dialog.filePath) return { success: false, error: 'Canceled', canceled: true }
    return persistirRutaYGuardar(tienda, rutaNormalizada(dialog.filePath))
  }

  if (!state.project.ruta) {
    return { success: false, error: 'Debe indicar una ruta de guardado' }
  }

  const result = await tienda.executor.execute('project.save', {})
  return { success: result.success, error: result.error, path: state.project.ruta }
}

export async function guardarProyectoComoIO(tienda: TiendaDAW): Promise<ResultadoIO> {
  if (!window.electron?.dialogSave) return { success: false, error: 'No dialog available' }
  try {
    const { snapshotLoadedPluginsIntoProject } = await import('./plugin/track-vst-runtime')
    await snapshotLoadedPluginsIntoProject(tienda)
  } catch {
    /* ignore */
  }
  const state = tienda.obtenerEstado()
  const dialog = await window.electron.dialogSave(nombreSugeridoDialogo(state.project.nombre))
  if (dialog.canceled || !dialog.filePath) return { success: false, error: 'Canceled', canceled: true }
  return persistirRutaYGuardar(tienda, rutaNormalizada(dialog.filePath))
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
  try {
    const { migrateSoftPadPluginsInProject } = await import('./plugin/migrate-softpad-to-roles')
    const project = tienda.obtenerEstado().project
    const { migrated, removed } = migrateSoftPadPluginsInProject(project)
    if (migrated + removed > 0) {
      tienda.establecerEstado((s) => ({
        ...s,
        project: { ...project, modificado: true },
      }))
    }
  } catch {
    /* migración best-effort */
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
