# A8 · CLI con turnos completos del agente

**Objetivo:** desde la terminal se puede pedir, planificar, aprobar, seguir y cancelar turnos del agente, igual que en la UI.

## Contexto y hallazgos
- Bridge `jas-wave/electron/agent-bridge.ts` (rutas `/health`, `/audit`, `/audit/stream`, `/state`, `/actions`, `/transport`,
  `/command`), autenticado por token (`agent-bridge-auth.ts`, `cli/lib/bridge-auth.mjs`); off por defecto en la app empaquetada
  (`JASWAVE_AGENT_BRIDGE=1` o ajuste).
- Renderer atiende vía `AgentAuditHost` (`src/lib/agent-audit-bridge.tsx`) → `runCliActions` → `executeDawActions(source:'cli')`.
- CLI: `jas-wave/cli/daw-cli.mjs` (health, audit, watch, sync, state, list, action(s), transporte, audio, certify).
- No hay ruta de chat/agente; el turno vivía en el panel (lo resuelve A1).

## Tareas
- [ ] Bridge: `POST /agent/turn {text, mode, conversationId?}` → `{runId}`; `GET /agent/runs/:id`; `GET /agent/runs/:id/stream`
      (NDJSON de `EngineEvent`); `GET /agent/plan`, `PUT /agent/plan` (Markdown, valida con `parsePlan`), `POST /agent/approve
      {runId}`, `POST /agent/answer {runId, answer}` (confirmaciones/aclaraciones), `POST /agent/pause|resume|cancel {runId}`,
      `GET /agent/runs/:id/log` y `/diff` (A9). El renderer los atiende con el engine (A1).
- [ ] `daw-cli.mjs`: `agent "<pedido>" [--mode auto|ask|plan|create|think] [--follow] [--yes]` (con `--yes` aprueba plan y
      confirmaciones no destructivas; destructivas siguen pidiendo salvo `--yes-destructive`), `ask "<pregunta>"`,
      `plan show|edit [--editor]|approve`, `agent status|follow|pause|resume|cancel [runId]`, `agent answer <runId> "<texto>"`,
      `agent log|diff|audit [runId]`. Salida legible (timeline con agente, herramienta, resultado) y `--json`.
- [ ] La CLI usa el mismo engine y política que la UI (sin atajos), excepto `action/actions` explícitos que se mantienen como
      herramienta de desarrollador.
- [ ] Certificación: `cli/_certify-ai.mjs` añade escenarios de turno con `JASWAVE_AI_MOCK` (determinista) y opcionalmente con
      el proveedor real (`--real`): ask sin mutaciones, plan → editar → aprobar → create termina, cancelación.
- [ ] Documentar en `README.md` y `docs/RELEASE.md`.

## Archivos
`jas-wave/electron/agent-bridge.ts`, `src/lib/agent-audit-bridge.tsx` (o nuevo `src/lib/agent-engine-bridge.ts`),
`cli/daw-cli.mjs`, `cli/_certify-ai.mjs`, `cli/lib/bridge-auth.mjs`.

## Criterios de aceptación
- `node jas-wave/cli/daw-cli.mjs agent "masteriza para Spotify" --mode create --follow` completa el turno mostrando progreso.

## Verificación
App con `JASWAVE_AGENT_BRIDGE=1` (y `JASWAVE_AI_MOCK=…` para determinismo); `daw-cli certify --quick`.

## Notas de traspaso
_(vacío)_
