/**
 * Aviso de media faltante al abrir un proyecto (U4).
 *
 * Sin dependencias de UI: el flujo de proyecto publica la solicitud y el
 * diálogo de la app la resuelve ("Buscar en carpeta…" / "Ignorar").
 */

export type ReferenciaMediaFaltante = {
  /** Id de la referencia (clip) en el proyecto. */
  id: string
  /** Ruta relativa dentro del proyecto (`media/intro.wav`). */
  rutaRelativa: string
  /** Formato del archivo. */
  formato?: string
}

export type SolicitudMediaFaltante = {
  id: number
  referencias: ReferenciaMediaFaltante[]
  /** Carpeta del proyecto (para saber dónde se copiará el media reenlazado). */
  rutaProyecto?: string | null
}

export type RespuestaMediaFaltante = 'ignorar' | 'buscar'

type Pendiente = SolicitudMediaFaltante & {
  promesa: Promise<RespuestaMediaFaltante>
  resolver: (r: RespuestaMediaFaltante) => void
}

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

/** Solicitud visible para el diálogo (o null). */
export function obtenerSolicitudMediaFaltante(): SolicitudMediaFaltante | null {
  if (!pendiente) return null
  return { id: pendiente.id, referencias: pendiente.referencias, rutaProyecto: pendiente.rutaProyecto }
}

export function suscribirSolicitudMediaFaltante(fn: () => void): () => void {
  oyentes.add(fn)
  return () => {
    oyentes.delete(fn)
  }
}

/** Publica la solicitud de media faltante (idempotente: no duplica diálogo). */
export function solicitarMediaFaltante(
  referencias: ReferenciaMediaFaltante[],
  rutaProyecto?: string | null,
): Promise<RespuestaMediaFaltante> {
  if (pendiente) return pendiente.promesa
  if (!referencias.length) return Promise.resolve('ignorar')
  let resolver!: (r: RespuestaMediaFaltante) => void
  const promesa = new Promise<RespuestaMediaFaltante>((r) => {
    resolver = r
  })
  pendiente = { id: siguienteId++, referencias, rutaProyecto: rutaProyecto ?? null, promesa, resolver }
  notificar()
  return promesa
}

/** Respuesta del diálogo. Sin solicitud abierta no hace nada. */
export function responderSolicitudMediaFaltante(respuesta: RespuestaMediaFaltante): void {
  const p = pendiente
  if (!p) return
  pendiente = null
  notificar()
  p.resolver(respuesta)
}

/** Solo tests: limpia el estado del módulo. */
export function _reiniciarMediaFaltante(): void {
  pendiente = null
  oyentes.clear()
}
