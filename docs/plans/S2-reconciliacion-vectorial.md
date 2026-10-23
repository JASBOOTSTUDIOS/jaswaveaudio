# S2 — Reconciliación determinista y undo por usuario

**Depende de:** S1 (protocolo), K1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`shared/src/sync/`, `shared/src/state/pila-deshacer-rehacer.ts`, `shared/src/commands/*`

## Criterios de aceptación
N clientes simulados con mutaciones concurrentes en el mismo compás y entrega en orden aleatorio (seed fijo) convergen a checksum idéntico; undo por userId no revierte historial ajeno; handlers sin `Date.now`/`Math.random` (reloj/ids inyectados).

## Checklist
- [ ] Implementación
- [ ] Tests automatizados
- [ ] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- (vacío: workstream pendiente)
