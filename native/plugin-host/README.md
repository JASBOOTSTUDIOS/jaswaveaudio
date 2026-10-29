# Plugin Host Process (ADR-0011 — aislamiento híbrido C)

Proceso **separado** del main de Electron para plugins de terceros (solo VST3 de 64 bits; VST2 retirado, ver ADR-0019).

## Capacidades (build-vst3 + SDK)

| Capacidad | Estado |
|-----------|--------|
| Discover `.vst3` | ✅ |
| Load + prepare + MIDI + audio (VST3 x64) | ✅ |
| Editor HWND **misma instancia** que process | ✅ (STA + GetMessage; no editorhost) |
| Device WASAPI / Exclusive / DSound / WinMM / ASIO / JACK | ✅ seleccionable |
| Soft Pad | reemplazado por JasWaveRoles.vst3 (nativo) |
| VST2 y VST3 de 32 bits | ❌ (no soportados) |

## Build

Desde la raíz del repo (lo mismo que hace CI):

```bash
npm run native:sdk     # clona/verifica third_party/vst3sdk @ v3.8.1_build_84 (+ submódulos)
npm run native:build   # plugin host + JasWavePiano + JasWaveRoles (Release x64, build-release/)
```

`native:build` usa el generador `"Visual Studio 17 2022"` (cambiable con
`JASWAVE_CMAKE_GENERATOR`) y `-DJASWAVE_INSTALL_USER_VST3=OFF`, así que no toca
`%LOCALAPPDATA%`. A mano, equivalente:

```bash
# vendor/miniaudio.h debe existir
cd native/plugin-host
cmake -B build-release -S . -G "Visual Studio 17 2022" -A x64 ^
  -DJASWAVE_VST3_SDK=ON -DSMTG_ENABLE_VSTGUI_SUPPORT=OFF ^
  -DSMTG_ENABLE_VST3_PLUGIN_EXAMPLES=OFF
cmake --build build-release --config Release --target jaswave-plugin-host
# piano-synth es EXCLUDE_FROM_ALL: con Visual Studio se compila desde su propia .sln
cmake --build build-release/piano-synth --config Release --target JasWavePiano
```

Por defecto (`JASWAVE_INSTALL_USER_VST3=ON`) los POST_BUILD de piano-synth y jaswave-roles-vst
copian además el bundle a `%LOCALAPPDATA%\Programs\Common\VST3\JasWave\` para desarrollo.

## Build Roles VST3

```bash
cd native/jaswave-roles-vst
cmake -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release --target JasWaveRoles
```

Instala en `%LOCALAPPDATA%\Programs\Common\VST3\JasWave\JasWaveRoles.vst3`.


## Protocolo

`ping`, `discover`, `load`, `prepare`, `unload`, `noteOn`, `noteOff`, `openEditor` (parentHwnd+bounds), `setEditorBounds`, `closeEditor`.

Editor embebido en el panel del DAW (V4, solo VST3): `openEditor {embedded:true, x, y, w, h}` abre un popup
sin borde y **sin padre/owner** (una ventana hija de otro proceso bloquea con `SendMessage`) en píxeles
físicos de pantalla; el view se ajusta a su proporción y se centra. `setEditorBounds {embedded:true, x, y,
w, h, visible, raise}` lo mueve, oculta o sube encima del DAW sin activarlo. Lo coordina
`jas-wave/electron/plugins/editor-embebido.ts`.

Fallback sin SDK: `node-host.cjs` (solo discovery).
