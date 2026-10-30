# D1 — Instalador ligero (nsis-web) y entrega modular de plugins

**Depende de:** V1, L2
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`jas-wave/electron-builder.cjs`, `native/scripts/package-plugins.mjs`, `jas-wave/electron/plugins/fetcher.ts`

## Criterios de aceptación
Stub nsis-web < 40 MB medido; descarga en segundo plano con progreso no bloqueante; verificación SHA-256 + firma del índice; carga en caliente sin reiniciar; publicación en GitHub Releases solo tras confirmación del usuario.

## Checklist
- [ ] Implementación
- [ ] Tests automatizados
- [ ] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- (vacío: workstream pendiente)
