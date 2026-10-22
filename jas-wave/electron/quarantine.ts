/**
 * Detector de cuarentena de plugins (U7).
 *
 * Propósito:
 *   Decidir si la muerte del plugin host debe apartar (cuarentena) un plugin.
 *
 * Importancia:
 *   Antes, cualquier salida del host en los 20 s siguientes a un `load` ponía
 *   en cuarentena ese plugin aunque la causa fuese otra (p. ej. otra app
 *   agarrando el ASIO). Ahora solo se aparta si el host murió con la carga en
 *   curso o dentro del primer bloque del plugin en ese proceso.
 *
 * Función:
 *   Lógica pura: `evaluarCuarentena` y `mensajeMotivoCuarentena`.
 */

/** Margen del "primer bloque" del plugin en el proceso (ms). */
export const VENTANA_PRIMER_BLOQUE_MS = 5_000

/** Comando de carga en vuelo cuando murió el host. */
export type CargaEnCurso = {
  /** 'load' o 'prepare'. */
  tipo: string
  /** Ruta del plugin (o '' si no se pudo resolver). */
  ruta: string
}

export type ContextoCuarentena = {
  /** Ahora (ms). */
  ahora: number
  /** Carga en vuelo al morir el host (null si no había ninguna). */
  cargaEnCurso: CargaEnCurso | null
  /** Plugin cargado en el proceso que murió (null si no se cargó ninguno). */
  pluginCargado: string | null
  /** Momento en que se cargó en ese proceso (ms). */
  cargadoEn: number
  /** El primer bloque del plugin sigue abierto. */
  bloqueAbierto: boolean
}

export type MotivoCuarentena = 'carga-en-curso' | 'primer-bloque'

export type DecisionCuarentena = {
  plugin: string
  motivo: MotivoCuarentena
}

/**
 * Decide a quién poner en cuarentena. `null` = no se aparta ningún plugin
 * (la causa de la muerte no es atribuible a un plugin).
 */
export function evaluarCuarentena(ctx: ContextoCuarentena): DecisionCuarentena | null {
  const enCurso = ctx.cargaEnCurso
  if (
    enCurso &&
    (enCurso.tipo === 'load' || enCurso.tipo === 'prepare') &&
    enCurso.ruta
  ) {
    return { plugin: enCurso.ruta, motivo: 'carga-en-curso' }
  }
  if (
    ctx.pluginCargado &&
    ctx.bloqueAbierto &&
    ctx.ahora - ctx.cargadoEn < VENTANA_PRIMER_BLOQUE_MS
  ) {
    return { plugin: ctx.pluginCargado, motivo: 'primer-bloque' }
  }
  return null
}

/** Motivo legible para el log. */
export function mensajeMotivoCuarentena(motivo: MotivoCuarentena): string {
  return motivo === 'carga-en-curso'
    ? 'el host murió con la carga del plugin en curso'
    : 'el host murió dentro del primer bloque del plugin en el proceso'
}
