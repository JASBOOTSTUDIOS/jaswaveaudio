# Sistema de Herramientas

## 1. Propósito

El Sistema de Herramientas expone las capacidades del DAW al AI Harness como operaciones estructuradas y auto-descritas. Toda acción que el usuario puede realizar es representable como herramienta. Las herramientas son la **única** interfaz entre la IA y el dominio del DAW.

## 2. Definición de Herramienta

```typescript
type RiskLevel = 'read' | 'write' | 'dangerous';

interface ToolDefinition {
  name: string;
  description: string;
  version: string;
  category: ToolCategory;
  risk: RiskLevel;
  parameters: ToolParameter[];
  returns: ToolReturn;
  examples?: ToolExample[];
  requiresConfirmation?: boolean; // override según nivel de permiso del usuario
  idempotent?: boolean;
}

interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: unknown;
  enum?: unknown[];
  min?: number;
  max?: number;
}

interface ToolReturn {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  description: string;
  schema?: JSONSchema;
}

interface ToolExample {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}
```

## 3. Categorías de Herramientas

Las herramientas se organizan por dominio:

| Categoría | Prefijo | Ejemplos |
|-----------|---------|----------|
| Proyecto | `project.*` | `project.getState`, `project.save`, `project.new` |
| Transporte | `transport.*` | `transport.play`, `transport.pause`, `transport.stop`, `transport.seek` |
| Track | `track.*` | `track.create`, `track.delete`, `track.rename`, `track.get` |
| Clip | `clip.*` | `clip.create`, `clip.move`, `clip.split`, `clip.delete` |
| Plugin | `plugin.*` | `plugin.load`, `plugin.unload`, `plugin.getParameter`, `plugin.setParameter` |
| Automatización | `automation.*` | `automation.create`, `automation.addPoint`, `automation.remove` |
| Mixer | `mixer.*` | `mixer.getState`, `mixer.setVolume`, `mixer.setPan`, `mixer.mute`, `mixer.solo` |
| Routing | `routing.*` | `routing.createBus`, `routing.createSend`, `routing.removeRoute` |
| MIDI | `midi.*` | `midi.createNote`, `midi.deleteNote`, `midi.modifyNote`, `midi.getEvents` |
| Análisis | `analysis.*` | `analysis.getPeak`, `analysis.getRMS`, `analysis.getLUFS`, `analysis.getSpectrum` |
| Render | `render.*` | `render.start`, `render.cancel`, `render.getStatus` |

## 4. Niveles de Riesgo y Mapeo de Permisos

| Nivel de Riesgo | Descripción | Permiso Requerido |
|-----------------|-------------|-------------------|
| `read` | Solo consulta. Sin efectos secundarios. | Todos los niveles |
| `write` | Modifica el estado del proyecto. | `CONFIRM` y superiores |
| `dangerous` | Potencialmente destructivo o irreversible. | `AUTO_EXECUTE_SAFE` (con confirmación) o `FULL_AUTONOMY` |

## 5. Registro de Herramientas

```typescript
interface ToolRegistry {
  register(tool: ToolDefinition, handler: ToolHandler): void;
  unregister(name: string): void;
  get(name: string): ToolDefinition | undefined;
  list(category?: string, risk?: RiskLevel): ToolDefinition[];
  search(query: string): ToolDefinition[];
  getAllDescriptions(): string; // fragmento de prompt agregado
}

type ToolHandler = (params: unknown, ctx: ToolContext) => Promise<ToolResult>;

interface ToolContext {
  commandExecutor: CommandExecutor;
  query: DAWQuery;
  userPermissionLevel: PermissionLevel;
  projectId: string;
}
```

## 6. Ciclo de Vida de Ejecución de Herramientas

```
Proveedor de IA
    │
    ▼
AI Harness
    │
    ├──► Verificación de Permisos
    ├──► Validación de Parámetros (contra schema ToolDefinition)
    ├──► Handler de Herramienta
    │       │
    │       └──► CommandExecutor.execute()
    │               │
    │               └──► Capa de Dominio
    │                       │
    │                       └──► Bus de Eventos
    │
    ▼
ToolResult
```

```typescript
interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: ToolError;
  events: DomainEvent[]; // eventos emitidos durante la ejecución
  confirmationRequired?: boolean; // si el usuario debe aprobar
}

interface ToolError {
  code: string;
  message: string;
  details?: unknown;
}
```

## 7. Idempotencia

Las herramientas marcadas `idempotent: true` se pueden reintentar de forma segura. Por ejemplo, `track.get` es idempotente; `clip.create` puede no serlo si genera un ID único cada vez. Los proveedores de IA deben usar la idempotencia para realizar reintentos seguros.

## 8. Descubrimiento Dinámico

El Registro de Herramientas es **dinámico**. Los plugins pueden registrar nuevas herramientas en runtime:

```typescript
// Ejemplo: un plugin de metrónomo registra una nueva herramienta
toolRegistry.register({
  name: "metronome.start",
  description: "Iniciar el metrónomo",
  category: "transport",
  risk: "write",
  parameters: [{ name: "bpm", type: "number", required: true }],
  returns: { type: "boolean" }
}, async (params) => {
  // implementación
});
```

El `CapabilityRegistry` expone todas las herramientas registradas al proveedor de IA mediante `getCapabilities()`.

## 9. Ejemplos

```typescript
// Herramienta de LECTURA
toolRegistry.register({
  name: "track.get",
  description: "Obtener detalles de un track por ID",
  category: "track",
  risk: "read",
  parameters: [
    { name: "trackId", type: "string", required: true }
  ],
  returns: { type: "object", schema: TrackSchema }
}, async ({ trackId }, ctx) => {
  return { success: true, data: ctx.query.getTrack(trackId) };
});

// Herramienta de ESCRITURA
toolRegistry.register({
  name: "track.volume.set",
  description: "Establecer el volumen de un track en dB",
  category: "track",
  risk: "write",
  parameters: [
    { name: "trackId", type: "string", required: true },
    { name: "dB", type: "number", required: true, min: -60, max: 12 }
  ],
  returns: { type: "object" }
}, async ({ trackId, dB }, ctx) => {
  return ctx.commandExecutor.execute("track.volume.set", { trackId, dB });
});

// Herramienta PELIGROSA
toolRegistry.register({
  name: "project.delete",
  description: "Eliminar todo el proyecto sin recuperación",
  category: "project",
  risk: "dangerous",
  parameters: [
    { name: "projectId", type: "string", required: true },
    { name: "confirm", type: "boolean", required: true }
  ],
  returns: { type: "boolean" }
}, async ({ projectId, confirm }, ctx) => {
  if (!confirm) return { success: false, error: { code: "CONFIRMATION_REQUIRED", message: "Debe confirmar" } };
  return ctx.commandExecutor.execute("project.delete", { projectId });
});
```

## 10. Documentación de Herramientas para IA

El proveedor de IA recibe una representación compacta de las herramientas para inyección de prompt:

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

Este fragmento se inyecta en el system prompt. Se regenera cada vez que el Registro de Herramientas cambia.
