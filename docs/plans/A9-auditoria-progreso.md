# A9 · Herramientas de auditoría y progreso para los agentes

**Objetivo:** que cada agente sepa qué se hizo, si quedó bien y cuánto falta; que el usuario (UI y CLI) vea lo mismo.

## Herramientas (clase `read`, registradas con JSON Schema, disponibles para todos los roles salvo indicación)
| Herramienta | Devuelve | Base existente |
|---|---|---|
| `plan.get` / `plan.status` | Plan parseado, % completado, paso actual, bloqueos, pasos editados por el usuario desde la última lectura | `structured-plan.ts` (A4) |
| `plan.updateStep {id, estado, evidencia, notas}` | Actualiza un paso (solo agente asignado o director; QA marca hecho) | A4 |
| `plan.addStep` / `plan.proposeChange {diff}` | Añadir paso / proponer replan (requiere aprobación si cambia alcance) | A4 |
| `run.log {runId?, desde?}` | Bitácora: cada acción (agente, herramienta, args resumidos, resultado, duración, undo id) | `AgentRun` (A1), `ai-daw-audit-store.ts` |
| `run.diff {desde: 'turno'\|'paso:S3'\|'snapshot:<id>'}` | Diff de proyecto: pistas, clips, notas (conteos), plugins y parámetros (en unidades), mezcla en dB, routing | `shared/src/state/diff-estado.ts` (si existe) / `state-revision.ts` |
| `audit.project` | Estructura, instrumentos sin cargar, clips vacíos, notas fuera de rango/duplicadas, pistas mudas con contenido, solos olvidados, plugins en cuarentena/bypass, media faltante, ruteo roto, valores inválidos | `ai-harness/src/loop/production-audit.ts`, `inspectDawHealth` (`harness.ts`), `src/lib/midi-note-dedupe.ts` |
| `audit.mix {objetivo?}` | `analysis.mix` + `analysis.diagnose` + objetivo de plataforma + comparación con la medición anterior (mejoró/empeoró por métrica) | A7a/A7b |
| `audit.step {stepId}` | Evalúa los `criterio:` del paso con mediciones (parser de criterios: "LUFS −14 ±1", "TP ≤ −1", "pista X −18 ±3 dBFS RMS", "sin masking kick/bajo"…) → `{cumple, evidencia[]}` | A4 + A7 |
| `audit.history {metrica?}` | Serie de mediciones del turno/proyecto (LUFS, TP, PLR, balance tonal, masking) | almacén nuevo `analysis-history` |
| `audit.compareReference` | Diferencias contra la referencia (banda, LUFS, ancho, dinámica) | A7b `analysis.reference` |
| `session.summary` | Resumen compacto para retomar: objetivo, plan, hecho/pendiente, últimos problemas, últimas mediciones | todo lo anterior |

## Reglas del motor
- QA no puede marcar `[x]` sin `audit.step` con `cumple:true` (evidencia adjunta al paso).
- El Director no puede cerrar el turno sin `audit.project` limpio (o problemas aceptados explícitamente) y, si hubo mezcla/master,
  `audit.mix` dentro de criterios.
- Todas las acciones quedan en `run.log`; evidencia antes/después en el plan.

## Tareas
- [ ] Almacén de bitácora en `AgentRun` (A1) + persistencia; `run.log` y `run.diff` (diff semántico en unidades).
- [ ] `audit.project` unificando `production-audit.ts` + `inspectDawHealth` + nuevas comprobaciones (media faltante, valores inválidos,
      cuarentena, ruteo roto).
- [ ] Parser de criterios medibles (`ai-harness/src/plan/criteria.ts`) + `audit.step`.
- [ ] `analysis-history` (por proyecto, en `{proyecto}/docs/analysis-history.json`) y `audit.history`.
- [ ] `session.summary` (≤ ~1.5k tokens) usado por el Director en cada paso.
- [ ] UI: panel "Progreso" (plan con % y estado por paso, bitácora filtrable por agente, diffs, gráfica de tendencia de mediciones).
- [ ] CLI (A8): `agent log|diff|audit`.
- [ ] Tests: parser de criterios; `audit.step` con mediciones sintéticas; `run.diff` de un cambio de EQ muestra dB/Hz.

## Archivos
Nuevos `ai-harness/src/plan/criteria.ts`, `ai-harness/src/engine/run-log.ts`; `ai-harness/src/loop/{production-audit,harness}.ts`,
`shared/src/ai/tool-registry.ts`, `jas-wave/src/lib/{agent-action-catalog,ai-daw-agent}.ts`, componentes de progreso.

## Verificación
`npm run verify`; e2e con mock: turno de mezcla deja evidencia por paso y `audit.mix` final dentro de objetivo.

## Notas de traspaso
- Integrado catálogo/schemas/registry: 13 herramientas A9 en `agent-action-catalog.ts`, `agent-tool-schemas.ts`, `shared/src/ai/tool-schemas.ts`. QA limitado a lecturas (`ask/create` qa sin escrituras). `plan.updateStep` sigue regulado por motor.
- Host: `executeTools` enruta `plan.*`/`run.*`/`audit.*`/`session.summary` a `runAuditTool` (estado/engine). `auditStep`/`auditProject` usan núcleo A9 con fallback. `getActiveEngine()` expuesto.
- Panel "Progreso": plan con %/paso actual/bloqueos, bitácora filtrable por agente (`listarAuditHistorial`), `run.diff` (proyección + resumen), tendencia LUFS. Montado en `workspace/types.ts` + `tool-host.tsx`.
- CLI `agent log|diff|audit` queda para A8. No se modifica CLI.
- CRLF normalizado en archivos editados.
