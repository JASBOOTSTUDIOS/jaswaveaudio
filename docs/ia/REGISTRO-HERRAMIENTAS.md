# Registro de Herramientas

## 1. Propósito

El Registro de Herramientas es el catálogo de todas las herramientas disponibles para el AI Harness. Proporciona descubrimiento, validación de schemas y registro dinámico. El proveedor de IA consulta este registro para entender qué acciones puede realizar.

## 2. Interfaz del Registro

```typescript
interface ToolRegistry {
  register(definition: ToolDefinition, handler: ToolHandler): void;
  unregister(name: string): void;
  get(name: string): ToolDefinition | undefined;
  list(filter?: ToolFilter): ToolDefinition[];
  search(query: string): ToolDefinition[];
  generatePromptFragment(): string;
  generateCapabilities(): CapabilityDescriptor[];
  onChange(listener: ToolRegistryListener): Subscription;
}

interface ToolFilter {
  category?: string;
  risk?: RiskLevel;
  tags?: string[];
}
```

## 3. Flujo de Registro

```typescript
// 1. La capa de dominio define una herramienta
const getTrackTool: ToolDefinition = {
  name: "track.get",
  description: "Obtener detalles de un track por su ID",
  category: "track",
  risk: "read",
  parameters: [
    { name: "trackId", type: "string", required: true, description: "El identificador único del track" }
  ],
  returns: {
    type: "object",
    description: "Detalles del track incluyendo nombre, tipo, volumen, paneo, clips y plugins"
  }
};

// 2. Registrar con un handler que llama al sistema de comandos
toolRegistry.register(getTrackTool, async ({ trackId }, ctx) => {
  const result = ctx.commandExecutor.execute("track.get", { trackId });
  return { success: true, data: result.result, events: result.events };
});

// 3. La herramienta ya es descubrible
const tools = toolRegistry.list({ category: "track", risk: "read" });
const promptFragment = toolRegistry.generatePromptFragment();
```

## 4. Generación de Fragmento de Prompt

El proveedor de IA necesita una descripción compacta de las herramientas disponibles para incluir en el system prompt:

```typescript
interface ToolPromptFragment {
  tools: {
    name: string;
    description: string;
    parameters: {
      name: string;
      type: string;
      required: boolean;
      description: string;
    }[];
    risk: RiskLevel;
  }[];
}
```

Ejemplo de salida:
```
Herramientas disponibles:
- track.get: Obtener detalles de un track por su ID (read)
  Parámetros: trackId (string, required)
- track.volume.set: Establecer el volumen de un track en dB (write)
  Parámetros: trackId (string, required), dB (number, required, min: -60, max: 12)
...
```

Este fragmento se regenera cada vez que el registro cambia (ej: un plugin carga y registra nuevas herramientas).

## 5. Registro Dinámico de Herramientas

Los plugins y extensiones pueden registrar herramientas en runtime:

```typescript
// Un plugin de análisis espectral registra una herramienta
pluginHost.onPluginLoaded((plugin) => {
  if (plugin.type === 'analyzer') {
    toolRegistry.register({
      name: `plugin.${plugin.id}.analyze`,
      description: `Ejecutar análisis espectral usando ${plugin.name}`,
      category: "analysis",
      risk: "write",
      parameters: [
        { name: "trackId", type: "string", required: true },
        { name: "fftSize", type: "number", required: false, default: 2048 }
      ],
      returns: { type: "object" }
    }, async ({ trackId, fftSize }) => {
      // delegar al host de plugins
      return pluginHost.runAnalysis(plugin.id, trackId, fftSize);
    });
  }
});
```

El `CapabilityRegistry` expone todas las herramientas registradas al proveedor de IA mediante `getCapabilities()`.

## 6. Registro de Capacidades

El Registro de Capacidades es una vista de nivel superior de las capacidades del DAW, consumida por `getCapabilities()`:

```typescript
interface CapabilityRegistry {
  getCapabilities(): CapabilityDescriptor[];
  getCapability(name: string): CapabilityDescriptor | undefined;
}

interface CapabilityDescriptor {
  name: string;
  version: string;
  description: string;
  capabilities: {
    tools: string[]; // nombres de herramientas
    formats: string[]; // formatos de importación/exportación soportados
    hardware: HardwareCapability[];
    features: string[]; // "automation", "routing", "midi", etc.
  };
}
```

## 7. Convención de Nombres de Herramientas

Los nombres de herramientas siguen una convención estricta para facilitar el descubrimiento:

```
<dominio>.<accion>[.<subAccion>]
```

Ejemplos:
- `track.create`
- `track.delete`
- `track.volume.set`
- `plugin.load`
- `plugin.parameter.set`
- `automation.point.create`
- `midi.note.create`

## 8. Versionado de Herramientas

Las herramientas están versionadas. Cuando cambia el schema de una herramienta, se incrementa su versión. El fragmento de prompt incluye la versión. Si el proveedor de IA envía una llamada de herramienta con una versión antigua, se rechaza con un error de incompatibilidad de schema.

```typescript
interface ToolDefinition {
  name: string;
  version: string; // semver
  // ...
}
```

## 9. Deprecación de Herramientas

Las herramientas deprecadas permanecen disponibles pero se marcan en el fragmento de prompt:

```
- track.volume.set (deprecated, use track.gain.set)
```

Las herramientas deprecadas se eliminan después de 2 releases mayores.

## 10. Salud del Registro

El registro monitorea la salud de los handlers:

```typescript
interface ToolRegistryHealth {
  registeredCount: number;
  brokenHandlers: { name: string; error: string }[];
  lastUpdated: number;
}
```

Los handlers rotos se deshabilitan automáticamente y se reportan en el log de auditoría.
