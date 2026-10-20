# A2 · Tool-calling nativo y proveedor mock

**Objetivo:** que el modelo llame herramientas con el mecanismo nativo de cada proveedor (más fiable que marcadores de texto),
con JSON Schemas reales, y tener un proveedor `mock` determinista para probar turnos completos sin LLM.

## Contexto y hallazgos
- `jas-wave/electron/ai-gateway.ts`: `AiChatRequest` solo `messages:{role,content}`; sin `tools`, `tool_choice`, streaming
  (`stream:false`); rutas: OpenAI-compatible `/chat/completions`, Anthropic `/v1/messages`, Gemini, Ollama.
- `shared/src/ai/tool-registry.ts` `generatePromptFragment` emite texto, no schemas.
- Parser de marcadores: `ai-harness/src/loop/parse-agent-decision.ts`, `recovery/legacy-actions-parser.ts`.
- Validación posterior: `ai-harness/src/loop/validate-tool-calls.ts`.

## Tareas
- [x] `shared/src/ai/tool-schemas.ts`: JSON Schema por herramienta a partir del `schema` del comando (registro) y del catálogo
      (`jas-wave/src/lib/agent-action-catalog.ts`); `toolsForRole(role, mode)` filtra por rol de agente (A6) y por modo (A3).
- [x] Gateway: `AiChatRequest.tools?`, `toolChoice?`, mensajes `role:'tool'` con `toolCallId`; respuesta `toolCalls[]` normalizada.
      Mapear por proveedor: OpenAI (`tools`/`tool_calls`), Anthropic (`tools`/`tool_use`/`tool_result`), Gemini
      (`functionDeclarations`/`functionCall`/`functionResponse`), Ollama (`tools`). Streaming de texto por `ai-chat-stream`
      (IPC con eventos `delta`/`done`, cancelable con `requestId` existente).
- [x] Capacidades por proveedor/modelo (`supportsTools`); si no soporta o falla con error de herramientas → fallback automático al
      protocolo `<<<DECISION>>>` (mismo `AgentDecision`).
- [x] Engine (A1) usa tool-calling nativo cuando está disponible; resultados de herramientas como mensajes `tool` envueltos con
      `wrapUntrustedToolResult` (`ai-harness/src/agent/untrusted.ts`).
- [x] Proveedor `mock` (`kind:'mock'`) en gateway y en `ai-settings`: reproduce guiones JSON (`ai-harness/src/test/fixtures/*.json`)
      con respuestas y toolCalls por turno; activable por `JASWAVE_AI_MOCK=<archivo>` para e2e/CLI.
- [ ] Tests: serialización de tools por proveedor (snapshots), parsing de respuestas con toolCalls, fallback a marcadores,
      turno completo con mock.

## Archivos
`jas-wave/electron/ai-gateway.ts`, `electron/main.ts` (IPC stream), `electron/preload.ts`, `src/lib/ai-settings.ts`,
`shared/src/ai/{tool-registry,tool-schemas}.ts`, `ai-harness/src/engine/chat.ts`, `ai-harness/src/loop/parse-agent-decision.ts`.

## Criterios de aceptación
- Con OpenAI/Anthropic/Gemini/OpenRouter los agentes usan tool calls nativas; con modelos sin soporte, marcadores.
- Turno completo reproducible con `mock` en CI.

## Verificación
`npm run verify`; e2e con `JASWAVE_AI_MOCK`.

## Notas de traspaso
**Rama:** `ws/a1-a2-engine` (Claude, 2026-10-20).

### Hecho
- `shared/src/ai/tool-schemas.ts`: `buildToolSchemas` (schema del comando o inferido del `examplePayload`), `toolsForRole({role, mode, classOf})`
  con prefijos de escritura por rol (`ROLE_WRITE_PREFIXES`, A6) y filtro por modo (A3). La clase se inyecta (`agentActionClassOfType`).
- `jas-wave/electron/ai-tools.ts` (puro): codificación de nombres `.`↔`__`, cuerpos y parsing por proveedor (OpenAI-compat,
  Anthropic, Gemini con schema saneado, Ollama), `providerSupportsTools`, `isToolsUnsupportedError`.
- `electron/ai-stream.ts`: acumuladores SSE/NDJSON (texto + tool calls). `electron/ai-mock.ts`: guion JSON (`JASWAVE_AI_MOCK`),
  misma semántica que `ai-harness/src/engine/mock-script.ts` (test de paridad).
- `ai-gateway.ts`: `buildProviderRequest`/`parseProviderResponse` exportados, `toolCalls`, `toolsUnsupported` (sin HTTP si el
  modelo no soporta tools; 400 de tools → se recuerda por sesión), `httpAttempts`, `aiChatStream`, kind `mock` (+ env).
- IPC `ai-chat-stream` (eventos `ai-chat-stream-event` delta/done, cancelable con `ai-chat-cancel` + `requestId`).
- `ai-settings.ts`: kind `mock` (oculto en el selector), tipos de tools, `aiChatWithFallback` con `beforeAttempt`, `tools`, `meta`,
  `onDelta`/`streamChat`, suma de `httpAttempts`; `toolsUnsupported` no salta al siguiente modelo (el motor reintenta con marcadores).
- Tests: `electron/ai-tools.test.ts` (snapshots por proveedor), `ai-stream.test.ts`, `ai-mock.test.ts`, `shared/src/test/tool-schemas.test.ts`.

- Motor: `tool-loop` envía `listTools` (JSON Schema, recortadas a 120 por prioridad de familia: `capToolSchemas`) + tools de control
  `agent.complete|askUser|fail`; resultados como mensajes `tool` envueltos con `wrapUntrustedToolResult`. El agent loop legacy
  también recibe tools nativas (`toLoopReply`: tool calls nativas → decisión; si no, marcadores).
- Host jas-wave: `aiChatWithFallback` con `tools`/`meta`/streaming (`agent.delta` → burbuja viva del panel).

### Pendiente
- e2e con mock (`JASWAVE_AI_MOCK`).
- En el legacy los resultados de herramientas siguen llegando al modelo como texto de observación (no mensajes `tool`); A5 debe
  pasar al bucle `tool-loop`.

