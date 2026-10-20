/**
 * Operaciones de proyecto compartidas entre UI, atajos y file-service.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { crearEstadoInicial } from '../../../shared/src'
import { esNombreSinTitulo, nombreAlGuardar } from '../../../shared/src/project/ciclo-vida'
import { clearSessionSnapshot, saveSessionNow } from './session-persist'
import {
  conGuardadoUnico,
  confirmarDescartarCambios,
  type MotivoConfirmacion,
  type OrigenConfirmacion,
  type ResultadoConfirmacion,
} from './project-guards'

export type ResultadoIO = {
  success: boolean
  error?: string | { code?: string; message?: string }
  path?: string
  canceled?: boolean
  requiereConfirmacion?: boolean
  /** El usuario canceló porque había cambios sin guardar (o falló el guardado previo). */
  cambiosSinGuardar?: boolean
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

/**
 * Guardar (menú, atajo, barra, IA y CLI). Una segunda llamada mientras se guarda
 * espera la misma promesa: un solo diálogo y un solo guardado.
 */
export function guardarProyectoIO(tienda: TiendaDAW): Promise<ResultadoIO> {
  return conGuardadoUnico(() => guardarProyectoImpl(tienda))
}

async function guardarProyectoImpl(tienda: TiendaDAW): Promise<ResultadoIO> {
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

export function guardarProyectoComoIO(tienda: TiendaDAW): Promise<ResultadoIO> {
  return conGuardadoUnico(() => guardarProyectoComoImpl(tienda))
}

async function guardarProyectoComoImpl(tienda: TiendaDAW): Promise<ResultadoIO> {
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

/**
 * Si hay cambios sin guardar, pregunta Guardar / No guardar / Cancelar (diálogo de la app).
 * La usan nuevo, abrir, cerrar, salir y las acciones de IA/CLI: nunca se descarta en silencio.
 */
export async function confirmarCambiosIO(
  tienda: TiendaDAW,
  motivo: MotivoConfirmacion,
  origen: OrigenConfirmacion = 'usuario',
): Promise<ResultadoConfirmacion> {
  const r = await confirmarDescartarCambios(tienda, { motivo, origen, guardar: () => guardarProyectoIO(tienda) })
  if (r.error && r.eleccion === 'guardar' && r.error !== 'Guardado cancelado') {
    tienda.busEventos.emit('comando.fallido', { type: 'project.save', error: r.error })
  }
  return r
}

function canceladoPorCambios(r: ResultadoConfirmacion): ResultadoIO {
  return {
    success: false,
    canceled: true,
    cambiosSinGuardar: true,
    error: r.error ?? 'Cancelado: hay cambios sin guardar',
  }
}

export async function abrirProyectoIO(tienda: TiendaDAW): Promise<ResultadoIO> {
  if (!window.electron?.projectOpenDialog) return { success: false, error: 'Not in Electron' }
  const confirmado = await confirmarCambiosIO(tienda, 'abrir')
  if (!confirmado.continuar) return canceladoPorCambios(confirmado)
  const result = await window.electron.projectOpenDialog()
  if (result.canceled) return { success: false, canceled: true, error: 'Canceled' }
  if (!result.success || !result.path) {
    return { success: false, error: result.error ?? 'No se pudo abrir el proyecto' }
  }

  return cargarProyectoDesdeRutaIO(tienda, result.path)
}

/**
 * Carga un .jaswave ya concedido por main (diálogo o CLI autenticada) y aplica
 * los pasos posteriores comunes (biblioteca, migraciones).
 */
export async function cargarProyectoDesdeRutaIO(tienda: TiendaDAW, ruta: string): Promise<ResultadoIO> {
  // Camino canónico: Command System + FileService
  const loaded = await tienda.executor.execute('project.load', { ruta })
  if (!loaded.success) {
    return { success: false, error: loaded.error ?? 'Error al cargar proyecto' }
  }
  try {
    const { loadLibraryFromDisk } = await import('./library/preset-catalog')
    const project = tienda.obtenerEstado().project
    await loadLibraryFromDisk(project.id || 'default', project.ruta)
  } catch {
    /* biblioteca best-effort */
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
  return { success: true, path: ruta }
}

export async function nuevoProyectoIO(
  tienda: TiendaDAW,
  nombre = 'Sin título',
  origen: OrigenConfirmacion = 'usuario',
): Promise<ResultadoIO> {
  const confirmado = await confirmarCambiosIO(tienda, 'nuevo', origen)
  if (!confirmado.continuar) return canceladoPorCambios(confirmado)

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
  if (!opts?.forzar) {
    const confirmado = await confirmarCambiosIO(tienda, 'cerrar')
    if (!confirmado.continuar) return canceladoPorCambios(confirmado)
    opts = { forzar: true }
  }
  const result = await tienda.executor.execute('project.close', {
    ...(opts?.forzar ? { forzar: true } : {}),
  })
  if (result.success && (result.result as { requiereConfirmacion?: boolean })?.requiereConfirmacion) {
    return { success: true, requiereConfirmacion: true }
  }
  return { success: result.success, error: result.error }
}

export { mensajeError }
