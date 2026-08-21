# Command System

## Objetivo
Implementar el registro, ejecución y reversión de comandos como único camino de mutación del estado. Toda operación modificable —venga de UI, teclado, macros, scripts o IA— debe pasar por aquí.

## Criterios de Aceptación
- [x] Registry funcional
- [x] Ejecución con validación de schema
- [x] Undo/Redo stack por comandos inversos
- [x] Macros y batch soportados
- [x] Audit log

## Requerimientos Detallados

### 1. Interfaz de Comando
- Definir `Command` (wrapper de runtime, no genérico):
  - `id: string` — único por ejecución
  - `nombre: string` — tipo del comando (ej: `track.create`)
  - `descripcion: string`
  - `categoria: string`
  - `ejecutar(estado: DAWState): DAWState`
  - `deshacer(estado: DAWState): DAWState`
  - `rehacer(estado: DAWState): DAWState`
  - `inverso: Command | null` — comando inverso para undo
  - `irreversible: boolean`
  - `fechaCreacion: number`
- `StateTransition<TResult>` debe contener:
  - `state: DAWState` — nuevo estado resultante
  - `events: DomainEvent[]` — eventos emitidos por este comando
  - `result: TResult` — resultado de la operación
  - `inversePayload?: unknown` — payload para el comando inverso

**Estado**: ✅ Completado
**Archivos**: `shared/src/types/command.ts`

### 2. Definición de Comando
- Definir `CommandDefinition<T>` (genérico):
  - `type: string`
  - `description: string`
  - `risk: RiskLevel`
  - `schema?: Record<string, unknown>` — schema JSON del payload (opcional; si existe, se valida en el pipeline)
  - `inverseType?: string` — tipo del comando inverso
  - `handler: (state: DAWState, payload: T) => StateTransition<T> | Promise<StateTransition<T>>`
  - `validate?: (state: DAWState, payload: T) => ValidationResult` — validación custom adicional
- Los comandos se registran en el `CommandRegistry` por tipo.

**Estado**: ✅ Completado
**Archivos**: `shared/src/types/command.ts`

### 3. Registry
- Definir `CommandRegistry`:
  - `register<T>(cmd: CommandDefinition<T>): void`
  - `unregister(type: string): void`
  - `get(type: string): CommandDefinition | undefined`
  - `list(): CommandDefinition[]`
  - `listByRisk(risk: RiskLevel): CommandDefinition[]`
- El registry debe ser global y singleton accesible desde cualquier módulo.

**Estado**: ✅ Completado
**Archivos**: `shared/src/state/registro-comandos.ts`

### 4. Executor
- Definir `CommandExecutor`:
  - `execute<T>(type: string, payload: unknown): Promise<CommandResult<T>>`
  - `undo(): Promise<CommandResult | null>`
  - `redo(): Promise<CommandResult | null>`
  - `canUndo(): boolean`
  - `canRedo(): boolean`
  - `getHistory(): CommandHistoryEntry[]`
  - `batch(commands: CommandPayload[]): Promise<TransactionResult>`
- `CommandResult<T>`:
  - `success: boolean`
  - `state: DAWState`
  - `events: DomainEvent[]`
  - `result?: T`
  - `error?: CommandError`

**Estado**: ✅ Completado
**Archivos**: `shared/src/state/ejecutor-comandos.ts`

### 5. Pipeline de Ejecución
El orden estricto de ejecución es:
1. Lookup de definición del comando por tipo.
2. Ejecución de pipeline de validación completa:
   - **Schema check** — valida payload contra `CommandDefinition.schema` si existe (required, types, additionalProperties)
   - Auth check (warning temporal si falta `userId`)
   - Permission check
   - Domain rules
   - Conflict checks
   - AI-specific checks
3. Validación específica del comando (`CommandDefinition.validate`).
4. Validación de estado integral (`validarEstado`).
5. Ejecución del handler.
6. Emisión de eventos resultantes en el Event Bus.
7. Push del comando inverso a la pila de undo.
8. Devolver resultado.

Si cualquier paso falla, no se ejecutan pasos posteriores y el estado no cambia.
Los warnings no bloquean la ejecución, pero se emiten como eventos.

**Estado**: ✅ Completado
**Archivos**: `shared/src/state/ejecutor-comandos.ts`, `shared/src/state/pipeline-validacion.ts`

### 6. Undo/Redo Stack
- Implementar `UndoRedoStack`:
  - `undoStack: Command[]`
  - `redoStack: Command[]`
  - `maxSize: number` — default 1000
- **Undo**: pop de `undoStack`, ejecutar inverso, push a `redoStack`.
- **Redo**: pop de `redoStack`, ejecutar comando, push a `undoStack`.
- **Undo boundary**: después de una acción mayor (save, render, etc.), limpiar `redoStack` mediante `CommandExecutor.marcarBoundary()`. Evita redo after boundary, que sería inválido.

**Estado**: ✅ Completado
**Archivos**: `shared/src/state/pila-deshacer-rehacer.ts`, `shared/src/state/ejecutor-comandos.ts`

### 7. Macros
- Definir `Macro`:
  - `id: string`
  - `name: string`
  - `commands: string[]` — nombres de tipos con plantillas de parámetros
  - `parameters?: Record<string, unknown>`
- Las macros se ejecutan mediante `CommandExecutor.batch()`.
- Si cualquier comando falla, toda la macro se revierte (ver `docs/arquitectura/TRANSACCIONES.md`).

**Estado**: ✅ Completado
**Archivos**: `shared/src/state/macros.ts`

### 8. Scripts
- Definir `ScriptAPI` para scripts sandboxeados:
  - `executeCommand(type: string, payload: unknown): Promise<CommandResult>`
  - `getState(): DAWState`
  - `subscribe(event: string, handler: Function): { cancelarSuscripcion: () => void }`
  - `log(message: string): void`
- Los scripts se ejecutan en un entorno sandboxeado controlado por el runtime.
- **Nota**: La opción `permitirFS` del sandbox está declarada pero no se verifica en la implementación actual.

**Estado**: ✅ Completado
**Archivos**: `shared/src/state/api-scripts.ts`

### 9. Integración con IA
- Las tool calls de IA se traducen a comandos:
  - IA solicita: `setTrackVolume({ trackId: "abc", dB: -2 })`
  - Se convierte en: `Command { type: "track.volume.set", payload: { trackId: "abc", dB: -2 } }`
  - Se ejecuta: `commandExecutor.execute("track.volume.set", { trackId: "abc", dB: -2 })`
- La IA nunca llama a `execute()` directamente en la capa de dominio.

**Estado**: ✅ Completado
**Archivos**: `shared/src/state/ejecutor-comandos.ts`

### 10. Key Bindings
- Los atajos de teclado se mapean a comandos:
  - `KeyBinding`: key, modifiers[], command, context
- `KeyBinding` type existe en `command.ts` y `ProjectMetadata.keyBindings?: KeyBinding[]` existe en `metadata.ts`, pero **no se usa en la práctica**.
- Los atajos funcionales viven en `DAWState.atajos: { mapa, porDefecto }` y se persisten como parte del estado.

**Estado**: ✅ Completado
**Archivos**: `shared/src/types/command.ts`

### 11. Audit Log
- Cada ejecución de comando se registra en `CommandLogEntry`:
  - `id, timestamp, commandType, payload, source ('user' | 'macro' | 'script' | 'ai'), userId?, result ('success' | 'failure'), error?`
- El log es operacional, no memoria de IA. Nunca se promueve automáticamente.

**Estado**: ✅ Completado
**Archivos**: `shared/src/state/registro-auditoria.ts`

### 12. Tests
- [x] Test: execute con payload válido produce nuevo estado y eventos
- [x] Test: execute con schema inválido falla
- [x] Test: undo y redo restauran estado correctamente
- [x] Test: batch ejecuta todos o revierte todos
- [x] Test: macro se puede registrar y ejecutar
- [x] Test: audit log registra todas las ejecuciones
- [x] Test: undo boundary limpia redo stack
- [x] Test: comando irreversible no se agrega a undo stack

**Archivos**: `shared/src/test/command-system.test.ts`
**Cobertura**: 21 tests unitarios cubriendo registry, executor, undo/redo, batch, macros, audit log, boundaries y comandos built-in.

## Dependencias
- State Model
- Event Bus
- Validation Layer

## Documentación Relacionada
- `docs/arquitectura/SISTEMA-COMANDOS.md`
- `docs/arquitectura/VISION-GENERAL.md`
- `docs/00-RESUMEN-ARQUITECTURA.md`

## Implementación Runtime

### 13. Tipos Base
- [x] `Command`, `CommandDefinition`, `StateTransition`, `CommandResult`, `CommandError`, `TransactionResult` en `shared/src/types/command.ts`
- [x] `RiskLevel`, `CommandPayload`, `CommandHistoryEntry`, `CommandRegistry`, `UndoRedoStack`, `Macro`, `CommandLogEntry`, `ScriptAPI`, `KeyBinding`

### 14. Registry
- [x] `crearRegistroComandos()` singleton en `shared/src/state/registro-comandos.ts` con `register`, `unregister`, `get`, `list`, `listByRisk`.

### 15. Undo/Redo Stack
- [x] `crearPilaDeshacerRehacer()` en `shared/src/state/pila-deshacer-rehacer.ts` con `undo`, `redo`, `push`, `limpiarRedo`, `canUndo`, `canRedo` y respeto de `maxSize`.

### 16. Executor
- [x] `CommandExecutor` en `shared/src/state/ejecutor-comandos.ts` con pipeline completo: lookup, validación, ejecución, emisión de eventos, push a undo stack.
- [x] Soporte de `execute`, `undo`, `redo`, `batch` transaccional, `marcarBoundary` y `getHistory`.

### 17. Macros
- [x] `crearRegistroMacros()` en `shared/src/state/macros.ts` con registro y ejecución transaccional de macros.

### 18. Audit Log
- [x] `crearRegistroAuditoria()` en `shared/src/state/registro-auditoria.ts` con `log`, `list` (con filtros) y `clear`.

### 19. Script API
- [x] `crearApiScripts()` en `shared/src/state/api-scripts.ts` con sandbox limitada: `executeCommand`, `getState`, `subscribe`, `log`.

### 20. Tests
- [x] Tests unitarios en `shared/src/test/command-system.test.ts` — 21 tests cubriendo registry, executor, undo/redo, batch, macros, audit log, boundaries y comandos built-in.
- [x] Total general: **236 tests pasando** (52 event-bus + 12 estado + 21 command-system + 6 validation-layer + 13 ai-provider + 35 project-lifecycle + 16 project + 15 validacion-estado + 12 tool-registry + 11 permissions + 11 memory-manager + 12 context-manager + 12 state-model-alignment + 4 lifecycle-suscripciones + 4 consulta + 4 macros).
