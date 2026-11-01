# Contexto común

## Producto
JasWave: DAW de escritorio para Windows (Electron 44 + React 19 + Vite) con host nativo de plugins VST3/VST2 en C++
(ASIO/WASAPI) y un asistente de IA. Monorepo:
- `shared/` — dominio (estado, comandos, undo/redo, permisos, análisis de audio, esquemas zod).
- `ai-harness/` — agente: razonamiento, agent loop, harness de reparación, política de acciones, presupuesto, plan.
- `jas-wave/` — app: `electron/` (main, preload, IPC, bridge HTTP de la CLI, gateway de IA), `src/`, `components/`, `lib/`
  (motor de audio), `cli/` (daw-cli).
- `native/` — `plugin-host` (exe), `jaswave-roles-vst`, `piano-synth` (VST3 propios).

## Decisiones del usuario (no re-discutir)
- **Modos:** mantener los 5 actuales — `auto`, `ask`, `plan`, `create`, `think` — pero que cada uno haga lo que promete y que
  **el selector del usuario mande** (las heurísticas solo sugieren).
- **Confirmación:** el usuario **aprueba (o edita) el plan una vez**; después el agente ejecuta todos los pasos sin parar.
  Solo vuelve a preguntar ante acciones **destructivas o de sistema** (borrar, cambiar dispositivo, render/guardar en rutas del
  usuario, sobreescribir).
- **Multi-agente:** **Director (orquestador) + especialistas**: Productor/Arreglista, Ingeniero de mezcla, Ingeniero de
  mastering, QA/Escucha.
- **CLI:** debe poder ejecutar **turnos completos** del agente (pedido, plan, aprobar, seguir progreso, cancelar).
- La IA debe actuar como **ingeniero de sonido profesional**: medir → diagnosticar → actuar con valores reales → re-medir.
- Siempre trabaja sobre un **plan** que el usuario puede modificar, y **no corta el turno** hasta terminar o necesitar al usuario.

## Hallazgos clave (estado actual, verificado en código)
### IA
- `detectAgentMode` (`ai-harness/src/agent/modes.ts:334`) sobreescribe el modo elegido con regex; create y auto son iguales.
- `processActionsForMode` (`jas-wave/components/coproducer-panel.tsx:407-611`) siempre propone 1 mutación como tarjeta
  "Aplicar" (`limitToOneMutatingAction`); el agent loop pausa en la primera escritura (`ai-harness/src/loop/agent-loop.ts:323-350`,
  `requireConfirmationForWrites: !input.resumeRun` en `jas-wave/src/lib/agent-loop-bridge.ts:67`).
- El prompt fuerza "¿te gustó?" de Kael (`ai-harness/src/agent/base-prompt.ts:13-19`, `agent-loop.ts:87-91`, `modes.ts:470`).
- Tras Aplicar el chat va **sin system prompt** y sin fallback (`jas-wave/components/pending-actions-card.tsx:294-305`).
- `plan.md` (`jas-wave/src/lib/agent-docs.ts`) es solo contexto; el loop no lo relee (observación sin docs,
  `agent-loop-bridge.ts:73-78`); `absorbUserRequestIntoPlan` (`src/lib/agent-plan-eval.ts:182`) mete el texto crudo del usuario
  como tarea; la evaluación (`ai-harness/src/plan/eval.ts`) es heurística.
- "Consejo" = un solo modelo con 5 voces (Nexus, Lyra, Volt, Kael, Iris) en `ai-harness/src/agent/reasoning-prompts.ts:48-195`;
  el bloque `<<<VERDICT>>>` se pide pero **nunca se parsea**.
- Tool use emulado con marcadores de texto (`<<<ACTIONS>>>`, `<<<DECISION>>>`, `<<<CLARIFY>>>`, `<<<READ>>>`, `<<<DOC>>>`,
  `<<<PLAN>>>`, `<<<CHECKLIST>>>`); el gateway (`jas-wave/electron/ai-gateway.ts`) no envía `tools` ni hace streaming.
- Bug de idempotencia: ids `c1, c2…` por decisión + `executedCallIds` del run reanudado → una llamada nueva `c1` puede
  marcarse "idempotent" sin ejecutarse (`jas-wave/src/lib/agent-tool-runner.ts:50-58`).
- La CLI solo ejecuta acciones crudas (`jas-wave/electron/agent-bridge.ts`, `src/lib/agent-audit-bridge.tsx runCliActions`);
  no hay ruta de chat/agente.

### Audio / ingeniería
- `shared/src/audio/loudness-bs1770.ts`: K-weighting fijo 48 kHz; true-peak con interpolación lineal (= sample peak);
  momentary/short-term = último bloque; LRA sin gating EBU; objetivos solo streaming −14 / club −9 / cd −9.
- `shared/src/audio/mix-analysis.ts`: espectro de **una** FFT de 4096 muestras del centro (≈85 ms); crest factor mezcla
  pico y LUFS; correlación global.
- `shared/src/commands/analysis-commands.ts`: todo `analysis.*` lee el **último render**; `analysis.loudness source:'play'`
  siempre falla (`project.analysis.master` nunca se escribe).
- Sin análisis por pista; stems de bounce solo audio seco sin VST; render pasa por cadena master + ×1.35 + soft limiter.
- `plugin.setParameter` solo valor normalizado (`ai-daw-agent.ts:2514-2551`); `plainValue` ignorado
  (`shared/src/commands/plugin-commands.ts:570-630`); sin semántica de EQ/compresor (`plugin-parameter-intel.ts`).
- No hay EQ/compresor/limitador propios; ganancias ocultas en el host: ×2 por canal (`native/plugin-host/src/main.cpp:607,766`),
  ×1.35 master tras la cadena (`:990-992`), soft limiter (`:596-601`).
- `jas-wave/src/lib/master-pass.ts`: cadena limitador→EQ→comp, sin parámetros, ajusta el fader post-cadena; renders de 120 s.
- `music-build/executor.ts` `MIX_BY_ROLE` fijo contradice `prompting/music-policy.ts`.

### Robustez (errores del usuario)
Ver detalle en U1–U7. Resumen: sin aviso de cambios sin guardar al cerrar/abrir; autosave ensucia undo y no guarda el master;
transporte y faders inundan el undo (pila de 200); Delete en piano roll borra el clip del arrange; BPM 0 → proyecto que no abre;
audio importado no se persiste en disco; grabaciones se pierden tras guardar en otra carpeta; reglas de dominio sin cablear;
destructivas sin undo.

## Herramientas ya existentes que conviene reutilizar
- Comandos/undo: `shared/src/state/ejecutor-comandos.ts` (cola serial, batch atómico, `redoPayload`, `limpiaHistorialUndo`).
- Esquema de proyecto: `shared/src/schemas/proyecto.ts` (`validarProyecto`, `validarProyectoArchivo`).
- Reparación de notas: `shared/src/project/reparar-notas.ts` (`esNotaMidiValida`, `repararNotasMidi`).
- Presupuesto del agente: `ai-harness/src/agent/budget.ts`; datos no confiables: `ai-harness/src/agent/untrusted.ts`.
- Política: `ai-harness/src/agent/action-policy.ts` (`AGENT_ACTION_CLASSES`, `gateAgentActionExecution`).
- Cola de jobs: `ai-harness/src/loop/job-queue.ts`. Revisión de estado: `shared/src/state/state-revision.ts`.
- Bounce nativo: `jas-wave/src/lib/bounce-service.ts`, `bounce-native-clips.ts`, codificación de grafo
  `src/lib/plugin/track-graph-encoding.ts`.
- Logger persistente: `jas-wave/electron/logger.ts`; IPC con guardas: `electron/security.ts` (`createGuardedIpc`).
- E2E: `jas-wave/e2e/` (Playwright sobre app empaquetada vía CDP; ver `e2e/README.md`).

## Glosario
- **Paso (step):** unidad del plan con id estable, responsable (agente), criterio de aceptación medible y estado.
- **Turno (run):** ejecución del motor desde un pedido hasta fin/necesidad del usuario; persistido en `AgentRun`.
- **VERDICT:** veredicto de QA (`{ok, issues[], evidencia}`) que bloquea el avance de un paso.
- **Acción destructiva/sistema:** clases `destructive`/`system` en `action-policy.ts`; siempre piden confirmación.
