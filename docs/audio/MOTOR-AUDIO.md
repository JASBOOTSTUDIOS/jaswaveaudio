# Motor de Audio

> **Estado 2026-08-22:** el camino audible del DAW es **Web Audio** (`jas-wave/lib/audio-engine.ts`). `native/audio-engine` es stub de playhead (sin salida HW). El plugin-host tiene WASAPI propio, desacoplado. Unificar: [ADR-0013](../decisiones/ADR-0013-fx-runtime-pipeline.md) **[REQUIERE APROBACIÓN]**. El texto siguiente describe el **objetivo**, no la app de hoy.

## 1. Propósito

El Motor de Audio es responsable de todo el procesamiento de señal digital en tiempo real. Está estrictamente separado de Electron y se implementará en C++. Nunca se comunica directamente con la UI; todas las órdenes fluyen a través del Native Bridge.

## 2. Arquitectura

```
Electron Application
        ↓
Native Audio Bridge
        ↓
Native Audio Engine (C++)
        ↓
Audio I/O / DSP / Plugins
```

## 3. Responsabilidades

- Audio I/O (entrada/salida de dispositivos)
- DSP (procesamiento de señal digital)
- Mezcla (mixing)
- Routing
- Carga y ejecución de plugins
- Procesamiento MIDI
- Buffering
- Sample rate
- Latencia
- Grabación
- Reproducción
- Render/exportación

## 4. Hilo de Audio

El hilo de audio tiene máxima prioridad y reglas estrictas:

- Nunca se bloquea
- Nunca asigna memoria dinámicamente durante el procesamiento
- Nunca hace llamadas de red
- Nunca llama al LLM
- Nunca ejecuta operaciones pesadas
- Usa memoria preasignada (pools)

## 5. Interfaz del Native Bridge

El Native Bridge es la única vía de comunicación entre Electron y el motor de audio:

```typescript
interface NativeBridgeAPI {
  initialize(config: AudioEngineConfig): Promise<void>;
  startPlayback(): Promise<void>;
  stopPlayback(): Promise<void>;
  pausePlayback(): Promise<void>;
  seek(position: TimePosition): Promise<void>;
  startRecording(trackId: string): Promise<void>;
  stopRecording(): Promise<RecordingResult>;
  loadAudioFile(path: string): Promise<AudioBufferId>;
  unloadAudioBuffer(id: string): void;
  getAnalysis(trackId: string): Promise<AudioAnalysis>;
  getDeviceList(): Promise<AudioDevice[]>;
  setInputDevice(deviceId: string): Promise<void>;
  setOutputDevice(deviceId: string): Promise<void>;
  setSampleRate(sampleRate: number): Promise<void>;
  setBufferSize(bufferSize: number): Promise<void>;
  shutdown(): Promise<void>;
}

interface AudioEngineConfig {
  sampleRate: number;
  bufferSize: number;
  inputDeviceId?: string;
  outputDeviceId?: string;
}
```

**Contrato**: Todas las operaciones son no bloqueantes para el hilo de audio. Las operaciones largas retornan inmediatamente y notifican por eventos.

## 6. Configuración de Audio

```typescript
interface AudioDevice {
  id: string;
  name: string;
  type: 'input' | 'output' | 'duplex';
  sampleRates: number[];
  bufferSizes: number[];
  defaultSampleRate: number;
  defaultBufferSize: number;
}

interface AudioBufferId {
  id: string;
  sampleRate: number;
  channels: number;
  duration: TimeDuration;
  format: 'wav' | 'flac' | 'mp3';
}
```

## 7. Flujo de Datos de Audio

```
Entrada de Audio (micrófono/interface)
        ↓
Audio I/O
        ↓
Grabación → Audio Clip → Almacenamiento en disco
        ↓
Reproducción
        ↓
DSP Graph (plugins, ganancia, paneo)
        ↓
Mixer
        ↓
Routing (buses, sends)
        ↓
Salida de Audio (altavoces/auriculares)
```

## 8. DSP Graph

El motor construye un grafo de procesamiento dinámico:

```typescript
interface DSPGraph {
  nodes: DSPNode[];
  edges: DSPEdge[];
  
  addNode(node: DSPNode): void;
  removeNode(nodeId: string): void;
  addEdge(from: string, to: string): void;
  removeEdge(from: string, to: string): void;
  process(input: AudioBuffer, output: AudioBuffer): void;
}

interface DSPNode {
  id: string;
  type: 'track' | 'plugin' | 'bus' | 'output';
  pluginId?: string;
  parameters: ParameterValue[];
}
```

## 9. Latencia

La latencia total del sistema está compuesta por:

- **Latencia de dispositivo**: Depende del buffer size y driver
- **Latencia de plugins**: Cada plugin aporta su latencia de procesamiento
- **Latencia de routing**: Depende de la complejidad del grafo

Objetivo MVP: < 20ms de latencia total en configuraciones medias.

## 10. Rendering

El renderizado (exportación) se ejecuta fuera del hilo de audio en un worker dedicado:

```typescript
interface RenderJob {
  id: string;
  projectId: string;
  format: 'wav' | 'flac' | 'mp3';
  sampleRate: number;
  bitDepth: number;
  start: TimePosition;
  end: TimePosition;
  progress: number;
  status: 'pending' | 'rendering' | 'completed' | 'failed';
  outputPath?: string;
}
```

El Event Bus emite eventos de progreso del renderizado.

## 11. Consideraciones Futuras

- Soporte para VST3, AU, LV2
- Procesamiento offline (offline rendering)
- Sidechaining
- Regiones de renderizado
- Exportación de stems
- Integración con herramientas de mastering
