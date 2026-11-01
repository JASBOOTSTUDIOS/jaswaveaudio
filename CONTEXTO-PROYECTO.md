# CONTEXTO-PROYECTO — JasWave

Documento vivo de arquitectura del producto. Complementa `docs/arquitectura/VISION-GENERAL.md` y los ADRs. Si el código y este archivo divergen, **gana el código** y se actualiza este contexto.

Última actualización: 2026-09-03 (circuito Agent Loop A→C cerrado — ADR-0017).

---

## 1. Qué es JasWave

DAW (Digital Audio Workstation) **AI-First** sobre Electron + React + Vite. El estado del DAW es la única fuente de verdad; la UI es proyección. La IA no “mira” la interfaz: opera con herramientas estructuradas y observaciones de estado.

Paquetes:

| Paquete | Rol |
|---------|-----|
| `shared/` | Dominio: estado, Command System, Event Bus, Tool Registry, permisos |
| `ai-harness/` | Bucle IA: Agent Loop, observación, plan eval, modos, recovery |
| `jas-wave/` | App Electron/React: coproducer, bridge, Tool Runner, UI |

---

## 2. Circuito AI-First (contrato vigente)

```text
Usuario
  → observe (AgentContext / stateRevision)
  → decide (AgentDecision / ToolCall)
  → Tool Registry → Command System → Event Bus
  → observe de nuevo
  → complete | ask_user | waiting-for-confirmation
```

**No** es el modelo de producto a largo plazo:

```text
LLM → <<<ACTIONS>>> → tarjeta Aplicar → Command → harness one-shot
```

Ese flujo permanece solo como **adapter legacy** mientras migran tools agent-only (`daw.musicBuild`, etc.).

### Decisiones clave (ADR-0017)

1. **Tool Registry** = fuente de verdad de definición y ejecución (handlers → Command).
2. **`<<<ACTIONS>>>`** = adapter legacy; protocolo interno del loop = `AgentToolCall` / `AgentDecision`.
3. **Confirmación** pausa el `AgentRun` (store en memoria); **Aplicar** ejecuta `pendingCalls` y hace **resume** del loop.
4. **`stateRevision`** (`DAWState.checksum`) se actualiza tras cada comando; mismatch → `STATE_CONFLICT`.
5. **Sin heurísticas creativas** (`ensureMusicBuildForFullProject`, etc.) en el hot path **después** del Agent Loop.
6. **Congeladas** nuevas tools/capacidades IA hasta cerrar fases posteriores (D–F).

ADRs relacionados: [0006](docs/decisiones/ADR-0006-sistema-herramientas.md), [0014](docs/decisiones/ADR-0014-music-build-system.md), [0015](docs/decisiones/ADR-0015-agente-planificacion-ejecucion.md), [0016](docs/decisiones/ADR-0016-agent-loop-iterativo.md), [0017](docs/decisiones/ADR-0017-cerrar-circuito-agent-loop.md).

---

## 3. Dónde vive cada pieza

| Pieza | Ubicación |
|-------|-----------|
| Agent Loop | `ai-harness/src/loop/agent-loop.ts` |
| Contratos run / ToolCall | `ai-harness/src/loop/agent-run-types.ts` |
| Bridge coproducer ↔ loop | `jas-wave/src/lib/agent-loop-bridge.ts` |
| Tool Runner único | `jas-wave/src/lib/agent-tool-runner.ts` |
| Persistencia AgentRun (confirmación) | `jas-wave/src/lib/agent-run-store.ts` |
| Catálogo + registro tools | `jas-wave/src/lib/agent-action-catalog.ts` |
| UI Aplicar → resume | `jas-wave/components/pending-actions-card.tsx` |
| Entrada create/auto | `jas-wave/components/coproducer-panel.tsx` → `runCoproducerAgentLoop` |
| `stateRevision` | `shared/src/state/state-revision.ts` (aplicado en CommandExecutor) |
| `plugin.update` / path en insert | `shared/src/commands/plugin-commands.ts` |

---

## 4. Tipos que no hay que confundir

- **`ExecutionPlan`** (`shared/src/ai/planner.ts`) — lista plana dry-run / confirmación.
- **`AgentWorkPlan`** — plan por fases de operaciones complejas (ADR-0015).
- **`AgentRun` / `AgentRunResult`** — estado del Agent Loop iterativo (ADR-0016/0017).

---

## 5. Estado de migración (A→C hecho; D–F pendiente)

| Fase | Estado | Notas |
|------|--------|--------|
| A — Command + revision + conflict | Hecho | `plugin.update`; checksum; conflict en runner/apply |
| B — Tool Runner + handlers reales | Hecho | Catálogo: viaCommand si existe en Command Registry; DEFERRED solo agent-only |
| C — AgentRun store + Aplicar resume | Hecho | Store + `applyPendingAgentRun`; sin reconstruir ACTIONS olvidando el run |
| C+ — recovery DECISION | Hecho | `priorBrief` del reasoning → loop; reintento 1× si solo prosa; parser ACTIONS/JSON sueltos |
| BPM NaN / conflict UX | Hecho | `safeProjectBpm` + rechazo NaN en comando/AI; Aplicar conflict invalida AgentRun; audit `proposed` no fail |
| Loop verifica fallos | Hecho | Sin trackId → reject; `complete` bloqueado si hay error/rejected; resume post-Aplicar fuerza revisión |
| D — Observación progresiva | Pendiente | Reducir prompt monolítico |
| E — Deprecar ACTIONS en producto | Pendiente | Mantener adapter |
| F — Event UI / E2E | Pendiente | Suscribir UI a `ia.run*` / `ia.fase*` |

---

## 6. Verificación rápida

```bash
cd shared && npm test && npx tsc --noEmit
cd ai-harness && npm test && npx tsc --noEmit
cd jas-wave && npx tsx --test src/lib/agent-loop-bridge.test.ts src/lib/agent-tool-runner.test.ts src/lib/agent-run-store.test.ts
```

---

## 7. Principios operativos para agentes de código

- Mutaciones solo vía Command System (no `establecerEstado` en rutas de agente).
- No añadir tools IA nuevas hasta D–F o decisión explícita de descongelar.
- Tras cambios de arquitectura IA, actualizar este archivo y el ADR correspondiente.
- Tests del loop: preferir bridge/runner con tienda real; el chat del modelo puede ser fake.
