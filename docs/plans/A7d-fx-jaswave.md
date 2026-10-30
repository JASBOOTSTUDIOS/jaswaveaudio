# A7d · FX propios JasWave (VST3)

**Objetivo:** procesadores incluidos con parámetros conocidos para que la IA mezcle y masterice sin depender de plugins de terceros.

## Contexto
- Hoy solo se distribuyen instrumentos: `JasWaveRoles.vst3` y `JasWavePiano.vst3` (`jas-wave/src/lib/plugin/bundled-plugins.ts`,
  `native/jaswave-roles-vst`, `native/piano-synth`). Build: `native/scripts/build-native.mjs`, staging
  `jas-wave/scripts/stage-plugin-host.mjs`, empaquetado en `resources/vst3/JasWave/`.
- Tipos sin implementación: `shared/src/types/mezcla.ts` (`EQParametros`, `CompresorParametros`, `limitador`).

## Plugins (un VST3 con varias clases, o varios; ids de parámetro fijos y documentados)
| Plugin | Parámetros |
|---|---|
| JasWave EQ | 8 bandas: tipo (HPF, low shelf, peak, high shelf, LPF, notch), freq 20–20k (log), gain ±24 dB, Q 0.1–18, on; output; analizador opcional |
| JasWave Comp | threshold −60..0 dB, ratio 1–20, attack 0.1–200 ms, release 5–2000 ms, knee 0–24 dB, makeup ±24 dB, mix 0–100 %, sidechain externo + HPF 20–500 Hz; medidor de reducción de ganancia (parámetro de salida read-only) |
| JasWave Limiter | ceiling −12..0 dBTP (true-peak con sobremuestreo 4×), input gain 0..+24 dB, release 1–1000 ms, lookahead 0–10 ms; GR read-only |
| JasWave Utility | gain ±24 dB, ancho 0–200 %, mono bajo X Hz (off/60–200), invertir fase L/R, balance |
| JasWave De-esser | freq 3–12 kHz, threshold, rango, modo split/wide |

## Tareas
- [x] `native/jaswave-fx/` con CMake (mismo patrón que `jaswave-roles-vst`, opción `JASWAVE_INSTALL_USER_VST3`), DSP en C++17
      sin dependencias extra; tests unitarios de DSP (respuesta en frecuencia del EQ, curva estática del compresor, ceiling del
      limitador con señal inter-sample). **Nota:** no compila aquí (falta VST3 SDK y MSVC); se deja listo para build en CI/Windows.
- [x] Integrar en `native/scripts/build-native.mjs` (`--no-fx`, `buildFx`, `expectFile` JasWaveFx.vst3), `stage-plugin-host.mjs`
      (staging del bundle FX), `bundled-plugins.ts` (bundles, rutas, ids de parámetro, registro/descubrimiento), `THIRD_PARTY_NOTICES`
      (SDK VST3). `electron-builder.cjs` ya cubre `resources/vst3/JasWave` (sin cambio).
- [x] Perfiles semánticos exactos en `processor-profiles.json` para los 5 FX JasWave (ids, unidades, rangos, tags, read-only GR).
- [x] Preferencia IA: `mix.eq/compress/limit` insertan/usan FX JasWave y traducen valores reales → normalizados vía perfiles.
- [x] UI: `jaswave-fx-panel.tsx` (tabs EQ/Compresor/Limitador/Utility/De-esser, perillas por parámetro, insertar si falta) cableado
      en `plugin-editor-panel.tsx` junto a `JasWaveRolesPanel`.
- [ ] E2E: insertar EQ JasWave, `mix.eq` con corte 6 dB a 300 Hz → `analysis.track` muestra banda reducida ~6 dB. **Bloqueado:** no hay
      app construida ni host de plugins disponible en este entorno.

## Archivos
Nuevo `native/jaswave-fx/`, `jas-wave/src/lib/plugin/{bundled-plugins,processor-profiles.json,jaswave-fx-mix.ts}`,
`jas-wave/components/jaswave-fx-panel.tsx`; modificado `native/scripts/build-native.mjs`, `jas-wave/scripts/stage-plugin-host.mjs`,
`jas-wave/src/lib/plugin/bundled-plugins.ts`, `jas-wave/src/lib/plugin/plugin-info-adapter.ts`, `jas-wave/src/lib/ai-daw-agent.ts`,
`jas-wave/src/lib/agent-action-catalog.ts`, `jas-wave/components/plugin-editor-panel.tsx`, `THIRD_PARTY_NOTICES.md`.

## Verificación
- `jas-wave`: `tsc` (typebuild+electron+e2e), `tsx --test` (456 pruebas, incl. 29 nuevas de FX), `eslint` — todo verde.
- `ai-harness`: `tsc --noEmit` + vitest (229 pruebas) — verde tras añadir `mix.eq/compress/limit` a `AGENT_ACTION_CLASSES` (`write`).
- `npm run native:build`: **falla pre-existente** sin VST3 SDK (no verificable aquí).
- ctest DSP nativo y e2e: **no ejecutables** en este entorno.

## Notas de traspaso
- Los ids de parámetro fijos viven en `native/jaswave-fx/src/processor.h` (namespaces EqParam…/…Param; bypass=0, bandas base=1
  stride=5, GR read-only id=40 para Comp/Limiter) y se espejan en `bundled-plugins.ts` (`JASWAVE_FX_*`) y `processor-profiles.json`.
- El C++ de `native/jaswave-fx/` está escrito pero **no se compila aquí** (no hay VST3 SDK en `native/plugin-host/third_party/vst3sdk`
  ni cl.exe/MSVC; solo cmake 4.1.2). Es C++17 sin dependencias extra, patrón igual a `jaswave-roles-vst`.
- Al continuar en Windows con el SDK: `cmake -S native/jaswave-fx -B build -DJASWAVE_INSTALL_USER_VST3=ON`, luego `cmake --build build`
  y `ctest`; el POST_BUILD empaqueta `JasWaveFx.vst3`.
- Queda pendiente: E2E de A7d (requiere app construida + host de plugins).
