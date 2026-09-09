import type { DAWState } from '@jaswave/shared'
import { buildReadOnlyProjectContext } from '../ask/read-context'
import { getSelectedTrackId } from '../ask/selection'
import type { AgentTurnContext, AgentTrackSummary } from './agent-context'

export type ComposeAgentContextInput = {
  state: DAWState
  mentionsText?: string
  pluginCatalogText?: string
  docsText?: string
  musicalSelectionText?: string
}

export function composeAgentTurnContext(input: ComposeAgentContextInput): AgentTurnContext {
  const { state } = input
  const tracks: AgentTrackSummary[] = (state.project?.tracks ?? []).slice(0, 24).map((t) => ({
    id: t.id,
    name: t.nombre,
    tipo: t.tipo,
    clipCount: (t.clips ?? []).length,
  }))
  const tracksLine =
    tracks.map((t) => `  - id=${t.id} «${t.name}» tipo=${t.tipo} clips=${t.clipCount}`).join('\n') ||
    '  (ninguna)'
  const selectedId = getSelectedTrackId(state)
  const selected = selectedId ? state.project.tracks.find((t) => t.id === selectedId) : undefined
  const selectedTrackLine = selected
    ? `Pista activa: id=${selected.id} «${selected.nombre}» tipo=${selected.tipo}. Si el usuario pide SOLO un clip, úsala (no crees pistas extra).`
    : 'Ninguna pista seleccionada.'

  return {
    projectContextText: buildReadOnlyProjectContext(state),
    tracksLine,
    selectedTrackLine,
    mentionsText: (input.mentionsText ?? '').trim() || '(sin menciones @)',
    pluginCatalogText: (input.pluginCatalogText ?? '').trim(),
    docsText: (input.docsText ?? '').trim(),
    musicalSelectionText: (input.musicalSelectionText ?? '').trim(),
    tracks,
  }
}

export function formatAgentContextForPrompt(ctx: AgentTurnContext): string {
  return [
    ctx.projectContextText,
    '',
    ctx.docsText,
    '',
    '## Pistas (ids para acciones)',
    ctx.tracksLine,
    '',
    '## Pista / clip seleccionados',
    ctx.selectedTrackLine,
    '',
    '## Menciones @ del mensaje',
    ctx.mentionsText,
    'El usuario puede referirse a pistas, clips, plugins o mensajes anteriores con @. Un mensaje citado es ancla extra: no descartes el hilo actual.',
    '',
    ctx.pluginCatalogText ? `## Catálogo de plugins (consulta esto para elegir instrumento/FX)\n${ctx.pluginCatalogText}` : '',
    ctx.musicalSelectionText,
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n')
}
