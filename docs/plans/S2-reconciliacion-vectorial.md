# S2 — Reconciliación determinista y undo por usuario

**Depende de:** S1 (protocolo), K1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`shared/src/sync/`, `shared/src/state/pila-deshacer-rehacer.ts`, `shared/src/commands/*`

## Criterios de aceptación
N clientes simulados con mutaciones concurrentes en el mismo compás y entrega en orden aleatorio (seed fijo) convergen a checksum idéntico; undo por userId no revierte historial ajeno; handlers sin `Date.now`/`Math.random` (reloj/ids inyectados).

## Checklist
- [x] Implementación
- [x] Tests automatizados
- [x] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- Determinismo: los handlers usan  (shared/src/state/entorno-determinista.ts); el ejecutor fija un EntornoComando por comando y lo reutilizan las réplicas.
- Replicación híbrida:  en CommandDefinition — 'operacion' (por defecto), 'resultado' (28 comandos de medición/host: instantánea parcial) y 'local' (15: selección, transporte, UI → canal de presencia).
- Réplica con rebase sobre el orden total del servidor (shared/src/sync/replica.ts); ClienteColaborativo aplica lo remoto dentro de la cola del ejecutor (enColaExterna).
- Undo por usuario: pilas por userId (sin userId → 'local', conserva la UX de deshacer cambios de la IA local). Los cambios remotos nunca entran en la pila local.
- Inverso diferencial de notas MIDI (midi.notes.patch + redoType): deshacer lo propio no borra notas ajenas del mismo clip.
- Prueba §8.2: 4 clientes × 5 semillas, red simulada con JSON y latencias aleatorias; prueba de mutación confirma que detecta divergencia.
- Pendiente para W1/H1: integrar ClienteColaborativo con el transporte WebSocket real en jas-wave; base común de la sala (snapshot del proyecto en seq 0).
- midi.notes.set (piano roll) se replica como 'set' completo: dos ediciones simultáneas del mismo clip con notes.set resuelven por último-en-escribir (converge). Para fusión fina, el piano roll debería emitir midi.notes.patch.
