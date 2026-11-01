/**
 * Guardas de ciclo de vida del proyecto (U1), sin dependencias de UI ni de audio:
 *  - confirmación explícita antes de descartar cambios sin guardar (nuevo/abrir/cerrar/salir, también la IA);
 *  - guardado único: una segunda petición mientras se guarda espera la misma promesa.
 */

export type EleccionCambios = 'guardar' | 'descartar' | 'cancelar'

export type MotivoConfirmacion = 'nuevo' | 'abrir' | 'cerrar' | 'cerrar-app'

export type OrigenConfirmacion = 'usuario' | 'ia'

export type SolicitudConfirmacion = {
  id: number
  motivo: MotivoConfirmacion
  origen: OrigenConfirmacion
}

export type ResultadoConfirmacion = {
  /** true → el llamador puede seguir (no había cambios, se guardó o el usuario eligió descartar). */
  continuar: boolean
  eleccion?: EleccionCambios
  /** Guardado fallido o cancelado (con `eleccion: 'guardar'`). */
  error?: string
}

type Pendiente = SolicitudConfirmacion & { promesa: Promise<EleccionCambios>; resolver: (e: EleccionCambios) => void }

let pendiente: Pendiente | null = null
let siguienteId = 1
const oyentes = new Set<() => void>()

function notificar(): void {
  for (const fn of [...oyentes]) {
    try {
      fn()
    } catch {
      /* un oyente roto no bloquea a los demás */
    }
  }
}

/** Solicitud visible para el diálogo (o null). Estable entre llamadas mientras no cambie. */
export function obtenerSolicitudConfirmacion(): SolicitudConfirmacion | null {
  return pendiente
}

export function suscribirSolicitudConfirmacion(fn: () => void): () => void {
  oyentes.add(fn)
  return () => {
    oyentes.delete(fn)
  }
}

/**
 * Pide al usuario qué hacer con los cambios. Si ya hay una pregunta abierta, devuelve la misma
 * promesa (dos cierres seguidos = un solo diálogo).
 */
export function solicitarEleccionCambios(
  motivo: MotivoConfirmacion,
  origen: OrigenConfirmacion = 'usuario',
): Promise<EleccionCambios> {
  if (pendiente) return pendiente.promesa
  let resolver!: (e: EleccionCambios) => void
  const promesa = new Promise<EleccionCambios>((r) => {
    resolver = r
  })
  pendiente = { id: siguienteId++, motivo, origen, promesa, resolver }
  notificar()
  return promesa
}

/** Respuesta del diálogo. Sin solicitud abierta no hace nada. */
export function responderSolicitudConfirmacion(eleccion: EleccionCambios): void {
  const p = pendiente
  if (!p) return
  pendiente = null
  notificar()
  p.resolver(eleccion)
}

type TiendaLectura = { obtenerEstado: () => { project?: { modificado?: boolean } | null } }

export type OpcionesConfirmar = {
  motivo: MotivoConfirmacion
  origen?: OrigenConfirmacion
  /** Guarda el proyecto (normalmente `guardarProyectoIO`). */
  guardar: () => Promise<{ success: boolean; canceled?: boolean; error?: unknown }>
  /** Inyectable en tests; por defecto abre el diálogo de la app. */
  preguntar?: (motivo: MotivoConfirmacion, origen: OrigenConfirmacion) => Promise<EleccionCambios>
}

function textoError(error: unknown): string {
  if (!error) return 'No se pudo guardar'
  if (typeof error === 'string') return error
  const e = error as { message?: string; code?: string }
  return e.message ?? e.code ?? String(error)
}

/**
 * Antes de descartar el proyecto actual: si tiene cambios, el usuario elige Guardar / No guardar /
 * Cancelar. Nunca descarta en silencio.
 */
export async function confirmarDescartarCambios(
  tienda: TiendaLectura,
  opts: OpcionesConfirmar,
): Promise<ResultadoConfirmacion> {
  if (!tienda.obtenerEstado().project?.modificado) return { continuar: true }
  const origen = opts.origen ?? 'usuario'
  const preguntar = opts.preguntar ?? solicitarEleccionCambios
  const eleccion = await preguntar(opts.motivo, origen)
  if (eleccion === 'cancelar') return { continuar: false, eleccion }
  if (eleccion === 'descartar') return { continuar: true, eleccion }
  const guardado = await opts.guardar()
  if (guardado.canceled) return { continuar: false, eleccion, error: 'Guardado cancelado' }
  if (!guardado.success) return { continuar: false, eleccion, error: textoError(guardado.error) }
  return { continuar: true, eleccion }
}

let guardadoEnCurso: Promise<unknown> | null = null

/**
 * Ejecuta `fn` salvo que ya haya un guardado en curso; en ese caso devuelve esa misma promesa
 * (doble Ctrl+S = un guardado y un diálogo).
 */
export function conGuardadoUnico<T>(fn: () => Promise<T>): Promise<T> {
  if (guardadoEnCurso) return guardadoEnCurso as Promise<T>
  const p: Promise<T> = Promise.resolve()
    .then(fn)
    .finally(() => {
      if (guardadoEnCurso === p) guardadoEnCurso = null
    })
  guardadoEnCurso = p
  return p
}

export function hayGuardadoEnCurso(): boolean {
  return guardadoEnCurso !== null
}

/** Solo tests: limpia el estado del módulo. */
export function _reiniciarGuardasProyecto(): void {
  pendiente = null
  guardadoEnCurso = null
  oyentes.clear()
}
