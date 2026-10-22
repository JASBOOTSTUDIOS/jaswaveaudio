/**
 * Operaciones de proyecto compartidas entre UI, atajos y file-service.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { crearEstadoInicial } from '../../../shared/src'
import { isUndockWindow } from '@/lib/undock-window'
import { esNombreSinTitulo, nombreAlGuardar } from '../../../shared/src/project/ciclo-vida'
import { clearSessionSnapshot, saveSessionNow } from './session-persist'
import { detectarConflictoProyecto, refrescarFirmaArchivo } from './project-conflict'
import { solicitarDecisionConflicto } from './save-conflict'
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
  /** U7: la petición se reenvió a la ventana principal (satélite). */
  reenviado?: boolean
}

function mensajeError(error: ResultadoIO['error']): string | undefined {
  if (!error) return undefined
  if (typeof error === 'string') return error
  return error.message ?? error.code
}

function rutaNormalizada(filePath: string): string {
  return filePath.endsWith('.jaswave') ? filePath : `${filePath}.jaswave`
}

/** ¿Esta ventana es un satélite (undock)? */
function esSatelite(): boolean {
  try {
    return isUndockWindow()
  } catch {
    return false
  }
}

/**
 * U7: el satélite no tiene autoridad sobre el proyecto → reenvía la petición a
 * la ventana principal (que es la que guarda, abre y deshace).
 */
async function reenviarAlPrimario(
  accion: 'guardar' | 'guardar-como' | 'abrir',
  payload?: { ruta?: string },
): Promise<ResultadoIO> {
  try {
    const { enviarMensaje } = await import('../workspace/satellite-channel')
    const enviado = enviarMensaje({ type: 'action', action: accion, payload })
    if (!enviado) return { success: false, error: 'No se pudo contactar con la ventana principal' }
    return { success: true, reenviado: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function nombreSugeridoDialogo(nombre: string | undefined): string | undefined {
  if (!nombre || esNombreSinTitulo(nombre)) return undefined
  return `${nombre}.jaswave`
}

/**
 * Detiene el transporte y espera a que la toma en curso esté escrita en disco.
 * Sin esto, abrir o cerrar el proyecto durante una grabación pierde el audio.
 */
export async function detenerTransporteYFinalizarGrabacion(tienda: TiendaDAW): Promise<void> {
  const estado = tienda.obtenerEstado()
  const grabando = estado.transport?.grabacion === 'grabando'
  if (grabando) {
    // El provider es quien corta la captura y escribe el WAV.
    await tienda.executor.execute('transport.toggleRecord', {})
    const { esperarFinalizacionGrabacion } = await import('./recording-session')
    await esperarFinalizacionGrabacion()
  }
  if (tienda.obtenerEstado().transport?.reproduciendo) {
    await tienda.executor.execute('transport.stop', {})
  }
}

async function persistirRutaYGuardar(tienda: TiendaDAW, ruta: string): Promise<ResultadoIO> {
  const nombre = nombreAlGuardar(tienda.obtenerEstado().project.nombre, ruta)
  const upd = await tienda.executor.execute('project.update', { datos: { ruta, nombre } })
  if (!upd.success) return { success: false, error: upd.error }
  await asentarMediaEnProyecto(tienda, ruta)
  const result = await tienda.executor.execute('project.save', { ruta })
  if (result.success) await refrescarFirmaArchivo(ruta)
  return { success: result.success, error: result.error, path: ruta }
}

/**
 * Antes de guardar: mueve el media pendiente (`media/pending/`) al `media/` del
 * proyecto y reapunta los clips. Así el archivo guardado ya guarda la ruta
 * definitiva. Si algo falla, el proyecto se guarda igual.
 */
async function asentarMediaEnProyecto(tienda: TiendaDAW, ruta: string): Promise<void> {
  try {
    const { moverMediaPendienteAlProyecto } = await import('./project-media-flow')
    await moverMediaPendienteAlProyecto(tienda, ruta)
  } catch {
    /* best-effort: el proyecto se guarda aunque el media no se asiente */
  }
}

/**
 * Guardar (menú, atajo, barra, IA y CLI). Una segunda llamada mientras se guarda
 * espera la misma promesa: un solo diálogo y un solo guardado.
 */
export function guardarProyectoIO(tienda: TiendaDAW): Promise<ResultadoIO> {
  // U7: el satélite no guarda (su estado es un recorte sin waveforms): lo pide
  // la ventana principal, que es la dueña del proyecto.
  if (esSatelite()) {
    return reenviarAlPrimario('guardar')
  }
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

  await asentarMediaEnProyecto(tienda, state.project.ruta)

  // U7: si el archivo cambió fuera de JasWave, no se pisa sin preguntar.
  const conflicto = await detectarConflictoProyecto(state.project.ruta)
  if (conflicto) {
    const eleccion = await solicitarDecisionConflicto(conflicto)
    if (eleccion === 'cancelar') {
      return { success: false, error: 'Guardado cancelado: el archivo cambió en disco', canceled: true }
    }
    if (eleccion === 'guardar-como') return guardarProyectoComoImpl(tienda)
  }

  const result = await tienda.executor.execute('project.save', {})
  if (result.success) await refrescarFirmaArchivo(state.project.ruta)
  return { success: result.success, error: result.error, path: state.project.ruta }
}

export function guardarProyectoComoIO(tienda: TiendaDAW): Promise<ResultadoIO> {
  // U7: en un satélite el "guardar como" lo hace la ventana principal.
  if (esSatelite()) {
    return reenviarAlPrimario('guardar-como')
  }
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
  const rutaAnterior = state.project.ruta
  const dialog = await window.electron.dialogSave(nombreSugeridoDialogo(state.project.nombre))
  if (dialog.canceled || !dialog.filePath) return { success: false, error: 'Canceled', canceled: true }
  const ruta = rutaNormalizada(dialog.filePath)

  // "Guardar como": el media del proyecto se copia a la carpeta destino.
  // Las rutas relativas no cambian, solo los archivos.
  if (rutaAnterior && rutaAnterior !== ruta) {
    try {
      const { copiarMediaEntreProyectos } = await import('./project-media-flow')
      await copiarMediaEntreProyectos(rutaAnterior, ruta)
    } catch {
      /* best-effort: el proyecto se guarda aunque falle la copia del media */
    }
  }

  return persistirRutaYGuardar(tienda, ruta)
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

export async function abrirProyectoIO(
  tienda: TiendaDAW,
  opts?: { ruta?: string },
): Promise<ResultadoIO> {
  // U7: en un satélite, abrir lo hace la ventana principal (dialogo y carga).
  if (esSatelite()) {
    return reenviarAlPrimario('abrir', { ruta: opts?.ruta })
  }
  if (!window.electron?.projectOpenDialog) return { success: false, error: 'Not in Electron' }
  const confirmado = await confirmarCambiosIO(tienda, 'abrir')
  if (!confirmado.continuar) return canceladoPorCambios(confirmado)
  if (opts?.ruta) {
    return cargarProyectoDesdeRutaIO(tienda, opts.ruta)
  }
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
  // La toma en curso se escribe antes de cambiar de proyecto (U6).
  await detenerTransporteYFinalizarGrabacion(tienda)
  // Camino canónico: Command System + FileService
  const loaded = await tienda.executor.execute('project.load', { ruta })
  if (!loaded.success) {
    return { success: false, error: loaded.error ?? 'Error al cargar proyecto' }
  }
  await avisarMediaFaltante(tienda, loaded.result, ruta)
  // U7: la firma del archivo pasa a ser la conocida (para detectar cambios externos).
  await refrescarFirmaArchivo(ruta)
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

/**
 * Si el proyecto se abrió con audio faltante, publica el aviso para el
 * diálogo "Media faltante" (no bloquea la carga: el proyecto sigue abierto).
 */
async function avisarMediaFaltante(
  tienda: TiendaDAW,
  result: unknown,
  ruta: string,
): Promise<void> {
  const mediaFaltante = (result as { mediaFaltante?: Array<{ id: string; rutaRelativa: string; formato?: string }> })
    ?.mediaFaltante
  if (!Array.isArray(mediaFaltante) || mediaFaltante.length === 0) return
  try {
    const { solicitarMediaFaltante } = await import('./media-faltante')
    void solicitarMediaFaltante(
      mediaFaltante.map((r) => ({ id: r.id, rutaRelativa: r.rutaRelativa, formato: r.formato })),
      ruta,
    )
  } catch {
    /* best-effort */
  }
}

export async function nuevoProyectoIO(
  tienda: TiendaDAW,
  nombre = 'Sin título',
  origen: OrigenConfirmacion = 'usuario',
): Promise<ResultadoIO> {
  const confirmado = await confirmarCambiosIO(tienda, 'nuevo', origen)
  if (!confirmado.continuar) return canceladoPorCambios(confirmado)

  await detenerTransporteYFinalizarGrabacion(tienda)

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
  await detenerTransporteYFinalizarGrabacion(tienda)
  const result = await tienda.executor.execute('project.close', {
    ...(opts?.forzar ? { forzar: true } : {}),
  })
  if (result.success && (result.result as { requiereConfirmacion?: boolean })?.requiereConfirmacion) {
    return { success: true, requiereConfirmacion: true }
  }
  return { success: result.success, error: result.error }
}

export { mensajeError }
