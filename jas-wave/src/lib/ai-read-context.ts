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
  isOffTopicCreatePlanReply,
  buildStyleGapReport,
  buildWorshipDrumEnhanceActions,
  buildMidiClipEditActions,
  buildSplitLongClipsActions,
  actionsLackMidiNoteEdits,
  collectMidiAuditIssues,
} from '@jaswave/ai-harness'
