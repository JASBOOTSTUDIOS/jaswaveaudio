# A4 · Plan estructurado y editable

**Objetivo:** el plan es la **fuente de verdad** del trabajo: legible y editable por el usuario (Markdown), parseable por el motor,
con pasos, responsables, criterios medibles y estado; el motor lo relee antes de cada paso.

## Contexto y hallazgos
- `jas-wave/src/lib/agent-docs.ts` (`PLAN_SLUG='plan.md'`, `DEFAULT_PLAN_MD`, `writeAgentDoc`, persistencia local + `{proyecto}/docs/`).
- `absorbUserRequestIntoPlan` (`src/lib/agent-plan-eval.ts:182`) añade el texto crudo del usuario como `- [ ]` en cada envío.
- Evaluación heurística `ai-harness/src/plan/eval.ts` (`evaluatePlanAgainstDaw`, `classifyPlanTask`); `syncPlanAfterDawChange`
  reescribe el plan como `origin:'ai'`.
- Editor: `components/agent-docs-panel.tsx` (textarea, "Evaluar", "Ejecutar" por regex → `daw.composeProject`/`musicBuild`).
- Otros artefactos de plan: `ai-harness/src/planning/agent-work-plan.ts` + `execution/plan-runner.ts` (fases internas),
  checklist (`src/lib/ai-agent-checklist.ts`, `components/agent-checklist-card.tsx`).

## Formato
```markdown
# Plan · <objetivo corto>
> Objetivo: <pedido normalizado> · Modo: create · Estado: aprobado (2026-10-20 10:31) · Revisión: 7

## Pasos
- [x] S1 · Diagnóstico · @qa — Medir mezcla actual
  - criterio: reporte audit.mix guardado
  - evidencia: LUFS −17.2, TP −0.3 dBTP, barro 250 Hz +4 dB vs curva pop
- [ ] S2 · Mezcla · @ingeniero-mezcla — Gain staging de todas las pistas
  - criterio: cada pista −18 ±3 dBFS RMS pre-fader; master con ≥6 dB de headroom
  - herramientas: analysis.track, track.update, clip.gain
- [~] S3 · Mezcla · @ingeniero-mezcla — Limpiar 200–400 Hz en guitarras y pad   ← en curso
- [-] S4 · … — omitido por el usuario
- [!] S5 · … — bloqueado: <motivo>

## Notas del usuario
(texto libre que el motor respeta y nunca reescribe)
```
Marcas: `[ ]` pendiente, `[~]` en curso, `[x]` hecho, `[-]` omitido, `[!]` bloqueado. Ids `S<n>` estables.

## Tareas
- [x] `ai-harness/src/plan/structured-plan.ts`: `parsePlan(md)` → `PlanEstructurado{titulo,objetivo,modo,estadoPlan,fecha,revision,pasos[{id,fase,agente,titulo,estado,criterios[],herramientas[],evidencia[],motivoBloqueo?}],notasUsuario}`;
      `serializePlan(plan)` con round-trip estable; tolera ediciones a mano (líneas sin id → id nuevo; sin agente → `director`;
      acepta `# Plan:` y `# Plan ·`; `[!]` con motivo inline o en sublínea `- bloqueado:`). Tests: 16 en `structured-plan.test.ts`.
- [x] `planHash` y `diffPlans(a,b)` (añadidos/eliminados/editados/reordenados) + `marcarPaso`, `aprobarPlan`, `siguientePasoPendiente`, `hayPasosPendientes`.
- [x] Engine: el tool-loop relee `plan.md` antes de **cada iteración** (`syncPlanState` en `tool-loop.ts`); si el hash cambió
      re-sincroniza (el archivo manda) y emite `plan.updated` con el diff; el plan aprobado en el archivo fija `run.planApproved`.
      La relectura por paso fino llega con el step-loop de A5.
- [x] Aprobación: borrador → aprobado queda registrada **en plan.md** (rev +1, notas intactas) al responder `approve-plan`;
      create sin plan aprobado pide aprobación; auto → `planApproved` siempre. `plan.proposeChange` queda para A6 (alcance).
- [x] Eliminar `absorbUserRequestIntoPlan` (+ `applyUserRequestToPlanMd` y helpers) y su llamada en `agent-legacy-turn.ts`.
- [x] `evaluatePlanAgainstDaw` es ayuda de QA: por defecto **no** reescribe (`rewrite?: true` para el caso viejo);
      `syncPlanAfterDawChange` ya no escribe el plan (solo devuelve la evaluación).
- [x] Editor (`agent-docs-panel.tsx`): vista de pasos (`data-testid="plan-steps-view"`) con checkbox, estado, agente/fase,
      criterios/evidencia/herramientas, botones por paso (Ejecutar → turno al agente con `mensajeDeEjecucionDePaso`, Hecho,
      Reanudar, Omitir), añadir paso, badge borrador/aprobado + "Aprobar plan" y toggle "Pasos/Markdown". Quitado el
      "Ejecutar" por regex (`daw.composeProject`/`musicBuild`). Lógica testable en `jas-wave/src/lib/agent-plan-steps.ts` (9 tests).
- [ ] Unificar: checklist y work-plan internos se expresan como pasos del plan (o se eliminan si quedan redundantes). **Diferido a A6**
      (decisión de producto sobre `ai-agent-checklist`/`agent-work-plan`; no bloquea A5).
- [x] Tests: parse/serialize/diff/hash/aprobación (`structured-plan.test.ts`), helpers del editor (`agent-plan-steps.test.ts`),
      sincronización del motor con edición a mitad de turno y aprobación en archivo (`engine-plan-sync.test.ts`).
- Pendientes menores de UI (no bloqueantes): reordenar pasos arrastrando, "Ejecutar desde aquí", criterios editables inline
  (hoy se editan en la pestaña Markdown).

## Archivos
Nuevo `ai-harness/src/plan/structured-plan.ts`; `ai-harness/src/plan/eval.ts`, `jas-wave/src/lib/{agent-docs,agent-plan-eval,ai-agent-checklist}.ts`,
`components/{agent-docs-panel,agent-checklist-card}.tsx`, engine (A1).

## Criterios de aceptación
- Editar el plan a mitad de turno cambia lo que el agente hace en el siguiente paso (probado).
- Las notas del usuario nunca se pierden.

## Verificación
`npm run verify`; e2e: aprobar plan, editar un criterio, el agente lo usa.

## Notas de traspaso
- **Formato canónico**: `serializePlan` emite `- [x] S1 · Fase · @agente — Título` + sublíneas `criterio:`/`herramientas:`
  (`a, b`)/`evidencia:`/`bloqueado:`. Round-trip: `parse(serialize(p)) === p` (test idempotente). Las Notas del usuario
  van **verbatim** al final; nada las reescribe. El plan viejo (Intención/Por implementar) sigue funcionando como docs
  legado: `parsePlan` devuelve null y el motor lo ignora (solo ancla al prompt).
- **Sincronización del motor** (`tool-loop.ts: syncPlanState`): se llama al inicio de cada iteración. Guarda `planHash` y
  `planMd` en `run.data` para difear; `plan.estadoPlan==='aprobado'` ⇒ `run.planApproved=true` (create puede mutar sin
  need). `engine-plan-sync.test.ts` cubre: aprobado ⇒ sin need; aprobación en respuesta ⇒ plan.md reescrito rev+1;
  edición a mitad de turno ⇒ `plan.updated` con `diff.added`.
- **A5 debe**: (1) construir el step-loop sobre `parsePlan`+`siguientePasoPendiente`+`marcarPaso` (ya exportados de
  `@jaswave/ai-harness`); (2) tras cada paso marcar `[x]`/`[!]` **reescribiendo desde el plan re-leído** (merge por id
  para no pisar ediciones del usuario entre pasos); (3) QA por paso con `EngineHost.auditStep` y `evidencia:` en el paso;
  (4) el panel usa `agent-plan-steps.ts` — añadir helpers ahí en vez de lógica nueva en el componente.
- **jas-wave lee ai-harness desde source** (`main: ./src/index.ts`): no hace falta build entre paquetes.
- **Legacy**: `createLegacyTurnProgram` (la app) no usa el tool-loop; los cambios de A4 en el motor aplican a tests/CLI.
  El legacy ya no absorbe pedidos ni reescribe plan con la evaluación (ambos desactuados en A4).
- **checklist/work-plan sin unificar** (A6): `ai-agent-checklist.ts`, `agent-checklist-card.tsx`,
  `planning/agent-work-plan.ts`, `execution/plan-runner.ts` siguen existiendo. Si A6 los elimina, quitar también
  `onRunSection`/`onRunTask` del panel si quedan sin uso.
- UI: los hooks de prueba clave del panel son `plan-steps-view`, `plan-estado`, `plan-approve`, `plan-view-toggle`,
  `plan-step-{S1,toggle,ejecutar,hecho,reanudar,omitir,evidencia}`, `plan-add-input`, `plan-add-btn`.
