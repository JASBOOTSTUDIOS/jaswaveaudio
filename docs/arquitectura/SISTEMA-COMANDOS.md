# Sistema de Comandos

## 1. Propósito

El Sistema de Comandos es el **punto de entrada único para todas las mutaciones de estado**. Las acciones de UI, atajos de teclado, macros, scripts y llamadas de herramientas de IA ejecutan todas a través de este sistema. Proporciona:

- Registro y descubrimiento de comandos
- Ejecución con hooks de validación
- Gestión de pila de undo/redo
- Composición de macros
- Registro de auditoría

## 2. Interfaces Core

```typescript
interface Command<TPayload = unknown, TResult = unknown> {
  id: string;
  type: string;
  description: string;
  payload: TPayload;
  risk: RiskLevel;
  validate?(state: DAWState): ValidationResult;
  execute(state: DAWState): StateTransition;
  inverse?: Command; // para undo
}

type RiskLevel = 'read' | 'write' | 'dangerous';

interface StateTransition {
  state: DAWState;
  events: DomainEvent[];
  result: TResult;
}
```

## 3. Registro de Comandos

```typescript
interface CommandRegistry {
  register<T>(cmd: CommandDefinition<T>): void;
  unregister(type: string): void;
  get(type: string): CommandDefinition | undefined;
  list(): CommandDefinition[];
  listByRisk(risk: RiskLevel): CommandDefinition[];
}

interface CommandDefinition<T = unknown> {
  type: string;
  description: string;
  risk: RiskLevel;
  schema: JSONSchema; // schema Zod o equivalente
  inverseType?: string;
  handler: (state: DAWState, payload: T) => StateTransition;
}
```

## 4. Pipeline de Ejecución

```typescript
interface CommandExecutor {
  execute<T>(type: string, payload: unknown): CommandResult<T>;
  undo(): CommandResult | null;
  redo(): CommandResult | null;
  canUndo(): boolean;
  canRedo(): boolean;
  getHistory(): CommandHistoryEntry[];
  batch(commands: Command[]): TransactionResult;
}

interface CommandResult<T = unknown> {
  success: boolean;
  state: DAWState;
  events: DomainEvent[];
  result?: T;
  error?: CommandError;
}
```

Orden de ejecución:
1. Buscar definición del comando
2. Validar payload contra schema
3. Validar contra estado actual (si el comando tiene `validate`)
4. Ejecutar handler
5. Emitir eventos resultantes
6. Push comando inverso a pila de undo
7. Devolver resultado

## 5. Undo/Redo

La pila de undo/redo almacena **comandos inversos**, no snapshots de estado:

```typescript
interface UndoRedoStack {
  undoStack: Command[];
  redoStack: Command[];
  maxSize: number;
}
```

- **Undo**: Extrae de `undoStack`, ejecuta el inverso, push el inverso del inverso a `redoStack`.
- **Redo**: Extrae de `redoStack`, ejecuta el comando, push el inverso a `undoStack`.
- **Tamaño máximo**: 1000 comandos (configurable).
- **Límite de undo**: Un comando puede declarar `undoBoundary: true`. Después de ejecutarse, se limpia la pila de redo. Se usa para acciones "mayores" como guardar o renderizar.

## 6. Macros

Las macros son secuencias nombradas de comandos:

```typescript
interface Macro {
  id: string;
  name: string;
  commands: string[]; // nombres de tipos de comando con plantillas de parámetros opcionales
  parameters?: Record<string, unknown>;
}
```

Las macros se ejecutan mediante `CommandExecutor.batch()`. Si algún comando falla, toda la macro se revierte (ver `TRANSACCIONES.md`).

## 7. Scripts

Los scripts extienden el sistema de comandos con lógica custom. Un script es un módulo sandboxeado que recibe una `ScriptAPI`:

```typescript
interface ScriptAPI {
  executeCommand(type: string, payload: unknown): Promise<CommandResult>;
  getState(): DAWState;
  subscribe(event: string, handler: Function): Subscription;
  log(message: string): void;
}
```

Los scripts se ejecutan en un **worker thread** sin acceso a DOM ni acceso a `fs` de Node.js a menos que se otorgue explícitamente.

## 8. Integración con IA

Las llamadas de herramientas de la IA se traducen a comandos:

```typescript
// IA solicita: setTrackVolume({ trackId: "abc", dB: -2 })
// Se convierte en: Command { type: "track.volume.set", payload: { trackId: "abc", dB: -2 } }
// Se ejecuta mediante: commandExecutor.execute("track.volume.set", { trackId: "abc", dB: -2 })
```

La IA nunca llama a `execute()` directamente en la capa de dominio. Solo llama a herramientas, que se traducen a comandos.

## 9. Bindings de Teclado

Los atajos de teclado se mapean a comandos:

```typescript
interface KeyBinding {
  key: string;
  modifiers: KeyModifier[];
  command: string;
  context: string; // ej: "timeline", "mixer", "global"
}
```

Los bindings de teclado forman parte de `ProjectState.metadata` y se serializan con el proyecto.

## 10. Registro de Auditoría

Cada ejecución de comando se registra:

```typescript
interface CommandLogEntry {
  id: string;
  timestamp: number;
  commandType: string;
  payload: JSONValue;
  source: 'user' | 'macro' | 'script' | 'ai';
  userId?: string;
  result: 'success' | 'failure';
  error?: string;
}
```

El registro de auditoría es **operacional**, no memoria de IA. Nunca se promueve automáticamente a memoria a largo plazo.
