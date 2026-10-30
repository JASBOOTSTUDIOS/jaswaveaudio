/**
 * Modos del Asistente Jas — persistencia local en jas-wave.
 */

export {
  AGENT_MODE_META,
  agentModeLabel,
  detectAgentMode,
  modeBlocksMutation,
  modePromptBlock,
  resolveMode,
  workingMode,
  wantsFullProject,
  isSongRefineIntent,
  isTempoOnlyRefine,
  inferBpmFromTempoIntent,
  parseExplicitBpm,
  parseExplicitTimeSignature,
  isProjectAuditIntent,
  isStyleGapIntent,
  isStyleApplyIntent,
  isMidiClipEditIntent,
  isClipSectionSplitIntent,
  isProjectWipeIntent,
  isGenreRewriteIntent,
  wantsWebResearch,
  type AgentMode,
} from '@jaswave/ai-harness'

import type { AgentMode } from '@jaswave/ai-harness'

const MODE_KEY = 'jaswave-ai-agent-mode'

/** Orden fijo para el atajo de alternar modos (Ctrl+Shift+M). */
export const AGENT_MODE_ORDER: readonly AgentMode[] = ['auto', 'ask', 'think', 'plan', 'create']

/** Siguiente modo en el ciclo del atajo. */
export function nextAgentMode(mode: AgentMode): AgentMode {
  const i = AGENT_MODE_ORDER.indexOf(mode)
  return AGENT_MODE_ORDER[(i + 1) % AGENT_MODE_ORDER.length] ?? 'auto'
}

export function loadAgentMode(): AgentMode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    if (v === 'plan' || v === 'create' || v === 'think' || v === 'ask' || v === 'auto') return v
  } catch {
    /* ignore */
  }
  return 'auto'
}

export function saveAgentMode(mode: AgentMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    /* ignore */
  }
}
