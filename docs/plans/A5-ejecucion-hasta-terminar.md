# A5 · Ejecución hasta terminar

**Objetivo:** con el plan aprobado, el agente trabaja paso a paso hasta completarlo y verificarlo, sin "Aplicar" por cada cambio y
sin cortar el turno con preguntas innecesarias.

## Contexto y hallazgos
- Pausa en la primera escritura (`ai-harness/src/loop/agent-loop.ts:323-350`, `agent-loop-bridge.ts:67`).
- Una mutación por iteración (`ai-harness/src/loop/validate-tool-calls.ts:94-101`; `limitToOneMutatingAction` en el panel);
  exceso de `maxToolCallsPerIteration` rechaza **todas** las llamadas (`:64-73`); diferidas se descartan.
- Límites: 8 iteraciones / 32 llamadas (64/128 canción) (`agent-run-types.ts:2-11`), replans >3 → fail.
- Pregunta "¿te gustó?" forzada (`base-prompt.ts:13-19`, `agent-loop.ts:87-91`, `modes.ts:470`).
- Bug de idempotencia de ids `c1` (`jas-wave/src/lib/agent-tool-runner.ts:50-58`, `parse-agent-decision.ts:10-16`).
- Undo por turno por profundidad (`src/lib/agent-turn-undo.ts:17-45`) falla con pila llena.

## Bucle objetivo (engine)
```
mientras haya pasos pendientes y no (cancelado | presupuesto agotado):
  paso = siguiente pendiente (tras releer plan, A4)
  agente = paso.agente (A6); contexto = session.summary + paso + evidencia previa (A9)
  repetir (presupuesto del paso):
     decisión = chat(agente, tools permitidas)
     ejecutar tool calls (varias por iteración; mutaciones en un batch con un undo)
     si destructiva/sistema → needs-user (confirmación) y esperar
  QA: audit.step(paso) → VERDICT {ok, issues, evidencia}
     ok → marcar [x] con evidencia; no ok → reintento con issues (máx N) → si persiste, [!] bloqueado y seguir con el resto
fin: audit.project (+ audit.mix si hubo mezcla/master) → resumen final (opcional: pregunta de satisfacción)
```

## Tareas
- [x] Engine implementa el bucle (`orchestrate` en `tool-loop.ts`: por paso — `[~]`, instrucción sembrada, loop propio
      `stopOnComplete`, QA `host.auditStep`, `[x]`+evidencia o reintento (1) → `[!]` y sigue; final `auditProject` + resumen);
      sin pausa en primera escritura cuando el plan está aprobado (`agent-loop-bridge.ts`: `requireConfirmationForWrites`
      ahora es `!resumeRun && !planAprobado` vía `hayPlanAprobado`).
- [ ] **Diferido a A8**: varias mutaciones por iteración como `executor.batch` (un undo por iteración). Hoy
      `runRegisteredTools` ejecuta llamada a llamada; cambiarlo toca confirmación/auditoría por tool. El batch existe
      (`ejecutor-comandos.ts`) y queda listo para enchufar.
- [x] `maxToolCallsPerIteration`: el rechazo ya devuelve «No ejecutada: límite de N; reenvíala en la siguiente»
      (preexistente en `processCalls`; se conserva en el step-loop).
- [x] Ids de llamada únicos por turno (`${runId}:${iter}:${n}`) y deduplicación por hash de (tool, args) por iteración.
- [x] Presupuestos: default subido a 200 llamadas / 2M caracteres / 60 min (`DEFAULT_AGENT_BUDGET`); consumo visible en la
      UI (`data-testid="turn-budget"` en el panel, sobre el evento `budget`); tope por paso = `STEP_LOOP_DEFAULTS
      .maxStepIterations` (12 iteraciones/paso; un paso agotado va a QA en vez de matar el turno).
      **Pendiente (Ajustes → IA)**: hacerlos configurables en la UI de Ajustes.
- [x] Paradas solo por: completado, needs-user (destructiva/sistema, aclaración real), presupuesto, error, pausa/cancel.
      Botones en la timeline: `turn-pause` / `turn-cancel` / `turn-resume` (banner «Turno en pausa»).
- [x] Quitar la pregunta de satisfacción: prompts (`base-prompt`, `music-policy`, `agent-loop`, `reasoning-prompts`),
      legacy (`agent-legacy-turn`), bridge y `pending-apply-flow`. El cierre es un resumen con evidencia.
- [x] Transacción de turno/paso: `engine.undoTurn`/`engine.undoStep` (snapshots LIFO en memoria) + hooks del host
      (`captureSnapshot`/`restoreSnapshot` = profundidad de `executor` vía `revertUndoToDepth` en `agent-engine-host.ts`).
      **No sustituye** a `agent-turn-undo.ts` (sigue para certify/otros flujos).
- [x] Tests (mock) en `engine-step-loop.test.ts`: 6 pasos sin intervención; QA falla → reintento y `[x]` con evidencia;
      QA falla siempre → `[!]` y sigue; destructiva a mitad de paso pide confirm y continúa; undo LIFO (step, step, turn);
      presupuesto agotado ⇒ `reason: budget`; borrador no orquesta. (Pausa/reanudar ya cubiertos en `engine.test.ts`.)

## Archivos
`ai-harness/src/engine/{tool-loop,turn-engine,turn-context,engine-types}.ts`, `ai-harness/src/agent/budget.ts`,
prompts (`base-prompt`, `music-policy`, `reasoning-prompts`, `loop/agent-loop`), `jas-wave/src/lib/{agent-loop-bridge,
agent-legacy-turn,agent-engine-host,pending-apply-flow}.ts`, `jas-wave/components/coproducer-panel.tsx`.

## Criterios de aceptación
- [x] Un pedido con plan aprobado se completa sin clics intermedios (motor; solo confirmaciones destructivas/sistema).
      La app corre todavía el programa legacy (`createLegacyTurnProgram`): el orquestador de pasos se activa en el app al
      enrutar el host al tool-loop (A8). Verificado con mocks en `engine-step-loop.test.ts`.
- [x] Deshacer turno/paso restaura por snapshot (API del motor + hooks del host; botón de UI → A8).

## Verificación
`npm run verify` (ai-harness 196 tests, jas-wave 326 tests, lint 0 errores); e2e/CLI → A8.

## Notas de traspaso
- **A8 (enhebrado en la app)**: `createJasWaveEngineHost` todavía registra `program: createLegacyTurnProgram` → la app
  ejecuta el legacy; el orquestador A5 vive en el tool-loop (tests/CLI). Para activarlo: retirar/condicionar `program` y
  dejar que `turnEntry` (create/auto + plan aprobado) mande; mapear `startCoproducerTurn` a `engine.runTurn`. El host ya
  tiene `auditStep`/`auditProject` (heurística mínima: pistas tras «crear pista») y snapshots por undo-depth: al enrutar,
  enchufarlos de verdad y añadir botones «Deshacer turno/paso» (llaman `engine.undoTurn`/`undoStep`).
- **Batch por iteración**: `runRegisteredTools` → `executor.batch` con un undo; respetar `userConfirmed` por tool y el
  orden de la política; el `undoId` de `EngineToolResult` ya existe para exponerlo.
- **Ajustes → IA**: presets de presupuesto (llamadas/caracteres/minutos) en la UI; el motor ya acepta `input.budget`.
- **A6**: `orchestrate` usa `paso.agente` solo como etiqueta/instrucción; el routing real de agentes queda pendiente.
- **QA real por paso**: el `auditStep` del host es una heurística; sustituirlo por evaluación de criterios contra el DAW
  (y `audit.mix` si hubo mezcla/master, como sugiere el bucle objetivo).
- Detalle: en `engine-plan-sync.test.ts` el guion mock ya no usa `afterToolResult:true` porque el paso siembra una
  instrucción de usuario que rompe ese matcher (el player consume respuestas en orden).
