# JasWave Plugins — VST3 independientes

Cada carpeta `com.jaswave.plugin.*` es un **plugin VST3 autónomo** (Reaper, Cubase, Studio One, FL Studio…), no una
dependencia del DAW JasWave. Todos comparten un framework común, la UI "Cyber" (`shared-ui/DESIGN.md`) y la licencia
por cuenta (`CONTRATO-V5.md`). El manifiesto `jaswave-plugin.json` (esquema V5) describe cada plugin para el DAW y la IA.

| Carpeta | Bundle | Tipo | Features licenciables |
|---|---|---|---|
| `com.jaswave.plugin.param-eq` | `JasWaveParamEq.vst3` | EQ 8 bandas | `eq.bandas-avanzadas`, `eq.pendientes-altas`, `eq.analizador` |
| `com.jaswave.plugin.bus-compressor` | `JasWaveBusCompressor.vst3` | Compresor de bus | `comp.filtro-sidechain`, `comp.mezcla-paralela` |
| `com.jaswave.plugin.truepeak-limiter` | `JasWaveTruePeakLimiter.vst3` | Limitador true-peak | `limitador.medicion-lufs`, `limitador.dither` |
| `com.jaswave.plugin.smart-deesser` | `JasWaveSmartDeEsser.vst3` | De-esser | `deesser.escucha-sidechain`, `deesser.deteccion-relativa` |
| `com.jaswave.plugin.utility-tool` | `JasWaveUtility.vst3` | Utilidad de canal | `utilidad.mono-graves`, `utilidad.ancho-estereo` |
| `com.jaswave.plugin.piano-synth` | `JasWavePiano.vst3` | Instrumento (piano modal) | `piano.polifonia-extendida`, `piano.imagen-estereo` |
| `com.jaswave.plugin.roles-vst` | `JasWaveRoles.vst3` | Instrumento por roles | `roles.bateria`, `roles.efectos` |

Sin licencia válida el audio pasa en bypass limpio (instrumentos: silencio con fundido) y el editor muestra
"ACTIVAR JASWAVE". Una feature no concedida desactiva esa función en el DSP y bloquea su control (candado).

## Estructura compartida

```
plugins/
├── cmake/JasWavePlugins.cmake   # SDK (JW_VST3_SDK_DIR), jaswave_add_vst3(), objetivos _snapshot
├── shared-dsp/                  # jw_dsp.h (biquads, true-peak 4x BS.1770 / 8x, LUFS, buses lock-free),
│                                # jw_params.h (tablas de parámetros), jw_vst3.h (JwProcessor / JwController)
├── shared-ui/                   # Direct2D + DirectWrite (DESIGN.md), herramienta de capturas
├── shared-license/              # jwl1 Ed25519 (Monocypher), Manager device-code, DPAPI, WinHTTP
├── tests/                       # dsp_selftest, license_tests, license_e2e (+ run-e2e.mjs)
├── scripts/                     # validate-plugins.mjs, sync-manifests.mjs
└── docs/capturas/               # PNG de cada editor (completo, básico, sin licencia, activando)
```

## Compilar (Windows, MSVC)

```bat
cmake -S plugins -B plugins/build -G "Visual Studio 18 2026" -A x64
cmake --build plugins/build --config Release -- /m:4
```

o `node native/scripts/build-plugins.mjs`. Cada plugin también compila solo:
`cmake -S plugins/com.jaswave.plugin.param-eq -B build-eq -A x64`. El SDK VST3 se toma de `JW_VST3_SDK_DIR`.
Los bundles quedan en `plugins/build/VST3/Release/<Nombre>.vst3`.

## Verificar

```bat
plugins\build\tests\Release\jw_dsp_selftest.exe
plugins\build\tests\Release\jw_license_tests.exe
node plugins/tests/license/run-e2e.mjs plugins/build/tests/Release/jw_license_e2e.exe
cmake --build plugins/build/_vst3sdk/public.sdk/samples/vst-hosting/validator --config Release --target validator
node plugins/scripts/validate-plugins.mjs --pluginval <ruta a pluginval.exe>
node plugins/scripts/sync-manifests.mjs --check
```

Capturas (7 editores × 5 estados de licencia) y layout común (`<plugin>/ui-layout.json`, fuente de la réplica web):
`node plugins/scripts/ui-layout.mjs --capturas`. Una sola: `plugins/build/tools/Release/<Nombre>_snapshot.exe --out plugins/docs/capturas --name <id>`.
Para probar en un DAW sin instalar en carpetas del sistema: `powershell -File plugins/deploy_vst3.ps1`.

## Compatibilidad con proyectos previos

Los FUID y los ParamID son los del bundle `JasWaveFx` (EQ/compresor/limitador/utility/de-esser), del piano y del
roles previos; los estados guardados por esas versiones se convierten al cargar.
