# L2 — Licencia dentro de cada VST (device-code, Ed25519, offline 24 h)

**Depende de:** L1, V1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`plugins/shared-license/`

## Criterios de aceptación
Sin licencia ⇒ overlay 'Iniciar sesión' y bypass limpio; feature no concedida ⇒ control bloqueado y DSP desactivado; verificación de firma offline; lectura atómica desde el hilo de audio.

## Checklist
- [ ] Implementación
- [ ] Tests automatizados
- [ ] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- (vacío: workstream pendiente)
