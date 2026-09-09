# ADR-0017: Cerrar el circuito Agent Loop

## Contexto

La auditoría (ADR-0016 + informe) mostró rutas paralelas: Tool Registry vs `executeDawActions`, ToolCall vs `<<<ACTIONS>>>`, Agent Loop vs harness, y mutaciones vía `establecerEstado`. El producto aún opera como `LLM → ACTIONS → Aplicar → Command`, no como circuito AI-First.

## Decisión

1. **Tool Registry** es la fuente de verdad de definición y ejecución (handlers → Command System).
2. **`<<<ACTIONS>>>`** queda como adapter legacy; el protocolo interno del Agent Loop es `AgentToolCall` / `AgentDecision`.
3. **Confirmación** pausa el `AgentRun` (no lo destruye); Aplicar ejecuta `pendingCalls` y hace **resume**.
4. **`stateRevision`** (`DAWState.checksum`) se actualiza tras cada comando exitoso; mismatch → `STATE_CONFLICT` + re-observe.
5. **Sin heurísticas creativas** en el hot path post-loop (`ensureMusicBuildForFullProject` fuera de create/auto tras el loop).
6. **Congelar** nuevas tools/capacidades IA hasta cerrar Fases A–C.
7. **No reescribir** `runAgentLoop`; reparar bridge/UI alrededor.

## Migración

- **A:** `plugin.update` / path vía Command; checksum; conflict gate.
- **B:** Tool Runner único; handlers reales (no DEFERRED en smoke path); quitar musicBuild heurístico post-loop.
- **C:** store de AgentRun; Aplicar → resume.

Fases D–F (observation progresiva, deprecar ACTIONS, Event UI / E2E) quedan fuera de esta oleada.

## Consecuencias

- Una sola ruta de mutación para el agente.
- El razonamiento sobrevive a la confirmación del usuario.
- `CONTEXTO-PROYECTO` / ADRs deben reflejar el circuito cerrado, no el one-shot ACTIONS.

## Referencias

ADR-0006, ADR-0015, ADR-0016.
