# P2 — Registro dinámico de herramientas IA

**Depende de:** P1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`ai-harness/src/tools/agent-tool-registry.ts`, `ai-harness/src/agent/action-policy.ts`

## Criterios de aceptación
Registrar/desregistrar en runtime actualiza tools expuestas; herramienta sin clase ⇒ bloqueada (fail-closed); filtro por rolesAllowed; tests Vitest.

## Checklist
- [x] Implementación
- [x] Tests automatizados
- [x] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- ai-harness/src/agents/registro-herramientas-dinamico.ts (AgentToolRegistry) + registroHerramientasPlugins en action-policy (consultado tras el mapa estático; sigue fail-closed).
- jas-wave: listAgentToolSchemas añade las herramientas de plugins (rol en el registro, modo con modeAllowsToolClass); executeTools enruta plugin.<alias>.* (describir directo; ajustar → plugin.setParameter por runRegisteredTools).
- Pruebas: ai-harness/src/test/registro-herramientas-dinamico.test.ts, jas-wave/src/lib/plugins/registro-plugins.test.ts.
