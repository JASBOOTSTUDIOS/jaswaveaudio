import { AGENT_DEFINITIONS, type AgentDefinition, type AgentRoleId } from './registry'
import { obtenerPrompt } from './prompts'
import type { EngineAgentRole } from '../engine/engine-types'

export type EspecialistaCustom = {
  id: AgentRoleId | string
  nombre: string
  role: EngineAgentRole
  descripcion?: string
  /** Instrucciones de estilo o reglas específicas que se añaden al prompt base. */
  instruccionesPersonalizadas?: string
  /** Si se especifica, sobreescribe la temperatura base del especialista. */
  temperatura?: number
  /** Si se especifica, sobreescribe el límite de iteraciones por paso. */
  maxIterPorPaso?: number
  /** Herramientas adicionales permitidas para este especialista. */
  herramientasExtra?: string[]
  activo: boolean
}

const STORAGE_KEY = 'jaswave-especialistas-custom-v1'

/** Carga los especialistas configurados por el usuario desde localStorage o memoria. */
export function cargarEspecialistasCustom(): EspecialistaCustom[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return obtenerEspecialistasPorDefecto()
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return obtenerEspecialistasPorDefecto()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return obtenerEspecialistasPorDefecto()
    return parsed
  } catch {
    return obtenerEspecialistasPorDefecto()
  }
}

/** Guarda la configuración de especialistas personalizados. */
export function guardarEspecialistasCustom(especialistas: EspecialistaCustom[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(especialistas))
      window.dispatchEvent(new CustomEvent('jaswave-especialistas-changed'))
    } catch {
      // Ignorar fallos de cuota o modo privado
    }
  }
}

/** Genera la lista de especialistas por defecto a partir de AGENT_DEFINITIONS. */
export function obtenerEspecialistasPorDefecto(): EspecialistaCustom[] {
  return AGENT_DEFINITIONS.map((a) => ({
    id: a.id,
    nombre: a.nombre,
    role: a.role,
    descripcion: descripcionPorDefecto(a.id),
    instruccionesPersonalizadas: '',
    temperatura: a.temperatura,
    maxIterPorPaso: a.maxIterPorPaso,
    activo: true,
  }))
}

function descripcionPorDefecto(id: AgentRoleId): string {
  switch (id) {
    case 'director':
      return 'Coordina el plan, delega a los especialistas y supervisa la sesión.'
    case 'productor':
      return 'Compositor y arreglista. Crea acordes, melodías, baterías y estructuras.'
    case 'mezcla':
      return 'Ingeniero de mezcla. Gain staging, EQ correctiva, compresión, paneo y envíos.'
    case 'mastering':
      return 'Ingeniero de mastering. Cadena master, balance tonal y loudness objetivo.'
    case 'qa':
      return 'Escucha crítica y control de calidad. Bloquea pasos que no cumplan los criterios.'
  }
}

/** Devuelve la lista efectiva de definiciones de agentes incorporando las personalizaciones. */
export function listarAgentesEfectivos(): readonly AgentDefinition[] {
  const customs = cargarEspecialistasCustom()
  return AGENT_DEFINITIONS.map((def) => {
    const custom = customs.find((c) => c.id === def.id)
    if (!custom || !custom.activo) return def
    return {
      ...def,
      nombre: custom.nombre || def.nombre,
      temperatura: custom.temperatura ?? def.temperatura,
      maxIterPorPaso: custom.maxIterPorPaso ?? def.maxIterPorPaso,
      herramientas: custom.herramientasExtra?.length
        ? Array.from(new Set([...def.herramientas, ...custom.herramientasExtra]))
        : def.herramientas,
    }
  })
}

/**
 * Obtiene el prompt final para un agente, incorporando las instrucciones personalizadas
 * del usuario (estilo musical, directrices de mezcla o de composición).
 */
export function obtenerPromptFinalDeAgente(id: AgentRoleId | string): string {
  const base = obtenerPrompt(id as AgentRoleId) || ''
  const customs = cargarEspecialistasCustom()
  const custom = customs.find((c) => c.id === id)
  if (custom?.instruccionesPersonalizadas?.trim()) {
    return `${base}\n\n### Reglas e Instrucciones Personalizadas del Usuario:\n${custom.instruccionesPersonalizadas.trim()}`
  }
  return base
}
