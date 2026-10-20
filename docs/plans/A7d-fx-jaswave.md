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
- [ ] `native/jaswave-fx/` con CMake (mismo patrón que `jaswave-roles-vst`, opción `JASWAVE_INSTALL_USER_VST3`), DSP en C++17
      sin dependencias extra; tests unitarios de DSP (respuesta en frecuencia del EQ, curva estática del compresor, ceiling del
      limitador con señal inter-sample).
- [ ] Integrar en `native/scripts/build-native.mjs`, `stage-plugin-host.mjs`, `bundled-plugins.ts`, `electron-builder.cjs`
      (`extraResources`), `THIRD_PARTY_NOTICES` (solo SDK VST3).
- [ ] Perfiles semánticos exactos en `processor-profiles.json` (A7c) para los FX JasWave (ids, unidades, rangos).
- [ ] Preferencia por defecto de la IA: `mix.eq/compress/limit` usan FX JasWave salvo que el usuario pida un plugin concreto.
- [ ] UI: editores simples (o el genérico de parámetros) para los FX JasWave.
- [ ] E2E: insertar EQ JasWave, `mix.eq` con corte de 6 dB a 300 Hz → `analysis.track` muestra la banda reducida ~6 dB.

## Archivos
Nuevo `native/jaswave-fx/`; `native/scripts/build-native.mjs`, `jas-wave/scripts/stage-plugin-host.mjs`,
`jas-wave/electron-builder.cjs`, `src/lib/plugin/{bundled-plugins,processor-profiles.json}`.

## Verificación
`npm run native:build`; tests DSP nativos (ctest); `npm run verify`; e2e.

## Notas de traspaso
_(vacío)_
