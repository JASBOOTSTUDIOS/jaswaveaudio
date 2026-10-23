# S1 — Auth JWT + servidor WebSocket de sincronización

**Depende de:** B0
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`backend/src/auth/`, `backend/src/sync/`, `backend/PROTOCOL.md`

## Criterios de aceptación
Sin token o token expirado ⇒ cierre 4001; refresh sin desconexión; heartbeat 15 s; reconexión con replay desde `lastSeq`; RBAC owner/editor/viewer por sala; tests con cliente `ws` real.

## Checklist
- [x] Implementación
- [x] Tests automatizados
- [x] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- WS en /sync con token por query (los navegadores no admiten cabeceras en WS).
- Bug corregido: mensajes llegados durante la verificación se perdían (ahora se encolan).
- Bug corregido: rechazo no manejado en la cola por sala (enSerie).
- seq se asigna en serie por sala en un único proceso; para escalar horizontalmente hará falta bloqueo en BD (advisory lock).
- 10 pruebas de integración con cliente ws real.
