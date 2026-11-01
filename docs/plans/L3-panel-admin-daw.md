# L3 — Login y panel admin dentro del DAW

**Depende de:** L1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`jas-wave/components/admin/`, `jas-wave/src/lib/auth/`, `jas-wave/vite.config.ts` (CSP)

## Criterios de aceptación
Panel visible solo con claim admin (el backend revalida); permite gestionar productos, features, roles, asignaciones, grants, licencias y auditoría; e2e: admin revoca feature y el cliente deja de verla tras refresh.

## Checklist
- [x] Implementación
- [x] Tests automatizados
- [x] Verificación reproducible documentada (en vivo en navegador contra backend + Supabase local)

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- Verificado en vivo (web:dev + backend + Supabase local): login, panel admin (matriz rol×acción, permisos directos, licencia, dispositivos, auditoría), renovación de licencia del equipo y /activar con device-code completo.
- Ojo en desarrollo: un Service Worker de otro proyecto en localhost:5173 cacheaba los GET y hacía parecer obsoleta la UI; se desregistró. JasWave no registra SW.
- Endurecido: la API responde Cache-Control: no-store y sin ETag; el cliente usa cache no-store y descarta respuestas de recargas obsoletas.
- OAuth en escritorio requiere el enlace profundo jaswave:// (H1); en web funciona con VITE_OAUTH_PROVIDERS.
