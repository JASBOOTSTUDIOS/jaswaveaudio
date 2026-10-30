# A1 · Motor de turnos headless

**Objetivo:** sacar toda la lógica del turno de IA del componente React a un motor reutilizable (UI, CLI, tests) con eventos,
estado persistente y una única ruta de chat con system prompt completo.

## Contexto y hallazgos
- `handleSendMessage` en `jas-wave/components/coproducer-panel.tsx:1068-2442` (archivo de ~3200 líneas) orquesta: atajos locales,
  reasoning (`src/lib/agent-reasoning-bridge.ts` → `ai-harness/src/agent/reasoning-loop.ts`), agent loop
  (`src/lib/agent-loop-bridge.ts` → `ai-harness/src/loop/agent-loop.ts`), single-shot con cascada de heurísticas (`:1620-1953`),
  `processActionsForMode` (`:407-611`), post-turno (certify, `finishAgentTurn`, harness, review) (`:2089-2331`).
- El chat tras Aplicar no lleva system prompt (`components/pending-actions-card.tsx:294-305`); el harness no usa fallback
  (`panel:886, 2152, 2270`); `applyPendingAgentRun`/`runCouncilThenLoop` no reciben presupuesto.
- `AgentRun` en memoria (`src/lib/agent-run-store.ts`), se pierde al recargar.

## Diseño
```
ai-harness/src/engine/
  turn-engine.ts      # runTurn(input, host) → AsyncIterable<EngineEvent>; pause/resume/cancel
  engine-types.ts     # TurnInput {text, mode, conversationId, planOverride?}, EngineEvent, EngineHost
  chat.ts             # una sola función chat(host, role, messages, opts) con system prompt + fallback + presupuesto
  run-state.ts        # AgentRun serializable (pasos, bitácora, presupuesto, pendientes, revisión)
jas-wave/src/lib/agent-engine-host.ts   # implementa EngineHost: tienda, executeDawActions/runRegisteredTools,
                                        # docs (plan.md), aiChatWithFallback, logger, persistencia del run (userData)
```
`EngineHost` = `{ getState, executeTools(calls, ctx), readDoc/writeDoc, chat(req), log, persistRun, now, abortSignal }`.
`EngineEvent` = `turn.started | phase | agent.message | tool.call | tool.result | plan.updated | step.started | step.done |
needs-user (confirmación/aclaración/aprobación de plan) | budget | turn.done | turn.failed`.

## Tareas
- [x] Crear `ai-harness/src/engine/*` con tipos e interfaz `EngineHost`; tests con un host falso en memoria.
- [x] `chat.ts`: siempre construye el system prompt (base + modo + rol + contexto DAW + plan actual + reglas de datos no
      confiables), usa fallback de modelos y carga el presupuesto; todos los consumidores (reasoning, loop, harness, QA, review,
      tras Aplicar) pasan por aquí.
- [x] Mover del panel al motor, en este orden y con tests en cada paso: (1) resolución de modo y atajos locales; (2) reasoning;
      (3) agent loop; (4) post-turno (certify, docs, harness, review). Las heurísticas en cascada del single-shot se convierten en
      "herramientas de respaldo" invocables (`fallback.musicBuild`, `fallback.styleEnhance`…) registradas en el catálogo.
- [x] `run-state.ts` + persistencia en `userData/agent-runs/<id>.json` vía IPC (`createGuardedIpc` + `path-grants`); retomar tras recarga.
- [x] Panel (`coproducer-panel.tsx`) pasa a ser vista: llama `engine.runTurn`, renderiza eventos (timeline), y las tarjetas
      (aprobación de plan, confirmación destructiva, aclaración) responden vía `engine.answer(runId, …)`.
- [x] `pending-actions-card.tsx` deja de crear su propio chat; usa `engine.answer`.
- [x] Presupuesto único por turno (`ai-harness/src/agent/budget.ts`) incluyendo reintentos y fallbacks (contar cada intento HTTP).
- [x] Tests: engine con host falso — turno ask, turno create con plan aprobado, cancelación, reanudación desde run persistido.

## Archivos
Nuevos en `ai-harness/src/engine/`, `jas-wave/src/lib/agent-engine-host.ts`; modificar `components/coproducer-panel.tsx`,
`components/pending-actions-card.tsx`, `src/lib/{agent-loop-bridge,agent-reasoning-bridge,agent-run-store,pending-apply-flow}.ts`,
`src/lib/ai-settings.ts` (fallback contabilizado).

## Criterios de aceptación
- `coproducer-panel.tsx` sin lógica de orquestación (solo vista + wiring); el motor tiene cobertura de tests.
- Ningún chat del agente sale sin system prompt; todos con fallback y presupuesto.
- Un turno sobrevive a recargar la ventana.

## Verificación
`npm run verify`; e2e existentes en verde; nuevo test de engine en `ai-harness/src/test/engine.test.ts`.

## Notas de traspaso
**Rama:** `ws/a1-a2-engine` (Claude, 2026-10-20). Última actualización: tras el commit «panel como vista».

### API del motor (`ai-harness/src/engine/`, exportado desde `@jaswave/ai-harness`)
- `createTurnEngine(host, { programs? })` → `TurnEngine { runTurn(input), answer(runId, answer), resume(runId), pause(runId),
  cancel(runId), getRun, loadRun, isActive, subscribe(listener) }`. `runTurn/answer/resume` devuelven `TurnHandle`
  (AsyncIterable<EngineEvent> + `result: Promise<EngineTurnResult>` + `cancel()`). `drainTurn(handle, onEvent)` para CLI/tests.
- `EngineHost` (obligatorio: `now`, `chat(req, {signal, beforeAttempt, onDelta})`, `buildSystemPrompt`, `executeTools`;
  opcional: `listTools`, `classifyTool`, `readDoc/writeDoc`, `log`, `persistRun/loadRun`, `newId`, `program`, `budget`).
- `TurnInput { text, mode, conversationId, messageId?, role?, planOverride?, planApproved? (placeholder A4), kind?, history?, context?, budget? }`.
- `EngineEvent`: `turn.started | phase | agent.message | agent.delta | tool.call | tool.result | plan.updated | step.started |
  step.done | needs-user | budget | provider | turn.done (completed|waiting-user|paused) | turn.failed (cancelled|budget|error)`.
- `EngineNeed`: `confirm` (destructiva/sistema) | `approve-plan` | `clarify` | `apply` (tarjeta legacy). `EngineAnswer { needId?, approved?, text?, indices?, plan?, data? }`.
- `TurnProgram { id, run(ctx), answer?(ctx, need, answer), resume?(ctx) }`; `TurnContext` da `chat`, `executeTools` (bitácora +
  eventos + defensa fail-closed), `phase`, `message`, `emit`, `log`, `readPlan`, `persist`, `setData`, `budget`, `capabilities`.
- Programa por defecto `tool-loop` (`createToolLoopProgram`): bucle nativo, ids únicos `call_<iter>_<n>`, dedupe por (tool,args),
  tope por iteración con «reenvíala», guardas de modo (`mode-capabilities.ts`), approve-plan una vez en create, confirm en destructivas.
- `engineChat` (chat.ts): ÚNICA ruta de chat. System = el del llamador o `host.buildSystemPrompt`, + rol + plan.md + regla untrusted
  (`ensureSystemRules`, idempotente). Cada intento HTTP se carga vía `beforeAttempt` + `httpAttempts`. Si el proveedor no soporta tools
  → reintento con marcadores (`toMarkerMessages`) y el resto del turno queda en `protocol: 'markers'`.
- `EngineRun` (run-state.ts): serializable, `log` (bitácora A9), `messages` (hilo nativo), `pending`, `pendingCalls`, `budget`
  (se restaura al reanudar: no se regala presupuesto), `data` (programa del host), estados `running|waiting-user|paused|interrupted|completed|failed|cancelled`.
- `createBudgetGuard(tracker)` (budget.ts): vista que consulta sin cargar (para capas antiguas; evita contar doble).

### App (jas-wave)
- `src/lib/agent-engine-host.ts`: `createJasWaveEngineHost`, `getAgentEngine(tienda)` (singleton), `startCoproducerTurn` (crea mensajes
  + run y guarda `engineRunId` en el mensaje), `answerPendingActions` (tarjeta Aplicar → `engine.answer` o turno `apply`),
  `registerCoproducerJobRunner` (jobs harness/certify con chat del motor), `createStandaloneEngineChat`, `findInterruptedRuns`.
- `src/lib/agent-legacy-turn.ts`: programa `coproductor-legacy` = orquestación movida del panel (atajos locales → razonamiento →
  agent loop con tools nativas / single-shot → post-turno). Chats vía `ctx.chat`; heurísticas como `fallback.*`
  (`src/lib/agent-fallback-tools.ts`, clase `read`, en el catálogo). Kinds: normal, `quick` (chips), `apply`.
- `components/coproducer-panel.tsx` (3183 → ~1300 líneas): solo vista; pinta eventos (fase, proveedor, stream de texto) y ofrece
  «Reanudar» para turnos interrumpidos por recarga. `pending-actions-card.tsx` ya no crea chats: usa `answerPendingActions`.
- Persistencia: IPC guardado `agent-run-save|load|list|delete` (`electron/agent-runs.ts`, `createGuardedIpc` + path-grants), en
  `userData/agent-runs/<id>.json` (máx. 200 archivos, 2 MB por run).

### Pendiente / decisiones para A3–A6
- A3: `detectAgentMode` sigue sobrescribiendo el modo dentro del programa legacy (comportamiento preservado). El bucle nativo ya
  aplica `MODE_CAPABILITIES`; A3 debe sustituir el programa legacy por `tool-loop` + prompts por modo.
- A4: `planApproved` es placeholder; `approve-plan` existe en el bucle nativo. `absorbUserRequestIntoPlan` sigue llamándose en el legacy.
- A5: el legacy mantiene «1 mutación por tarjeta» (`limitToOneMutatingAction`) y la pausa en primera escritura; `tool-loop` ya ejecuta
  varias escrituras por iteración (sin batch/undo único todavía).
- A6: roles en `EngineAgentRole` + `ROLE_WRITE_PREFIXES` (shared/tool-schemas) + `ENGINE_ROLE_PROMPTS` (placeholders).
- A9: `run.log` = `EngineRun.log` (`summarizeToolArgs`), `step.*` eventos existen pero aún nadie los emite.
- Reanudar un turno legacy interrumpido repite el turno desde el principio (puede repetir mutaciones si se cortó a mitad).
- `fallback.*` solo los resuelve el host del motor; `executeDawActions` (CLI/bridge) no los conoce.
