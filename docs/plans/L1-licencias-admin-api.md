# L1 — Licencias, roles por VST, grants y API admin

**Depende de:** B0
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`backend/src/license/`, `backend/src/admin/`, `backend/supabase/migrations/`

## Criterios de aceptación
Efectivo = roles ∪ grants allow − grants deny y solo con licencia activa; token Ed25519 con exp = 24 h; device-code login; solo admins acceden a `/admin/*` (validado en servidor); auditoría de cada cambio; tests de integración contra Supabase local.

## Checklist
- [x] Implementación
- [x] Tests automatizados
- [x] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- Usuario se identifica por correo (subAuth se vincula al primer login): el admin puede asignar antes del registro.
- Licencia jwl1 (no JWT) para verificar offline en C++ con Ed25519.
- Pendiente para L2/L3: incrustar clave pública en los VST; UI del panel admin.
- 9 pruebas de integración en test/integracion/licencias.int.test.ts.
