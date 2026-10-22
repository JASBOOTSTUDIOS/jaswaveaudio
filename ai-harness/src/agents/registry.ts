import type { EngineAgentRole } from '../engine/engine-types'

/**
 * Registro de agentes del equipo multi-agente (A6).
 *
 * Define, por agente: id, nombre, archivo/constante de prompt, herramientas con alcance de rol,
 * tope de iteraciones por paso y temperatura. Los prompts viven en `prompts.ts` (constantes
 * embebidas, aptas para bundler de navegador sin `fs`).
 */

export type AgentRoleId = 'director' | 'productor' | 'mezcla' | 'mastering' | 'qa'

export type AgentDefinition = {
  readonly id: AgentRoleId
  readonly nombre: string
  /** Rol que se comunica al motor (filtra herramientas por `toolsForRole`). */
  readonly role: EngineAgentRole
  /** Nombre de la constante de prompt en `prompts.ts`. */
  readonly promptKey: string
  /** Herramientas sugeridas por paso (se intersecan con las visibles del rol/modo). */
  readonly herramientas: readonly string[]
  readonly maxIterPorPaso: number
  readonly temperatura: number
}

export const AGENT_DEFINITIONS: ReadonlyArray<AgentDefinition> = Object.freeze([
  {
    id: 'director',
    nombre: 'Director',
    role: 'director',
    promptKey: 'DIRECTOR_PROMPT',
    herramientas: ['plan.get', 'plan.status', 'session.summary', 'track.list', 'selection.get', 'project.getSummary'],
    maxIterPorPaso: 20,
    temperatura: 0.2,
  },
  {
    id: 'productor',
    nombre: 'Productor / Arreglista',
    role: 'productor',
    promptKey: 'PRODUCTOR_PROMPT',
    herramientas: [
      'track.create', 'track.update', 'clip.create', 'clip.move',
      'midi.clip.create', 'midi.notes.set', 'midi.transpose', 'midi.quantize',
      'plugin.insert', 'plugin.lookup', 'style.profile.list', 'style.profile.apply',
      'daw.musicBuild', 'daw.composeProject', 'project.setBpm', 'project.setTimeSignature',
    ],
    maxIterPorPaso: 25,
    temperatura: 0.35,
  },
  {
    id: 'mezcla',
    nombre: 'Ingeniero de Mezcla',
    role: 'mezcla',
    promptKey: 'MEZCLA_PROMPT',
    herramientas: [
      'track.ganancia', 'pista.pan', 'track.update',
      'plugin.insert', 'plugin.setParameter', 'plugin.bypass',
      'fxChain.copy', 'fxChain.paste', 'send.set', 'bus.create',
      'automation.setCurve', 'automation.writePoint',
      'analysis.mix', 'analysis.loudness', 'audit.mix', 'master.update',
    ],
    maxIterPorPaso: 20,
    temperatura: 0.3,
  },
  {
    id: 'mastering',
    nombre: 'Ingeniero de Mastering',
    role: 'mastering',
    promptKey: 'MASTERING_PROMPT',
    herramientas: [
      'master.update', 'analysis.loudness', 'analysis.spectrum',
      'plugin.insert', 'plugin.setParameter',
      'reference.import', 'reference.toggleAB',
      'audit.compareReference', 'daw.masterPass',
    ],
    maxIterPorPaso: 15,
    temperatura: 0.3,
  },
  {
    id: 'qa',
    nombre: 'QA / Escucha Crítica',
    role: 'qa',
    promptKey: 'QA_PROMPT',
    herramientas: [
      'analysis.loudness', 'analysis.mix', 'analysis.spectrum',
      'audit.step', 'audit.project', 'audit.mix', 'audit.compareReference',
      'run.log', 'run.diff', 'session.summary',
    ],
    maxIterPorPaso: 10,
    temperatura: 0.15,
  },
])

export function obtenerAgente(id: AgentRoleId): AgentDefinition | undefined {
  return AGENT_DEFINITIONS.find((a) => a.id === id)
}

export function herramientasDeAgente(id: AgentRoleId): readonly string[] {
  const a = obtenerAgente(id)
  return a ? a.herramientas : []
}
