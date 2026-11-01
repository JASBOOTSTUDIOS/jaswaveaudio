/**
 * Tipos del agente de JasWave (estilo agente de código): planifica con una lista de tareas, consulta y
 * ejecuta herramientas reales en caliente, busca herramientas bajo demanda, delega en subagentes en
 * paralelo y pregunta solo cuando le falta algo imprescindible.
 */

import type { HabilidadAgente } from './habilidades'

/** Clase de una herramienta: decide si se ejecuta, se confirma o se oculta según el modo. */
export type ClaseHerramienta = 'lectura' | 'escritura' | 'destructiva'

export type HerramientaAgente = {
  nombre: string
  descripcion: string
  parametros: Record<string, unknown>
  clase: ClaseHerramienta
  /** Texto para el usuario («Creando pista», «Leyendo el proyecto»): la UI nunca muestra `nombre`. */
  titulo?: string
  /** Palabras extra para encontrarla con `buscar_herramientas` (sinónimos en español). */
  etiquetas?: string[]
}

export type LlamadaAgente = { id: string; nombre: string; argumentos: Record<string, unknown> }

export type ResultadoHerramienta = {
  ok: boolean
  /** Datos para el modelo (se compactan antes de enviarse). */
  datos?: unknown
  error?: string
  /** Línea legible para la UI. */
  resumen?: string
  /** La herramienta no se ejecutó: requiere confirmación del usuario (tarjeta). */
  pendienteConfirmacion?: boolean
}

export type MensajeAgente =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }
  | { role: 'tool'; content: string; toolCallId: string; name: string }

export type EsquemaHerramienta = { name: string; description: string; parameters: Record<string, unknown> }

export type RespuestaModelo = {
  ok: boolean
  texto: string
  llamadas: LlamadaAgente[]
  error?: string
}

export type ChatAgente = (o: {
  sistema: string
  mensajes: MensajeAgente[]
  herramientas: EsquemaHerramienta[]
  /** Profundidad 0 = agente principal; 1 = subagente. */
  profundidad: number
  onDelta?: (texto: string) => void
}) => Promise<RespuestaModelo>

export type EstadoTarea = 'pendiente' | 'en_curso' | 'hecha'
export type Tarea = { titulo: string; estado: EstadoTarea }

/** Perfil de subagente (especialistas del sistema o creados por el usuario). */
export type PerfilSubagente = {
  id: string
  nombre: string
  /** Qué sabe hacer: lo lee el agente principal para decidir a quién delegar. */
  descripcion: string
  instrucciones: string
  /** Nombres de herramientas permitidas (vacío = las que elija la búsqueda por la tarea). */
  herramientas?: string[]
  /** Habilidades (conocimiento de oficio) que puede leer con `leer_habilidad` cuando aplican. */
  habilidades?: HabilidadAgente[]
}

export type EventoAgente =
  | { tipo: 'texto'; delta: string; agente: string }
  | { tipo: 'tareas'; tareas: Tarea[] }
  | { tipo: 'herramienta'; agente: string; nombre: string; titulo: string; fase: 'inicio' | 'fin'; ok?: boolean; resumen?: string }
  | { tipo: 'subagente'; id: string; nombre: string; fase: 'inicio' | 'fin'; ok?: boolean; resumen?: string; tarea: string }
  | { tipo: 'paso'; agente: string; paso: number }

export type EstadoAgente = 'completado' | 'pregunta' | 'confirmar' | 'limite' | 'fallo' | 'cancelado'

export type RegistroLlamada = { agente: string; nombre: string; argumentos: Record<string, unknown>; ok: boolean; resumen?: string; error?: string; clase?: ClaseHerramienta | 'meta' }

export type ResultadoAgente = {
  estado: EstadoAgente
  texto: string
  tareas: Tarea[]
  llamadas: RegistroLlamada[]
  pregunta?: { texto: string; opciones: string[] }
  pasos: number
  error?: string
}
