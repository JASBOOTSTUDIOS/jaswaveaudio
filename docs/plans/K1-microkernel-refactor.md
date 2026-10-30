# K1 — Microkernel: núcleo sin dependencias estáticas de plugins

**Depende de:** —
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`jas-wave/src/lib/plugin/bundled-plugins.ts`, `native/plugin-host/CMakeLists.txt`, `native/scripts/build-native.mjs`, `jas-wave/scripts/stage-plugin-host.mjs`

## Criterios de aceptación
El núcleo compila y arranca sin ningún plugin concreto presente; los plugins se resuelven desde el registro de manifiestos; build nativo del host verde.

## Checklist
- [x] Parte nativa (agente nativo): host sin plugins, build-native solo núcleo, JasWaveFx retirado
- [x] Parte TS: FX por id de manifiesto, catálogo desde manifiestos, sin bundle único ni rutas fijas
- [x] Proyectos antiguos con JasWaveFx.vst3 se cargan con el plugin independiente equivalente
- [x] Instalador sin plugins incluidos; e2e 15 en Electron real

## Verificación
```bat
node native/scripts/build-native.mjs                 :: solo jaswave-plugin-host.exe
node native/scripts/build-plugins.mjs                :: plugins, aparte del núcleo
node native/plugin-host/scripts/slot-stats-test.cjs <host.exe> <plugin.vst3>   :: getSlotStats
```

## Notas de traspaso
- El DAW resuelve cada plugin por su manifiesto: escáner en main (rutaDsp: carpetas VST3 primero; en dev plugins/build/VST3/Release con lectura concedida) y catálogo en el renderer (registro-plugins.ts, id jaswave:<id>).
- jaswave-fx-mix.ts: FX_PLUGIN_ID por tipo; processor-profiles.json se mantiene para rangos (mismos ParamID).
- plugin-info-adapter: rutaSustitutoFxLegado migra al cargar los FX guardados con JasWaveFx.vst3.
- e2e/15-plugins-manifiesto.spec.ts: 7 paquetes, binarios resueltos y carga real en el host.
