# L3 — Login y panel admin dentro del DAW

**Depende de:** L1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`jas-wave/components/admin/`, `jas-wave/src/lib/auth/`, `jas-wave/vite.config.ts` (CSP)

## Criterios de aceptación
Panel visible solo con claim admin (el backend revalida); permite gestionar productos, features, roles, asignaciones, grants, licencias y auditoría; e2e: admin revoca feature y el cliente deja de verla tras refresh.

## Checklist
- [ ] Implementación
- [ ] Tests automatizados
- [ ] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- (vacío: workstream pendiente)
