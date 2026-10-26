/**
 * Equipo multi-agente (A6): registro de agentes y prompts.
 */

export {
  type AgentRoleId,
  type AgentDefinition,
  AGENT_DEFINITIONS,
  obtenerAgente,
  herramientasDeAgente,
} from './registry'
export {
  DIRECTOR_PROMPT,
  PRODUCTOR_PROMPT,
  MEZCLA_PROMPT,
  MASTERING_PROMPT,
  QA_PROMPT,
  PROMPTS,
  obtenerPrompt,
} from './prompts'
export {
  type EspecialistaCustom,
  cargarEspecialistasCustom,
  guardarEspecialistasCustom,
  obtenerEspecialistasPorDefecto,
  listarAgentesEfectivos,
  obtenerPromptFinalDeAgente,
} from './especialistas-config'
