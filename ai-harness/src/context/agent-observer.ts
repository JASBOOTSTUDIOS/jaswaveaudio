import type { DAWState } from '@jaswave/shared'
import { getStateRevision } from '@jaswave/shared'
import { getSelectedClipId, getSelectedTrackId } from '../ask/selection'
import { composeAgentTurnContext, formatAgentContextForPrompt } from './compose-agent-context'
import type { AgentLoopToolResult, AgentObservation, AgentObserveIntent } from '../loop/agent-run-types'

export type ObservationRequest = {
  state: DAWState
  userText: string
  lastResults?: AgentLoopToolResult[]
  forceIntent?: AgentObserveIntent
  pluginCatalogText?: string
  docsText?: string
  mentionsText?: string
  musicalSelectionText?: string
}

export function inferObserveIntent(userText: string): AgentObserveIntent {
  const t = userText.toLowerCase()
  if (/mezcl|volumen|panorama|bus\b|send|plugin|satur|compresor|eq\b/.test(t)) return 'mix'
  if (/clip|nota|midi|piano roll|cuantiz|humaniz/.test(t)) return 'clip'
  if (/seleccionad|esta pista|silencia|mute|solo\b|ármala|armala/.test(t)) return 'selection'
  if (/canci[oó]n|proyecto|arreglo|estructura|render/.test(t)) return 'project'
  return 'selection'
}

function formatResults(results: AgentLoopToolResult[]): string {
  if (!results.length) return '(sin resultados de herramientas aún)'
  const failed = results.filter((r) => r.status === 'error' || r.status === 'rejected')
  const lines = results.slice(-12).map((r) => {
    const err = r.error ? ` ${r.error.code}: ${r.error.message}` : ''
    const data = r.data != null ? ` data=${JSON.stringify(r.data).slice(0, 400)}` : ''
    return `- ${r.tool} [${r.status}]${err}${data}`
  })
  if (failed.length) {
    lines.unshift(
      `⚠ ${failed.length} tool(s) FALLARON — debes corregirlas (otro tool-call) o type:fail. PROHIBIDO type:complete.`,
    )
  }
  return lines.join('\n')
}

export function observeAgentContext(req: ObservationRequest): AgentObservation {
  const intent = req.forceIntent ?? inferObserveIntent(req.userText)
  const ctx = composeAgentTurnContext({
    state: req.state,
    mentionsText: req.mentionsText,
    pluginCatalogText: intent === 'mix' || intent === 'project' ? req.pluginCatalogText : '',
    docsText: intent === 'project' ? req.docsText : '',
    musicalSelectionText: intent === 'clip' || intent === 'selection' ? req.musicalSelectionText : '',
  })
  const selectedTrackId = getSelectedTrackId(req.state)
  const selectedClipId = getSelectedClipId(req.state)
  const fingerprint = getStateRevision(req.state)
  const lastResults = req.lastResults ?? []

  const focused =
    intent === 'selection' || intent === 'clip'
      ? [
          ctx.selectedTrackLine,
          selectedTrackId ? `selectedTrackId=${selectedTrackId}` : '',
          selectedClipId ? `selectedClipId=${selectedClipId}` : '',
          intent === 'clip' ? ctx.musicalSelectionText : '',
        ]
          .filter(Boolean)
          .join('\n')
      : intent === 'mix'
        ? [ctx.selectedTrackLine, ctx.tracksLine, ctx.pluginCatalogText].filter(Boolean).join('\n')
        : formatAgentContextForPrompt(ctx)

  const text = [
    `## Observación (${intent})`,
    `stateRevision=${fingerprint}`,
    focused,
    '',
    '## Resultados recientes de herramientas',
    formatResults(lastResults),
  ].join('\n')

  return { text, fingerprint, selectedTrackId, lastResults, intent }
}

export function syntheticReadResult(
  tool: string,
  args: Record<string, unknown>,
  state: DAWState,
): { data: Record<string, unknown> } | { error: { code: string; message: string } } {
  const tracks = state.project?.tracks ?? []
  if (tool === 'selection.get') {
    return {
      data: {
        trackId: getSelectedTrackId(state),
        clipId: getSelectedClipId(state),
        idsPistas: state.selection?.idsPistas ?? [],
        idsClips: state.selection?.idsClips ?? [],
      },
    }
  }
  if (tool === 'project.getSummary') {
    return {
      data: {
        bpm: state.project?.bpm?.valor,
        trackCount: tracks.length,
        tracks: tracks.slice(0, 24).map((t) => ({ id: t.id, name: t.nombre, tipo: t.tipo })),
        fingerprint: getStateRevision(state),
      },
    }
  }
  if (tool === 'track.list') {
    return {
      data: {
        tracks: tracks.map((t) => ({ id: t.id, name: t.nombre, tipo: t.tipo })),
      },
    }
  }
  void args
  return { error: { code: 'NOT_SYNTHETIC', message: tool } }
}

export function trackIdExists(state: DAWState, id: string): boolean {
  return (state.project?.tracks ?? []).some((t) => t.id === id)
}
