# JasWave Roles VST3

Instrumento nativo (stereo) que sustituye Soft Pad. Roles vía parámetro `Role` (id 0).

## Build (MSVC x64)

```bat
cd native/jaswave-roles-vst
cmake -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

O desde `jas-wave`:

```bat
npm run native:roles-vst
```

Instala en `%LOCALAPPDATA%\Programs\Common\VST3\JasWave\JasWaveRoles.vst3`.
