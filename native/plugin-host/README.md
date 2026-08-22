# Plugin Host Process (ADR-0011 — aislamiento híbrido C)

Proceso **separado** del main de Electron para plugins de terceros (VST3).

## Capacidades (build-vst3 + SDK)

| Capacidad | Estado |
|-----------|--------|
| Discover `.vst3` | ✅ |
| Load + prepare + MIDI + audio (miniaudio) | ✅ |
| Editor HWND **embebido** en el tab Electron | ✅ |
| Soft Pad | in-process (Web Audio) |

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

Electron **prefiere** `build-vst3/Release/jaswave-plugin-host.exe` automáticamente.

## Protocolo

`ping`, `discover`, `load`, `prepare`, `unload`, `noteOn`, `noteOff`, `openEditor` (parentHwnd+bounds), `setEditorBounds`, `closeEditor`.

Fallback sin SDK: `node-host.cjs` (solo discovery).
