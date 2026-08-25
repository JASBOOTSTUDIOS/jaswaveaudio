# Plugin Host Process (ADR-0011 — aislamiento híbrido C)

Proceso **separado** del main de Electron para plugins de terceros (VST3 + VST2 x64).

## Capacidades (build-vst3 + SDK)

| Capacidad | Estado |
|-----------|--------|
| Discover `.vst3` y `.dll` VST2 | ✅ |
| Load + prepare + MIDI + audio (VST3 / VST2 x64) | ✅ |
| Editor HWND **misma instancia** que process | ✅ (STA + GetMessage; no editorhost) |
| Device WASAPI / Exclusive / DSound / WinMM / ASIO / JACK | ✅ seleccionable |
| Soft Pad | reemplazado por JasWaveRoles.vst3 (nativo) |
| VST2 32-bit | ❌ (requiere bridge externo) |

## Build

```bash
cd native/plugin-host/third_party/vst3sdk
git submodule update --init base cmake pluginterfaces public.sdk

# vendor/miniaudio.h debe existir
cd ../..
cmake -B build-vst3 -S . -G "Visual Studio 18 2026" -A x64 ^
  -DJASWAVE_VST3_SDK=ON -DSMTG_ENABLE_VSTGUI_SUPPORT=OFF ^
  -DSMTG_ENABLE_VST3_PLUGIN_EXAMPLES=OFF
cmake --build build-vst3 --config Release --target jaswave-plugin-host
```

## Build Roles VST3

```bash
cd native/jaswave-roles-vst
cmake -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release --target JasWaveRoles
```

Instala en `%LOCALAPPDATA%\Programs\Common\VST3\JasWave\JasWaveRoles.vst3`.


## Protocolo

`ping`, `discover`, `load`, `prepare`, `unload`, `noteOn`, `noteOff`, `openEditor` (parentHwnd+bounds), `setEditorBounds`, `closeEditor`.

Fallback sin SDK: `node-host.cjs` (solo discovery).
