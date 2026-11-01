# B0 — Backend independiente (Express + TS + Supabase local)

**Depende de:** —
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`backend/` (paquete propio, sin imports fuera de `backend/`), `backend/supabase/migrations/`

## Criterios de aceptación
Arranca con `npm run dev`; `supabase start` + migraciones aplican; `/health` responde; typecheck, lint y tests verdes; cero imports hacia `shared/`, `ai-harness/`, `jas-wave/`.

## Checklist
- [x] Implementación
- [x] Tests automatizados
- [x] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- Express 5 (manejo nativo de rechazos async) + Prisma 7 con @prisma/adapter-pg; cliente generado en src/generated (no versionado).
- Supabase local con puertos 553xx para no chocar con otro proyecto (54322 ocupado por mecenazgos-api).
- JWT ES256 por JWKS: requiere supabase/signing_keys.json (no versionado). Ver backend/README.md.
- Prueba de humo real: JWT de Supabase Auth verificado, /admin 200 con super-admin, WS 4001 sin token.
- npm audit --omit=dev: 0 vulnerabilidades (Prisma 6 arrastraba deepmerge-ts vulnerable).
