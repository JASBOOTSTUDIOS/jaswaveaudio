# H1 — Handover web → desktop (jaswave://)

**Depende de:** S1, W1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`jas-wave/electron/instancia-unica.ts`, `jas-wave/electron/main.ts`, `jas-wave/electron-builder.cjs`, `backend/src/handover/`

## Criterios de aceptación
Token one-time de 60 s; registro del protocolo en NSIS; cursor/selección/reproducción restaurados en < 3 s (medido en test); reabre instancia existente.

## Checklist
- [x] Backend /handover (token 60 s, un solo uso, AES-256-GCM con clave derivada del token)
- [x] jaswave://abrir validado estrictamente; arranque y segunda instancia; protocolo en el instalador
- [x] Renderer: restaura proyecto (validado), posición, selección, reproducción y sesión; mide el tiempo
- [x] Botón web «Abrir en JasWave Desktop»
- [ ] Unirse automáticamente a la sala colaborativa (salaId viaja, falta el cliente WS en la app)

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- Tiempo medido en prueba: muy por debajo de 3 s (test handover.test.ts).
- setAsDefaultProtocolClient solo en la app empaquetada (en dev no se toca el registro de Windows).
- No se ha probado el salto real navegador → app instalada (requiere instalar el paquete); cubierto por pruebas de cada lado.
