/**
 * Proveedor de análisis de audio (A7b).
 *
 * Propósito:
 *   Desacoplar las herramientas `analysis.*` (que viven en @jaswave/shared) del
 *   render real (que vive en la app Electron: host nativo + Web Audio).
 *
 * Importancia:
 *   - `shared` no puede depender del renderer ni del host nativo: el proveedor
 *     se inyecta desde la app y permite que shared calcule diagnóstico,
 *     enmascaramiento y comparaciones con datos medidos de verdad.
 *   - Si no hay proveedor (CLI, tests, agente sin audio), los comandos avisan
 *     con un mensaje claro en lugar de devolver datos inventados.
 *
 * Función:
 *   - Define `RequerimientoAnalisis`, `AnalisisProyecto` y `ProveedorAnalisis`.
 *   - `registrarProveedorAnalisis` / `obtenerProveedorAnalisis` guardan el
 *     proveedor activo (uno solo; la app lo registra al montar el contexto).
 */

import type { MedidaPista } from './diagnosis'

/** Rango temporal en segundos (timeline del proyecto). */
export type RangoAnalisis = {
  inicioSeg: number
  finSeg: number
}

/** Petición de medición (sin efectos sobre el proyecto). */
export type RequerimientoAnalisis = {
  /** Revisión del estado: si no cambia, el render se puede reutilizar. */
  revision: string
  /** Ids de pistas a medir. Vacío o undefined = todas. */
  pistas?: string[]
  /** Rango a medir (por defecto: proyecto entero). */
  rango?: RangoAnalisis
  /** Punto del tap: post-insert (por defecto) o pre-fader. */
  tap?: 'pre' | 'post'
  /** Ignorar la cadena master (para medir la mezcla antes del master). */
  bypassMaster?: boolean
}

/** Metadatos del render usado para la medición. */
export type MetadatosRenderAnalisis = {
  /** Backend usado ('nativo', 'ts'…). */
  backend: string
  tap: 'pre' | 'post'
  bypassMaster: boolean
  sampleRate: number
  duracionSeg: number
  /** true si el render vino de caché (no se re-renderizó). */
  cache?: boolean
}

/** Resultado de un análisis: medidas por pista + master + suma. */
export type AnalisisProyecto = {
  revision: string
  rango: RangoAnalisis
  /** Medidas por pista (en el orden del proyecto). */
  pistas: MedidaPista[]
  /** Medida del master (cadena master incluida, salvo bypassMaster). */
  master: MedidaPista
  /** Suma de las pistas antes de la cadena master (si el backend la pudo calcular). */
  suma?: MedidaPista
  metadatos: MetadatosRenderAnalisis
}

/** Función que produce el análisis (la implementa la app). */
export type ProveedorAnalisis = (req: RequerimientoAnalisis) => Promise<AnalisisProyecto>

let proveedorActual: ProveedorAnalisis | null = null

/** Registra (o quita) el proveedor de análisis activo. */
export function registrarProveedorAnalisis(proveedor: ProveedorAnalisis | null): void {
  proveedorActual = proveedor
}

/** Proveedor activo o null. */
export function obtenerProveedorAnalisis(): ProveedorAnalisis | null {
  return proveedorActual
}

/** ¿Hay motor de análisis disponible? */
export function hayProveedorAnalisis(): boolean {
  return proveedorActual !== null
}

/** Mensaje estándar cuando no hay motor de análisis disponible. */
export const MENSAJE_SIN_PROVEEDOR_ANALISIS =
  'Sin motor de análisis: el render de análisis no está disponible en este contexto.'
