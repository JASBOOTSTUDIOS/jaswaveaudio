/** Motor de turnos headless (A1) + tool-calling nativo (A2). */

export * from './engine-types'
export * from './run-state'
export * from './mode-capabilities'
export {
  engineChat,
  ensureSystemRules,
  toMarkerMessages,
  toolResultMessage,
  ENGINE_ROLE_PROMPTS,
  MARKER_PROTOCOL_HINT,
  type EngineChatDeps,
  type EngineChatOptions,
  type EngineChatResult,
} from './chat'
export { createTurnContext, type TurnContext } from './turn-context'
export {
  createToolLoopProgram,
  toolsForModeFromHost,
  TOOL_LOOP_DEFAULTS,
  TOOL_LOOP_PROGRAM_ID,
  type ToolLoopOptions,
} from './tool-loop'
export { createTurnEngine, drainTurn, type TurnEngine, type CreateTurnEngineOptions } from './turn-engine'
export {
  createMockPlayer,
  mockWhenMatches,
  parseMockScript,
  type MockReply,
  type MockRequestView,
  type MockResponse,
  type MockScript,
  type MockToolCall,
  type MockWhen,
} from './mock-script'
