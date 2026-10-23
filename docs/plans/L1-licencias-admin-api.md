# L1 — Licencias, roles por VST, grants y API admin

**Depende de:** B0
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`backend/src/license/`, `backend/src/admin/`, `backend/supabase/migrations/`

## Criterios de aceptación
Efectivo = roles ∪ grants allow − grants deny y solo con licencia activa; token Ed25519 con exp = 24 h; device-code login; solo admins acceden a `/admin/*` (validado en servidor); auditoría de cada cambio; tests de integración contra Supabase local.

## Checklist
- [ ] Implementación
- [ ] Tests automatizados
- [ ] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- (vacío: workstream pendiente)
