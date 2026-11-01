/**
 * Parseo y validación de campos numéricos de la UI (BPM, compás, sample rate,
 * buffer, inspector…). Lógica pura para `components/ui/numeric-field.tsx`:
 * nunca devuelve NaN ni confirma un campo vacío.
 */

export type ReglasNumero = {
  min?: number
  max?: number
  /** Solo enteros (numerador del compás, sample rate, buffer…). */
  entero?: boolean
  /** Lista cerrada de valores admitidos (denominador del compás, buffers). */
  permitidos?: readonly number[]
  /**
   * Fuera de rango: `true` (por defecto) recorta a [min, max]; `false` lo
   * rechaza con error.
   */
  recortar?: boolean
}

export type ResultadoNumero = { ok: true; valor: number } | { ok: false; error: string }

function formatoLista(valores: readonly number[]): string {
  if (valores.length <= 1) return valores.join('')
  return `${valores.slice(0, -1).join(', ')} o ${valores[valores.length - 1]}`
}

/** Convierte el texto del usuario en número válido según las reglas. */
export function parsearNumero(texto: string, reglas: ReglasNumero = {}): ResultadoNumero {
  const limpio = texto.trim().replace(',', '.')
  if (limpio === '') return { ok: false, error: 'Escribe un número' }
  // Number('') = 0 y Number('  ') = 0: por eso el vacío se rechaza antes.
  const n = Number(limpio)
  if (!Number.isFinite(n)) return { ok: false, error: 'No es un número válido' }
  if (reglas.entero && !Number.isInteger(n)) return { ok: false, error: 'Debe ser un número entero' }

  let valor = n
  const { min, max } = reglas
  const fuera = (min !== undefined && valor < min) || (max !== undefined && valor > max)
  if (fuera) {
    if (reglas.recortar === false) {
      return { ok: false, error: `Debe estar entre ${min ?? '−∞'} y ${max ?? '∞'}` }
    }
    if (min !== undefined) valor = Math.max(min, valor)
    if (max !== undefined) valor = Math.min(max, valor)
  }
  if (reglas.permitidos && reglas.permitidos.length > 0 && !reglas.permitidos.includes(valor)) {
    return { ok: false, error: `Debe ser ${formatoLista(reglas.permitidos)}` }
  }
  return { ok: true, valor }
}

/** Valida un valor ya numérico (rueda, flechas) con las mismas reglas. */
export function normalizarNumero(valor: number, reglas: ReglasNumero = {}): ResultadoNumero {
  if (!Number.isFinite(valor)) return { ok: false, error: 'No es un número válido' }
  return parsearNumero(String(valor), reglas)
}
