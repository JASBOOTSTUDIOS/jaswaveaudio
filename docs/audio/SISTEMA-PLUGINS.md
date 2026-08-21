# Sistema de Plugins

## 1. Propósito

El Sistema de Plugins permite descubrir, cargar, ejecutar y controlar plugins de audio (efectos e instrumentos virtuales). La IA debe poder consultar dinámicamente los plugins disponibles, sus parámetros y capacidades.

## 2. Arquitectura

```
Plugin Host (C++)
        ↓
Plugin Instance (VST3/AU/LV2)
        ↓
DSP Graph (Motor de Audio)
```

## 3. Descubrimiento de Plugins

El sistema escanea rutas conocidas en busca de plugins:

```typescript
interface PluginScanner {
  scan(paths: string[]): Promise<PluginScanResult[]>;
  watch(paths: string[]): Observable<PluginScanResult>;
  rescan(): Promise<void>;
}

interface PluginScanResult {
  id: string;
  name: string;
  manufacturer: string;
  format: 'vst3' | 'au' | 'lv2';
  category: string; // 'effect', 'instrument', 'analyzer', 'utility'
  version: string;
  inputs: number;
  outputs: number;
  parameters: ParameterDescriptor[];
  latency: number;
  canProcessInPlace: boolean;
}
```

## 4. Carga de Plugins

```typescript
interface PluginHost {
  load(pluginId: string, instanceId: string): Promise<PluginInstanceId>;
  unload(instanceId: string): Promise<void>;
  getParameter(instanceId: string, paramId: string): Promise<ParameterValue>;
  setParameter(instanceId: string, paramId: string, value: number): Promise<void>;
  getPresets(pluginId: string): Promise<Preset[]>;
  loadPreset(instanceId: string, presetPath: string): Promise<void>;
  savePreset(instanceId: string, presetPath: string): Promise<void>;
  getLatency(instanceId: string): Promise<number>;
  process(instanceId: string, input: AudioBuffer, output: AudioBuffer): void;
}

interface PluginInstance {
  id: string;
  pluginId: string;
  trackId: string;
  position: number; // posición en la cadena de inserts
  bypass: boolean;
  parameters: ParameterValue[];
}
```

## 5. Parámetros de Plugin

```typescript
interface ParameterDescriptor {
  id: string;
  name: string;
  type: 'float' | 'integer' | 'boolean' | 'enum';
  min: number;
  max: number;
  default: number;
  unit: string; // 'dB', '%', 'Hz', 'ms', 'samples', etc.
  automatable: boolean;
  enumValues?: { value: number; label: string }[];
}

interface ParameterValue {
  parameterId: string;
  value: number;
  normalized: number; // 0-1 para interpolación
}
```

## 6. Presets

```typescript
interface Preset {
  name: string;
  path: string;
  category: string;
  pluginId: string;
  parameters: Record<string, number>;
}

interface PresetManager {
  list(pluginId?: string): Promise<Preset[]>;
  save(pluginInstanceId: string, name: string, category?: string): Promise<Preset>;
  load(pluginInstanceId: string, preset: Preset): Promise<void>;
  delete(presetPath: string): Promise<void>;
}
```

Los presets se almacenan en formato JSON plano para facilitar la inspección y el versionado.

## 7. Cadenas de Efectos (FX Chains)

Una FX chain es una lista ordenada de plugins:

```typescript
interface FXChain {
  id: string;
  ownerId: string; // trackId, busId, etc.
  ownerType: 'track' | 'bus' | 'master';
  plugins: PluginInstance[];
  active: boolean;
}
```

## 8. Descubrimiento Dinámico por IA

La IA puede consultar los plugins disponibles:

```typescript
// Ejemplo de herramienta registrada automáticamente
toolRegistry.register({
  name: "plugin.list",
  description: "Listar todos los plugins disponibles",
  category: "plugin",
  risk: "read",
  parameters: [],
  returns: { type: "array" }
}, async (_, ctx) => {
  return { success: true, data: ctx.query.getPlugins() };
});
```

Cuando se carga un plugin, el sistema registra automáticamente herramientas para:
- Obtener parámetros
- Establecer parámetros
- Cargar presets
- Obtener latencia
- Ejecutar análisis (si aplica)

## 9. Formato de Plugins por Defecto

Para MVP, soportar **VST3** como formato principal por su amplia adopción en Windows y macOS.

 Futuro: AU (macOS), LV2 (Linux).

## 10. Sandboxing de Plugins

Los plugins de terceros se ejecutan en un entorno controlado:

- Límite de memoria por plugin
- Timeout de procesamiento
- Validación de parámetros antes de enviar al plugin
- Registro de errores de plugin sin crash del DAW
- Posibilidad de deshabilitar plugins problemáticos automáticamente

## 11. Latencia de Plugins

El sistema compensa automáticamente la latencia de plugins:

```typescript
interface LatencyCompensation {
  getTotalLatency(): number; // samples
  compensate(pluginId: string, samples: number): void;
  isCompensated(pluginId: string): boolean;
}
```

La compensación se aplica en el DSP graph retardando señales que pasan por plugins con menor latencia.
