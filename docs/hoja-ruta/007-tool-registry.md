# Tool Registry

## Objetivo
Crear el registro dinámico de herramientas con generación de prompt fragment, descubrimiento y versionado. El Tool Registry es el catálogo que la IA consulta para entender qué acciones puede realizar.

## Criterios de Aceptación
- [x] Registro dinámico
- [x] Generación de prompt fragment
- [x] Búsqueda y filtrado
- [x] Versionado de herramientas

## Requerimientos Detallados

### 1. Interfaz ToolDefinition
Definir `ToolDefinition`:
- `name: string` — formato `dominio.accion[.subAccion]` (ej: `track.volume.set`)
- `description: string` — descripción legible por humanos para el modelo
- `version: string` — semver
- `category: ToolCategory` — project, transport, track, clip, plugin, automation, mixer, routing, midi, analysis, render
- `risk: RiskLevel` — `read | write | dangerous`
- `parameters: ToolParameter[]`
- `returns: ToolReturn`
- `examples?: ToolExample[]`
- `requiresConfirmation?: boolean`
- `idempotent?: boolean`

`ToolParameter`:
- `name: string`
- `type: 'string' | 'number' | 'boolean' | 'array' | 'object'`
- `description: string`
- `required: boolean`
- `default?: unknown`
- `enum?: unknown[]`
- `min?: number`
- `max?: number`

`ToolReturn`:
- `type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'`
- `description: string`
- `schema?: JSONSchema`

`ToolExample`:
- `input: Record<string, unknown>`
- `output: Record<string, unknown>`

### 2. Tool Registry Interface
Definir `ToolRegistry`:
- `register(definition: ToolDefinition, handler: ToolHandler): void`
- `unregister(name: string): void`
- `get(name: string): ToolDefinition | undefined`
- `list(filter?: ToolFilter): ToolDefinition[]`
- `search(query: string): ToolDefinition[]`
- `generatePromptFragment(): string`
- `generateCapabilities(): CapabilityDescriptor[]`
- `onChange(listener: ToolRegistryListener): Subscription`

`ToolFilter`:
- `category?: string`
- `risk?: RiskLevel`
- `tags?: string[]`

### 3. Tool Handler
Definir `ToolHandler` y `ToolContext`:
- `ToolHandler = (params: unknown, ctx: ToolContext) => Promise<ToolResult>`
- `ToolContext`:
  - `commandExecutor: CommandExecutor`
  - `query: DAWQuery`
  - `userPermissionLevel: PermissionLevel`
  - `projectId: string`

`ToolResult`:
- `success: boolean`
- `data?: unknown`
- `error?: ToolError`
- `events: DomainEvent[]`
- `confirmationRequired?: boolean`

`ToolError`:
- `code: string`
- `message: string`
- `details?: unknown`

### 4. Prompt Fragment Generation
- `generatePromptFragment(): string` devuelve texto compacto para inyectar en el system prompt:
  - Lista de herramientas con nombre, descripción, parámetros y riesgo.
  - Ejemplo de formato:
    ```
    - track.get: Obtener detalles de un track por su ID (read)
      Parámetros: trackId (string, required)
    - track.volume.set: Establecer el volumen de un track en dB (write)
      Parámetros: trackId (string, required), dB (number, required, min: -60, max: 12)
    ```
- El fragmento se regenera cada vez que el registro cambia.

### 5. Categorías de Herramientas
Definir constantes por dominio:
- `project.*` — getState, save, new
- `transport.*` — play, pause, stop, seek
- `track.*` — create, delete, rename, get, volume.set, pan.set, mute, solo
- `clip.*` — create, move, split, delete, resize
- `plugin.*` — load, unload, getParameter, setParameter
- `automation.*` — create, addPoint, remove
- `mixer.*` — getState, setVolume, setPan, mute, solo
- `routing.*` — createBus, createSend, removeRoute
- `midi.*` — createNote, deleteNote, modifyNote, getEvents
- `analysis.*` — getPeak, getRMS, getLUFS, getSpectrum
- `render.*` — start, cancel, getStatus

### 6. Niveles de Riesgo y Permisos
- `read` — solo consulta. Todos los niveles de permiso permitidos.
- `write` — modifica estado. Requiere `CONFIRM` o superior.
- `dangerous` — potencialmente destructivo. Requiere `AUTO_EXECUTE_SAFE` con confirmación o `FULL_AUTONOMY`.

### 7. Registro Dinámico
- Los plugins y extensiones pueden registrar herramientas en runtime:
  - Ejemplo: un plugin de metrónomo registra `metronome.start` con parámetro `bpm`.
- Cuando un plugin carga, el sistema registra automáticamente herramientas para:
  - Obtener parámetros
  - Establecer parámetros
  - Cargar presets
  - Obtener latencia
  - Ejecutar análisis (si aplica)

### 8. Versionado y Deprecación
- Las herramientas están versionadas con semver.
- Si el schema cambia, se incrementa la versión.
- Si la IA envía una tool call con versión antigua, se rechaza con error de schema mismatch.
- Herramientas deprecated se marcan en el prompt fragment:
  - `- track.volume.set (deprecated, use track.gain.set)`
- Se eliminan después de 2 releases mayores.

### 9. Idempotencia
- Herramientas marcadas `idempotent: true` pueden reintentarse seguramente.
- Ejemplo: `track.get` es idempotente; `clip.create` puede no serlo si genera ID único.

### 10. Salud del Registro
- Monitorear handlers rotos:
  - `ToolRegistryHealth`: `registeredCount`, `brokenHandlers[]`, `lastUpdated`
- Handlers rotos se deshabilitan automáticamente y se reportan en audit log.

### 11. Tests
- Test: registrar tool la hace disponible en list y search
- Test: unregister la elimina
- Test: generatePromptFragment incluye todas las tools
- Test: plugin puede registrar tool en runtime
- Test: tool con versión antigua es rechazada
- Test: herramienta deprecated aparece marcada
- Test: idempotent flag se respeta
- Test: broken handler se deshabilita automáticamente

## Dependencias
- Command System (los handlers delegan a comandos)
- Validation Layer
- Permissions

## Documentación Relacionada
- `docs/ia/REGISTRO-HERRAMIENTAS.md`
- `docs/arquitectura/VISION-GENERAL.md`
- `docs/00-RESUMEN-ARQUITECTURA.md`
