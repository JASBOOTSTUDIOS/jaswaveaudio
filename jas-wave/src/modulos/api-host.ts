/**
 * API pública del DAW para módulos (M3). Es lo único del host que un módulo puede usar: se publica en el
 * runtime (`__JASWAVE_SDK__.api`) y sus tipos se generan en @jaswave/host-sdk (`npm run sdk:generar`).
 * Añadir aquí = ampliar el contrato; quitar o cambiar una firma = romper módulos (subir VERSION_SDK).
 */

// Estado del proyecto y comandos (todo cambio pasa por tienda.executor.execute → deshacer y auditoría)
export { useDAW, useDAWState, getSharedStore } from '../context/daw-context'
export { getSelectedTrackId } from '../lib/selection-helpers'

// Documentos del proyecto (docs/*.md)
export { getAgentDoc, subscribeAgentDocs, writeAgentDoc } from '../lib/agent-docs'

// Clip MIDI ↔ Markdown
export { midiClipDocSlug, parseMidiClipMd, serializeMidiClipMd } from '../lib/midi-clip-markdown'

// Workspace
export { requestOpenTool } from '../workspace/types'

// Consultas puras sobre el estado (sin efectos)
export { findMidiClip } from '../../../shared/src/midi/query'

// Tipos del dominio
export type { DAWState } from '../../../shared/src/types/state'
export type { TiendaDAW } from '../../../shared/src/state/tienda'

// Añadido al extraer com.jaswave.modulo.partitura
export { getUndockUrlFocus } from '../../lib/undock-window'
export { useDAWOptional } from '../context/daw-context'
export { saveBinaryOrThrow } from '../lib/electron-fs'
export { listMidiClips, resolvePianoRollClip } from '../lib/selection-helpers'
export { shouldIgnoreGlobalShortcuts } from '../../../shared/src/index'
export type { MidiClip, MidiNote } from '../../../shared/src/index'
export { getProjectKey, getProjectKeyRegions } from '../../../shared/src/music/project-key'

// Archivos (diálogos y disco a través del DAW; en la web, descarga)
export { archivosDeEscritorio, descargarArchivo, elegirCarpeta, elegirRutaGuardar, guardarBinario, guardarTexto, leerTexto } from './api-archivos'

// Añadido al extraer com.jaswave.modulo.asistente-ia
export { HARNESS_MAX_ACTIONS_PER_REPAIR, HARNESS_MAX_REPAIR_TURNS, HARNESS_MIN_AUDIBLE_PEAK, HARNESS_STALE_LIMIT, actionFingerprint, agentActionClass, agentActionClassOfType, agentDecisionFromToolCalls, auditStep, auditarProyecto, buildHarnessRepairMessage, buildHarnessReviewMessage, cancelAgentJobs, createAgentBudgetTracker, createAgentJobQueueStore, createBudgetGuard, createHarnessJobContextStore, createTurnEngine, engineChat, enqueueAgentJob, filterRedundantRepairActions, formatAgentBudgetStopFor, formatDawDebugDump, formatHarnessProgress, formatHarnessStopLine, gateAgentActionExecution, getAgentJobState, harnessReviewNeeded, harnessShouldRepair, healthSignature, inspectDawHealth, isProjectWipeIntent, isReadOnlyAction, isSongRefineIntent, isSyntheticReadTool, isTempoOnlyRefine, listarAuditHistorial, observeAgentContext, parseAgentDecisionFromText, parseEngineRun, parsePlan, peekHarnessJobContext, planHasPendingTasks, registerAgentJobRunner, registroHerramientasPlugins, runAbbreviatedReasoning, runAgentLoop, runCouncilReviewReasoning, runHarnessFollowups, runHarnessUntilPlanComplete, runReasoningLoop, seedAttemptedFingerprints, serializeEngineRun, setPlanMarkdownResolver, shouldContinueHarness, siguientePasoPendiente, stashHarnessJobContext, subscribeAgentJobs, syntheticReadResult, tendenciaMetrica, toolCallsToLegacyActions } from '@jaswave/ai-harness'
export type { ActionResult, AgentBudget, AgentBudgetTracker, AgentBudgetUsage, AgentDecision, AgentJob, AgentJobKind, AgentJobRunner, AgentLoopChatReply, AgentLoopToolCall, AgentLoopToolResult, AgentMode, AgentRunResult, DawAction, DawHealthIssue, DawHealthReport, EngineAgentRole, EngineAnswer, EngineChatMessage, EngineChatOptions, EngineChatResult, EngineEvent, EngineHost, EngineHostChatResponse, EngineMode, EngineNeed, EngineRun, HarnessAuditTrack, HarnessDawAction, HarnessFollowupResult, HarnessFollowupTurn, HarnessHealthContext, HarnessJobContext, HarnessProgressEvent, HarnessStopReason, PlanEstructurado, PlanEvaluation, PlanPaso, ReasoningChatTurn, ReasoningStep, TurnContext, TurnEngine, TurnHandle, TurnProgram, TurnProgramOutcome } from '@jaswave/ai-harness'
export { JasWaveLogo } from '../../components/brand'
export { Aviso, Boton, Seccion } from '../../components/cuenta/ui'
export { CambiarClave, FormularioProveedorIA } from '../../components/ia/formulario-proveedor-ia'
export { beatsASegundos } from '../../lib/audio-conversions'
export { cn } from '../../lib/utils'
export { AGENT_ONLY_ACTIONS, KNOWN_AGENT_ACTION_TYPES, registerAgentCatalogOnRegistry } from '../lib/agent-action-catalog'
export { buildHarnessHealthContext } from '../lib/agent-audit-bridge'
export { A9_TOOL_NAMES, A9_TOOL_SCHEMAS, resumenDiff, runAuditTool } from '../lib/agent-audit-tools'
export { runPostTurnCertifyPipeline } from '../lib/agent-certify-pipeline'
export { PLAN_SLUG, applyMarkdownDocsFromModel, bindAgentDocsDisk, parseDocBlocksFromText } from '../lib/agent-docs'
export type { ChatDocEdit } from '../lib/agent-docs'
export { ensurePlanFromCompose, syncPlanAfterDawChange } from '../lib/agent-plan-eval'
export { leerPlan } from '../lib/agent-plan-steps'
export { actionRiskLevel, autonomyBlocksMutation, ensureMusicBuildForFullProject, forcePreviewAplicar, isClassifiedAction, isMutatingAction, isSoloMusicBuildPending, limitToOneMutatingAction, logPermissionForAction, modeBlocksMutation, partitionActions, withAplicarTrue } from '../lib/ai-action-policy'
export { buildAgentSystemPrompt, executeDawActions, fallbackActionsFromUserIntent, formatActionResultsForUser, parseActionsFromText, parsePlanFromText, sourceIsUserConfirmed, stripActionsBlock } from '../lib/ai-daw-agent'
export type { ExecuteDawOptions } from '../lib/ai-daw-agent'
export { appendAiDawAudit, clearAiDawAudit, exportAiDawAuditJson, listAiDawAudit, listAiDawAuditForMessage, subscribeAiDawAudit } from '../lib/ai-daw-audit-store'
export type { AiDawAuditEntry } from '../lib/ai-daw-audit-store'
export { MAX_CITED_MESSAGES, collectCitedMessages, filterMentionables, formatUserTurnWithCitations, groupMentionables, historyWithCitedPins, listMentionables, mentionDraftAtCaret, messagePreview } from '../lib/ai-mentions'
export type { Mentionable } from '../lib/ai-mentions'
export { clearMidiProposalOverlay, notesFromActionPayload, publishMidiProposalFromActions, setMidiProposalOverlay } from '../lib/ai-midi-proposal-store'
export { AGENT_MODE_META, agentModeLabel, inferBpmFromTempoIntent, isClipSectionSplitIntent, isGenreRewriteIntent, isMidiClipEditIntent, isProjectAuditIntent, isStyleApplyIntent, isStyleGapIntent, loadAgentMode, nextAgentMode, resolveMode, saveAgentMode, wantsFullProject, workingMode } from '../lib/ai-modes'
export { actionsLackMidiNoteEdits, answerLocalReadQuery, buildMidiAuditClarifications, buildMidiAuditFixActions, buildMidiAuditReport, buildMidiClipEditActions, buildReadOnlyProjectContext, buildSplitLongClipsActions, buildStyleEnhanceActions, buildStyleGapReport, isGarbageAssistantReply, isOffTopicCreatePlanReply, styleEnhanceProfileFromText } from '../lib/ai-read-context'
export { ASK_AI_SELECTION_EVENT, clearMusicalSelectionAnchor, formatMusicalSelectionForPrompt, getMusicalSelectionAnchor, selectionChipInsertText, selectionHasContext, subscribeMusicalSelection } from '../lib/ai-selection-context'
export type { AskAiSelectionDetail } from '../lib/ai-selection-context'
export type { DatosProveedorIA, PermisosIAApi, ProveedorIAApi } from '../lib/backend/api'
export { apiJasWave, tokenSesion, useSesion } from '../lib/backend/sesion'
export { ensureTerminalAuditMirror } from '../lib/daw-terminal-sessions'
export { formatLibraryPresetsForContext } from '../lib/library/ops'
export { pitchToName } from '../lib/midi-clip-markdown'
export { composeMidiFromBrief, hashSeed, parseMidiBriefFromText } from '../lib/midi-song-generator'
export type { Articulation, GeneratedNote } from '../lib/midi-song-generator'
export { expandSectionsToBarPlan, specToProjectPlan } from '../lib/music-build/index'
export type { MusicBuildResult, MusicBuildStage, MusicBuildStageStatus, MusicBuildTrackSpec } from '../lib/music-build/types'
export type { InstrumentRole } from '../lib/plugin-knowledge'
export { setEditorPreviewTrackId } from '../lib/plugin/editor-preview-focus'
export { findJasWavePianoDescriptor } from '../lib/plugin/jaswave-piano'
export { applyJasWaveRolesParameter, findJasWaveRolesDescriptor, isJasWaveRolesDescriptor } from '../lib/plugin/jaswave-roles'
export { openPluginEditor } from '../lib/plugin/plugin-editor-store'
export { descriptorToPluginInfo } from '../lib/plugin/plugin-info-adapter'
export { pluginRegistry } from '../lib/plugin/registry'
export { allNotesOffSlot, ensureHostMidiAudible, ensureTrackVstPlugin, findTrackPlaybackInstrument, flushProjectGraphResync, getLastVstLoadError, getLoadedInstrumentForTrack, listLoadedSlots } from '../lib/plugin/track-vst-runtime'
export { routeMidiToTrack, setActiveVstVoiceTarget, setPreferredVstPreviewTrack, setTrackChannelAudible } from '../lib/plugin/vst-voice-router'
export { esHerramientaDePlugin, planificarHerramientaPlugin } from '../lib/plugins/registro-plugins'
export { ensureWipeProjectAction } from '../lib/project-wipe'
export { buildTrackPickClarifications, extractTrackHintFromUserText, extractTrackIdFromClarifyAnswer, formatResolvedTrackContext, resolveTrackHint } from '../lib/track-resolve'
export { servicioDeModulo } from './contribuciones'
export { buildToolSchemas, capToolSchemas, modeAllowsToolClass, toolsForRole } from '../../../shared/src/ai/tool-schemas'
export type { ToolAgentMode, ToolAgentRole, ToolJsonSchema } from '../../../shared/src/ai/tool-schemas'
export { EventosIAExt, crearTransactionManager, extractToolSteps, getStateRevision, planFromActions, safeProjectBpm, toolRegistry } from '../../../shared/src/index'
export type { ExecutionPlan } from '../../../shared/src/index'
export { computeSemanticDiff, formatSemanticDiffSummary, proyectarParaDiff } from '../../../shared/src/state/diff-estado'
export type { DiffSnapshot, SemanticStateDiff } from '../../../shared/src/state/diff-estado'
export { registroComandos } from '../../../shared/src/state/registro-comandos'
export type { PluginInfo } from '../../../shared/src/types/entidades'

// Añadido al extraer com.jaswave.modulo.documentos
export { createAgentDoc, deleteAgentDoc, docsFolderForProject, getMarkdownSection, hydrateAgentDocsFromDisk, listAgentDocs, listDocsSlugsOnDisk } from '../lib/agent-docs'
export type { AgentDoc } from '../lib/agent-docs'
export { agregarPaso, alternarPasoHecho, aprobarPlanMd, mensajeDeEjecucionDePaso, omitirPaso, reanudarPaso, resumenPasos } from '../lib/agent-plan-steps'
export { buildDocTextAnchor, captureActiveDocTextSelection, dispatchAskAiAboutSelection, rememberOpenDoc, setMusicalSelectionAnchor } from '../lib/ai-selection-context'

// IA: tipos del puente y presets de proveedores; plan del proyecto; aclaraciones
export { DEFAULT_CUSTOM_OPENAI, PROVIDER_PRESETS } from '../lib/ia/proveedores'
export type {
  AiApiStyle,
  AiAuthStyle,
  AiChatRequest,
  AiChatResult,
  AiErrorCode,
  AiHealthRequest,
  AiHealthResult,
  AiProviderCustom,
  AiProviderKind,
  AiToolCall,
  AiToolSchema,
  AiWireMessage,
} from '../lib/ia/proveedores'
export type { ProjectPlanData, ProjectPlanTrack } from '../lib/project-plan'
export type { ClarificationAnswer, ClarificationQuestion } from '../lib/aclaraciones'

// Conversación activa del asistente (la terminal del DAW la usa para asociar lo que ejecuta)
export { fijarConversacionActiva } from '../lib/conversacion-activa'

// Puente de IA del escritorio (en la web, null)
export { almacenEjecucionesAgente, puenteIAEscritorio, registrarError } from './api-escritorio-ia'
export type { AlmacenEjecucionesAgente, EventoStreamEscritorio, MetaEjecucionAgente, PuenteIAEscritorio } from './api-escritorio-ia'
export { publishMidiProposalFromMdPreview } from '../lib/ai-midi-proposal-store'
