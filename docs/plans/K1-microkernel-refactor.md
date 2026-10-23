# K1 — Microkernel: núcleo sin dependencias estáticas de plugins

**Depende de:** —
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`jas-wave/src/lib/plugin/bundled-plugins.ts`, `native/plugin-host/CMakeLists.txt`, `native/scripts/build-native.mjs`, `jas-wave/scripts/stage-plugin-host.mjs`

## Criterios de aceptación
El núcleo compila y arranca sin ningún plugin concreto presente; los plugins se resuelven desde el registro de manifiestos; build nativo del host verde.

## Checklist
- [x] (nativo) `native/plugin-host/CMakeLists.txt` ya no compila el piano; `VST3_SDK_DIR` cacheable
- [x] (nativo) `native/scripts/build-native.mjs` solo compila el núcleo; `build-plugins.mjs` compila los plugins
- [x] (nativo) `jas-wave/scripts/stage-plugin-host.mjs` deja de empaquetar VST3
- [x] (nativo) comando `getSlotStats` para el watchdog de cuarentena (V5 §2.4)
- [ ] (TS) registro de manifiestos y `bundled-plugins.ts` sin dependencias estáticas — otro agente

## Verificación
```bat
node native/scripts/build-native.mjs                 :: solo jaswave-plugin-host.exe
node native/scripts/build-plugins.mjs                :: plugins, aparte del núcleo
node native/plugin-host/scripts/slot-stats-test.cjs <host.exe> <plugin.vst3>   :: getSlotStats
```

## Notas de traspaso
- 2026-10-23 · Claude Opus 5.5: parte nativa hecha; build del host verificado (VS 2026, SDK del checkout principal).
- `getSlotStats` (`{"type":"getSlotStats","reset":true?}`) → `{"ok":true,"slots":[{"slot","path","blocks","avgLoad",
  "maxLoad","overruns","exceptions","bypassed"}]}`. load = tiempo de process() / (frames/sampleRate), medido con
  QueryPerformanceCounter en `HostedSlot::process` con contadores atómicos. process() de VST3 protegido con SEH
  (como VST2): al fallar, bypass silencioso y `exceptions` +1. La ruta de excepción no se ejercitó con un plugin que falle.
- Pendiente para jas-wave: `electron-builder.cjs` aún declara `resources/vst3/JasWave` (el stage la deja vacía),
  `bundled-plugins.ts`/`jaswave-roles.ts` mencionan rutas antiguas, `jas-wave/package.json` script `native:roles-vst`.
- Nota: `Vst3Slot::process` asigna vectores en el hilo de audio (cola MIDI/parámetros); conviene preasignarlos.
