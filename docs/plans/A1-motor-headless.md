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
- [ ] Crear `ai-harness/src/engine/*` con tipos e interfaz `EngineHost`; tests con un host falso en memoria.
- [ ] `chat.ts`: siempre construye el system prompt (base + modo + rol + contexto DAW + plan actual + reglas de datos no
      confiables), usa fallback de modelos y carga el presupuesto; todos los consumidores (reasoning, loop, harness, QA, review,
      tras Aplicar) pasan por aquí.
- [ ] Mover del panel al motor, en este orden y con tests en cada paso: (1) resolución de modo y atajos locales; (2) reasoning;
      (3) agent loop; (4) post-turno (certify, docs, harness, review). Las heurísticas en cascada del single-shot se convierten en
      "herramientas de respaldo" invocables (`fallback.musicBuild`, `fallback.styleEnhance`…) registradas en el catálogo.
- [ ] `run-state.ts` + persistencia en `userData/agent-runs/<id>.json` vía IPC (`createGuardedIpc` + `path-grants`); retomar tras recarga.
- [ ] Panel (`coproducer-panel.tsx`) pasa a ser vista: llama `engine.runTurn`, renderiza eventos (timeline), y las tarjetas
      (aprobación de plan, confirmación destructiva, aclaración) responden vía `engine.answer(runId, …)`.
- [ ] `pending-actions-card.tsx` deja de crear su propio chat; usa `engine.answer`.
- [ ] Presupuesto único por turno (`ai-harness/src/agent/budget.ts`) incluyendo reintentos y fallbacks (contar cada intento HTTP).
- [ ] Tests: engine con host falso — turno ask, turno create con plan aprobado, cancelación, reanudación desde run persistido.

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
_(vacío)_
