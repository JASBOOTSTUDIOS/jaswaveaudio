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
- [ ] `ai-harness/src/plan/structured-plan.ts`: `parsePlan(md)` → `{meta, steps[{id, fase, agente, titulo, estado, criterios[],
      herramientas[], evidencia[], notas}], notasUsuario}`; `serializePlan(plan)` con round-trip estable (tests de propiedad);
      tolera ediciones a mano (líneas sin id → id nuevo; agente desconocido → `@director`).
- [ ] `planHash` y `diffPlans(a,b)` (pasos añadidos/eliminados/reordenados/editados) para detectar ediciones del usuario.
- [ ] Engine: antes de cada paso relee `plan.md`; si el hash cambió y hay ediciones del usuario → re-sincroniza (respeta omitidos,
      nuevos pasos, reordenamientos, criterios editados) y emite `plan.updated` con el diff.
- [ ] Aprobación: estado `borrador → aprobado` (tarjeta "Aprobar plan / Editar / Descartar"); create sin plan aprobado → planifica y
      pide aprobación; auto → aprueba solo. Cambios de alcance propuestos por el agente → `plan.proposeChange` (diff) con aprobación;
      ajustes menores (añadir verificación, dividir paso) se aplican y registran.
- [ ] Eliminar `absorbUserRequestIntoPlan`; el Director (A6) crea/actualiza el plan desde el pedido.
- [ ] `evaluatePlanAgainstDaw` pasa a ser una ayuda de QA (no reescribe el plan); el estado lo deciden los agentes con evidencia
      (A9 `audit.step`).
- [ ] Editor (`agent-docs-panel.tsx`): vista de pasos (lista con estado, agente, criterios editables, reordenar arrastrando,
      omitir/reactivar, "Ejecutar desde aquí", "Ejecutar solo este paso") + pestaña Markdown crudo; ambos editan el mismo archivo.
      Quitar el "Ejecutar" por regex.
- [ ] Unificar: checklist y work-plan internos se expresan como pasos del plan (o se eliminan si quedan redundantes).
- [ ] Tests: parse/serialize, diff, re-sincronización tras edición del usuario a mitad de turno (mock), aprobación.

## Archivos
Nuevo `ai-harness/src/plan/structured-plan.ts`; `ai-harness/src/plan/eval.ts`, `jas-wave/src/lib/{agent-docs,agent-plan-eval,ai-agent-checklist}.ts`,
`components/{agent-docs-panel,agent-checklist-card}.tsx`, engine (A1).

## Criterios de aceptación
- Editar el plan a mitad de turno cambia lo que el agente hace en el siguiente paso (probado).
- Las notas del usuario nunca se pierden.

## Verificación
`npm run verify`; e2e: aprobar plan, editar un criterio, el agente lo usa.

## Notas de traspaso
_(vacío)_
