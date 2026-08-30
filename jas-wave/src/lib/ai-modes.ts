/**
 * Modos del Asistente Jas — persistencia local en jas-wave.
 */

export {
  AGENT_MODE_META,
  detectAgentMode,
  modeBlocksMutation,
  modePromptBlock,
  wantsFullProject,
  isSongRefineIntent,
  isTempoOnlyRefine,
  inferBpmFromTempoIntent,
  isProjectAuditIntent,
  type AgentMode,
} from '@jaswave/ai-harness'

import type { AgentMode } from '@jaswave/ai-harness'

const MODE_KEY = 'jaswave-ai-agent-mode'

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
