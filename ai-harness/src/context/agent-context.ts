/**
 * Contexto de un turno de agente, independiente del texto del prompt.
 */

export type AgentTrackSummary = {
  id: string
  name: string
  tipo: string
  clipCount: number
}

export type AgentTurnContext = {
  projectContextText: string
  tracksLine: string
  selectedTrackLine: string
  mentionsText: string
  pluginCatalogText: string
  docsText: string
  musicalSelectionText: string
  tracks: AgentTrackSummary[]
}
