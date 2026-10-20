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
- [ ] `shared/src/ai/tool-schemas.ts`: JSON Schema por herramienta a partir del `schema` del comando (registro) y del catálogo
      (`jas-wave/src/lib/agent-action-catalog.ts`); `toolsForRole(role, mode)` filtra por rol de agente (A6) y por modo (A3).
- [ ] Gateway: `AiChatRequest.tools?`, `toolChoice?`, mensajes `role:'tool'` con `toolCallId`; respuesta `toolCalls[]` normalizada.
      Mapear por proveedor: OpenAI (`tools`/`tool_calls`), Anthropic (`tools`/`tool_use`/`tool_result`), Gemini
      (`functionDeclarations`/`functionCall`/`functionResponse`), Ollama (`tools`). Streaming de texto por `ai-chat-stream`
      (IPC con eventos `delta`/`done`, cancelable con `requestId` existente).
- [ ] Capacidades por proveedor/modelo (`supportsTools`); si no soporta o falla con error de herramientas → fallback automático al
      protocolo `<<<DECISION>>>` (mismo `AgentDecision`).
- [ ] Engine (A1) usa tool-calling nativo cuando está disponible; resultados de herramientas como mensajes `tool` envueltos con
      `wrapUntrustedToolResult` (`ai-harness/src/agent/untrusted.ts`).
- [ ] Proveedor `mock` (`kind:'mock'`) en gateway y en `ai-settings`: reproduce guiones JSON (`ai-harness/src/test/fixtures/*.json`)
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
_(vacío)_
