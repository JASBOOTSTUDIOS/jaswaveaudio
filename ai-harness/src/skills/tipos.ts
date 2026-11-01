/**
 * Habilidades ejecutables del agente.
 *
 * Una habilidad convierte un pedido frecuente en un procedimiento fiable para modelos pequeños:
 * el modelo sólo toma las decisiones creativas (una llamada con un brief JSON acotado) y el
 * DAW ejecuta con herramientas deterministas de alto nivel. Así un modelo débil no se pierde
 * encadenando decenas de tool calls ni cae en plantillas fijas: cada brief es distinto.
 */

import type { DAWState } from '@jaswave/shared'
import type { HarnessDawAction as DawAction } from '../types/actions'

export type ContextoHabilidad = {
  userText: string
  state: DAWState
  /** Semilla fija (tests); por defecto cada ejecución es distinta. */
  semilla?: number
}

export type MensajeBrief = { role: 'system' | 'user'; content: string }

export type PlanHabilidad = {
  /** Acciones de alto nivel a proponer/ejecutar (pasan por la política de modo y el executor). */
  acciones: DawAction[]
  /** Explicación breve para el usuario (qué se decidió y por qué). */
  resumen: string
  /** Decisiones creativas tomadas (para el razonamiento visible). */
  decisiones: string[]
  /** true si el brief vino del modelo; false si se usó el respaldo local. */
  creativoDelModelo: boolean
  /**
   * Datos imprescindibles que faltan (pista, clip…). Si hay preguntas, `acciones` va vacío: el turno
   * debe mostrarlas al usuario en lugar de ejecutar nada (nunca se inventan ids).
   */
  preguntas?: string[]
}

export type Habilidad = {
  id: string
  nombre: string
  descripcion: string
  /** 0..1 — confianza de que el pedido es para esta habilidad (≥ 0.6 la activa). */
  coincide(ctx: ContextoHabilidad): number
  /** Mensajes para la única llamada creativa al modelo (respuesta: JSON). */
  mensajesBrief(ctx: ContextoHabilidad): MensajeBrief[]
  /** Valida el brief del modelo (o `null` si falló) y lo convierte en acciones deterministas. */
  planificar(ctx: ContextoHabilidad, respuestaModelo: string | null): PlanHabilidad
}

/** Extrae el primer objeto JSON de una respuesta de modelo (tolera ```json, prosa alrededor y comas finales). */
export function extraerJson(texto: string | null | undefined): Record<string, unknown> | null {
  if (!texto) return null
  const limpio = texto.replace(/```(?:json)?/gi, '')
  const ini = limpio.indexOf('{')
  if (ini < 0) return null
  const pila: string[] = []
  const cortes: Array<{ fin: number; pila: string[] }> = []
  let enCadena = false
  let escape = false
  for (let i = ini; i < limpio.length; i++) {
    const c = limpio[i]!
    if (enCadena) {
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') enCadena = false
      continue
    }
    if (c === '"') enCadena = true
    else if (c === '{' || c === '[') pila.push(c)
    else if (c === '}' || c === ']') {
      pila.pop()
      if (pila.length === 0) return parsearObjeto(limpio.slice(ini, i + 1))
    } else if (c === ',') cortes.push({ fin: i, pila: [...pila] })
  }
  // Respuesta truncada (el proveedor cortó por tope de tokens): se conserva hasta el último elemento
  // completo y se cierran las llaves abiertas.
  for (let k = cortes.length - 1; k >= 0; k--) {
    const { fin, pila: abiertos } = cortes[k]!
    const cierre = abiertos.reverse().map((x) => (x === '{' ? '}' : ']')).join('')
    const v = parsearObjeto(limpio.slice(ini, fin) + cierre)
    if (v) return v
  }
  return null
}

function parsearObjeto(cuerpo: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(cuerpo.replace(/,\s*([}\]])/g, '$1')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
