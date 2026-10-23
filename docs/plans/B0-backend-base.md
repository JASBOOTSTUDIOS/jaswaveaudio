# B0 — Backend independiente (Express + TS + Supabase local)

**Depende de:** —
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`backend/` (paquete propio, sin imports fuera de `backend/`), `backend/supabase/migrations/`

## Criterios de aceptación
Arranca con `npm run dev`; `supabase start` + migraciones aplican; `/health` responde; typecheck, lint y tests verdes; cero imports hacia `shared/`, `ai-harness/`, `jas-wave/`.

## Checklist
- [ ] Implementación
- [ ] Tests automatizados
- [ ] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- (vacío: workstream pendiente)
