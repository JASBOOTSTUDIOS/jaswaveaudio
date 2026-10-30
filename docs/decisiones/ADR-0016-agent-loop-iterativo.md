# ADR-0016: Agent Loop iterativo

## Contexto

El coproducer aún resuelve parte del turno con `<<<ACTIONS>>>` legacy, pero create/auto entra por Agent Loop (ADR-0016/0017). Ya existen bucles posteriores (`runHarnessFollowups`, `runHarnessUntilPlanComplete`), razonamiento con `<<<READ>>>`, `AgentWorkPlan` (ADR-0015) y Tool Registry (ADR-0006). Ver también `CONTEXTO-PROYECTO.md` (circuito A→C).

El `ExecutionPlan` de `shared/src/ai/planner.ts` es una lista **plana** de pasos (dry-run / confirmación). No se reutiliza como plan por fases.

El gateway Electron (`ai-chat`) solo envía `messages`; no hay function-calling nativo.

## Problema

Un disparo de ACTIONS no observa resultados reales, no puede leer antes de mutar con evidencia, ni replanificar si el usuario cambia el DAW a mitad de un objetivo.

## Decisión

1. Introducir `runAgentLoop` en `@jaswave/ai-harness`: OBSERVE → DECIDE → VALIDATE → ACT → OBSERVE RESULT → CONTINUE/STOP.
2. Contrato interno: `AgentDecision` + `AgentToolCall` (con `id`). El modelo propone; el loop coordina; el Command System muta.
3. Protocolo LLM en texto: `<<<DECISION>>>` JSON. `<<<ACTIONS>>>` se adapta a `tool-calls` de **una** iteración (compatibilidad).
4. Límites heredados: `maxIterations = HARNESS_MAX_OUTER_LOOPS` (8), `maxToolCallsPerIteration = 4` (tope `<<<READ>>>`), `maxTotalToolCalls = 32`. Cancelación = `AbortSignal` del turno.
5. Fases complejas = `AgentWorkPlan` existente, no un segundo `ExecutionPlan`.
6. `runHarnessFollowups` no corre dentro de cada iteración; queda como red de seguridad **tras** `complete` con mutaciones.
7. La UI observa el run por Event Bus (`ia.run*` / `ia.herramientaSolicitada`). No hay store React global del loop.
8. Function-calling nativo en el gateway queda fuera de esta oleada.

## Arquitectura

```
Usuario → (razonamiento READ opcional) → Agent Loop
  observe (contexto progresivo)
  chat → AgentDecision
  validate (registry / permisos / IDs)
  execute → executeDawActions / Command System
  observation + fingerprint
  repeat | complete | confirm | fail | cancel
```

## Flujo

Ver diagrama en la migración: lotes ≤4 tools; fingerprint entre iteraciones; `waiting-for-confirmation` reanuda `pendingCalls`.

## Compatibilidad

- `<<<ACTIONS>>>` y exports de `ai-daw-agent` se mantienen.
- ADR-0006: Tool Registry sigue siendo el catálogo de capacidades.
- ADR-0014: `daw.musicBuild` sigue siendo una herramienta orquestada, no 300 ACTIONS estáticas.
- ADR-0015: `plan.md` proyección; `AgentWorkPlan` para ops complejas.

## Consecuencias

- El modelo deja de controlar el DAW de un solo golpe.
- El prompt del loop recibe observación recortada, no el estado entero.
- Hay dos protocolos de texto (DECISION y ACTIONS) hasta que el modelo se acostumbre.

## Riesgos

- Doble reparación si harness y loop se anidan (mitigado: harness solo post-complete).
- Fingerprint débil si `checksum` sigue vacío (mitigado: reobserve ante cambio de clip-count/BPM).
- Registry `DEFERRED` vs switch de `executeDawActions` (el runner usa el switch mientras los handlers no sean reales).

## Migración

1. Contratos + loop con chat inyectado.
2. Observer + validator + runner.
3. Coproducer: BPM → mute selección → canción (WorkPlan + loop).

## Alternativas descartadas

- Function-calling nativo ahora (el gateway no lo soporta).
- Reescribir `executeDawActions`.
- Reusar el nombre `ExecutionPlan` para fases.
- Sustituir el Command System por mutaciones directas.
