# W1 — Cliente web (arrangement, piano roll, Web MIDI)

**Depende de:** B0, K1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`jas-wave/src/platform/`, `jas-wave/components/arrangement/`, `jas-wave/components/piano-roll*.tsx`

## Criterios de aceptación
`npm run build:web` genera bundle; flujo de edición MIDI en navegador sin Electron (e2e); Web MIDI operativo.

## Checklist
- [x] build:web (vite --mode web → dist-web) y web:preview; CSP con orígenes del backend
- [x] Proyectos en IndexedDB con el mismo formato .jaswave (FileServiceNavegador), guardar/abrir/importar/exportar
- [x] Verificado en navegador con el build de producción: carga sin errores, login, admin, guardar y abrir
- [ ] IA en la web (pasa a M1)
- [ ] Audio de clips importados en web y piano roll 100 % Canvas (las notas ya son Canvas)

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- En web los VST no existen: W2 aporta WebSynth.
- Para desplegar: servir dist-web con CORS_ORIGINS del backend apuntando a ese origen.
