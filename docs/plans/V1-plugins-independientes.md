# V1 — Plugins VST3 independientes en plugins/

**Depende de:** K1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`plugins/*`, `plugins/CMakeLists.txt`, `native/` (retiro de jaswave-fx)

## Criterios de aceptación
Cada plugin compila en Release con CMake propio; manifiestos V5 con metadatos IA y features licenciables; roles-vst y piano-synth movidos; `dsp_selftest` verde.

## Checklist
- [x] roles-vst y piano-synth movidos a `plugins/` con `git mv` (historia conservada)
- [x] `native/jaswave-fx` retirado; su de-esser/utility se reescribieron (LR4, M/S, mono-graves) con FUID e IDs compatibles
- [x] smart-deesser y utility-tool implementados
- [x] CMake propio por plugin + agregador `plugins/CMakeLists.txt` (`JW_VST3_SDK_DIR` cacheable)
- [x] Manifiestos V5 (license.features, ai.parameters con vstParamId) generados desde el código
- [x] Tests automatizados (selftest DSP, validator, pluginval)
- [x] Verificación reproducible documentada (plugins/README.md)

## Verificación
```bat
node native/scripts/build-plugins.mjs --test          :: 7 bundles + selftest + licencias (VS 2022; VS 2026: JASWAVE_CMAKE_GENERATOR)
node plugins/scripts/sync-manifests.mjs --check       :: manifiestos V5 = tabla real de parámetros
node plugins/scripts/validate-plugins.mjs --pluginval <pluginval.exe>   :: validator SDK + pluginval nivel 10
```

## Notas de traspaso
- 2026-10-23 · Claude Opus 5.5 (worktree de hardening/production). Hecho.
- FUID conservados: EQ/compresor/limitador = los de JasWaveFx y de los plugins previos; utility/de-esser = los de JasWaveFx;
  piano = el UID del piano previo (ahora procesador + controlador nuevo `...5A7B8C0E`); roles = los previos.
- ParamID: EQ/compresor/limitador/utility/de-esser siguen el layout de JasWaveFx (`processor-profiles.json`); los nuevos
  parámetros usan ids nuevos (EQ 42/43, utility 7–9, de-esser 5–8, limitador 4–5). El EQ de `plugins/` previo usaba ids
  1/2/3/41 con otro significado: se adopta el de JasWaveFx (el que usa el DAW). Estados previos (JasWaveFx, piano, roles)
  se convierten al cargar.
- Nombres de clase/vendor: "JasWave Audio" y nombres del manifiesto (p. ej. "JasWave EQ Parametric Pro"). El DAW busca
  todavía "JasWave EQ"/"JasWave"; lo ajusta el agente de jas-wave (P1/P2) leyendo el manifiesto.
- `jas-wave/package.json` conserva el script `native:roles-vst` que apunta a la ruta antigua (no se toca jas-wave).
- `native/scripts/package-plugins.mjs` (D1) aún supone carpetas `bin/` y `v1.0.0/`: actualizar en D1 a `plugins/build/VST3`.
