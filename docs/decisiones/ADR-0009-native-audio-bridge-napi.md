# ADR-0009: Native Audio Bridge (N-API + C++ + miniaudio)

## Estado

Aceptado. Complementa [ADR-0005](./ADR-0005-interfaz-motor-audio.md).

## Contexto

El realtime actual vive en Web Audio en el renderer (`jas-wave/lib/audio-engine.ts`).
Eso provoca underruns, reinicios de fuentes y freezes de UI bajo carga.

ADR-0005 exige un motor C++ con hilo de audio independiente. Falta el contrato
de build e integración con Electron.

## Decisión

1. **Lenguaje**: C++17 (no C).
2. **Empaquetado**: addon **N-API** (`node-addon-api`) cargado solo en proceso Electron (main o utilidad dedicada). El renderer habla con el addon vía IPC tipado en `preload`, no con `require` directo de Node en el DOM.
3. **I/O**: **miniaudio** (header único) para device output en Windows/macOS/Linux.
4. **Build**: CMake + `cmake-js` (script `npm run native:build` en monorepo / `jas-wave`).
5. **Fallback**: si el `.node` no está compilado o no es Electron, se usa Web Audio (preview + web:dev).

### Árbol

```
native/audio-engine/
  CMakeLists.txt
  include/jaswave_audio.hpp
  src/engine.cpp
  src/device_miniaudio.cpp
  src/napi_bridge.cpp
  vendor/miniaudio.h
```

### Contrato TypeScript (`NativeAudioBridge`)

```typescript
type AudioEngineConfig = { sampleRate: number; bufferSize: number }

type PlaybackTrack = {
  id: string
  volume: number // 0..1
  pan: number // -1..1
  muted: boolean
  solo: boolean
}

type PlaybackClip = {
  id: string
  trackId: string
  bufferId: string
  startSec: number
  durationSec: number
  bufferOffsetSec?: number
}

interface NativeAudioBridge {
  initialize(config: AudioEngineConfig): Promise<void>
  shutdown(): Promise<void>
  loadBuffer(id: string, samples: Float32Array, sampleRate: number, channels: number): Promise<void>
  unloadBuffer(id: string): Promise<void>
  setGraph(tracks: PlaybackTrack[], clips: PlaybackClip[]): Promise<void>
  transportPlay(): Promise<void>
  transportPause(): Promise<void>
  transportStop(): Promise<void>
  transportSeek(seconds: number): Promise<void>
  getPlayheadSeconds(): number
  getMeters(): Record<string, number>
  isAvailable(): boolean
}
```

### Reglas del hilo de audio

- Cero `new` / `malloc` / locks bloqueantes en el callback.
- Graph updates en hilo de control; swap atómico de snapshot.
- DAWState **no** entra al addon: solo snapshots de reproducción (`setGraph`).

### Flujo

```
playback-provider
  → IPC (preload)
  → main process loads jaswave_audio.node
  → Engine (C++) ↔ miniaudio device
```

## Consecuencias

- UI deja de mezclar AudioBufferSourceNodes en masa.
- Requiere toolchain C++ en máquinas de desarrollo (MSVC / Xcode / clang).
- Web sigue sin motor nativo (aceptable).

## Alternativas rechazadas

- AudioWorklet solo: sigue en el proceso del renderer y no cumple ADR-0005.
- Proceso separado + sockets: más aislamiento, más latencia; se revisará si hace falta sandbox.
