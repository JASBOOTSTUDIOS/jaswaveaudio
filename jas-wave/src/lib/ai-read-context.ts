/**
 * Contexto de solo lectura — re-export desde @jaswave/ai-harness.
 */

export {
  answerLocalReadQuery,
  buildReadOnlyProjectContext,
  buildMidiAuditReport,
  buildMidiAuditFixActions,
  buildMidiAuditClarifications,
  formatMidiTimelineForPrompt,
  isGarbageAssistantReply,
  collectMidiAuditIssues,
} from '@jaswave/ai-harness'
