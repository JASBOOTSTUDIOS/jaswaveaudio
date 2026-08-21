# Transacciones

## 1. Propósito

Una Transacción agrupa múltiples comandos en una operación atómica con capacidad de rollback. Esto permite que la IA proponga operaciones multi-paso (ej: "crear track vocal, cargar compresor, establecer threshold a -20dB") como una sola unidad.

## 2. Interfaz Core

```typescript
interface Transaction {
  id: string;
  commands: Command[];
  description: string;
  createdAt: number;
  status: 'pending' | 'executing' | 'committed' | 'rolledBack' | 'failed';
}

interface TransactionResult {
  transactionId: string;
  status: 'committed' | 'rolledBack';
  executedCommands: string[]; // IDs de comandos ejecutados exitosamente
  rolledBackCommands: string[]; // IDs de comandos revertidos
  error?: TransactionError;
}
```

## 3. Modelo de Ejecución

```typescript
interface TransactionManager {
  begin(description: string): Transaction;
  addCommand(tx: Transaction, cmd: Command): void;
  commit(tx: Transaction): Promise<TransactionResult>;
  rollback(tx: Transaction): Promise<TransactionResult>;
}
```

**Pasos de ejecución:**
1. Bloquear estado del proyecto para escritura.
2. Ejecutar comandos secuencialmente en orden.
3. Después de cada comando, push su inverso a la pila de rollback de la transacción.
4. Si todos los comandos tienen éxito, commit: el estado se finaliza, se emiten eventos.
5. Si algún comando falla, rollback: ejecutar todos los inversos en orden inverso, emitir eventos de rollback, restaurar estado original.

## 4. Semántica de Rollback

El rollback es **todo o nada** dentro de una transacción:
- El rollback parcial **no** está soportado.
- Si el paso 3 de 5 falla, los pasos 1-2 se revierten junto con los pasos 3-5.
- Esto coincide con la semántica ACID estándar.

```typescript
// Ejemplo
const tx = transactionManager.begin("Configurar cadena vocal");
transactionManager.addCommand(tx, createTrackCommand("Voces"));
transactionManager.addCommand(tx, loadPluginCommand("Voces", "Compresor"));
transactionManager.addCommand(tx, setParameterCommand("Voces", "Compresor", "Threshold", -20));
transactionManager.addCommand(tx, createSendCommand("Voces", "Reverb"));
await transactionManager.commit(tx);
// Si cualquier paso falla, toda la configuración se revierte.
```

## 5. Transacciones Anidadas

Las transacciones anidadas **no están soportadas** para MVP. Si se necesitan más adelante, usar savepoints.

## 6. Integración con el Sistema de Comandos

Una transacción es una **macro** a nivel de infraestructura. Desde la perspectiva del Sistema de Comandos, una transacción confirmada es una serie de ejecuciones de comandos. La pila de Undo/Redo trata cada comando individualmente, no como una unidad de transacción.

```typescript
// Después del commit, la pila de undo contiene:
// 1. inverso(crearTrack)
// 2. inverso(cargarPlugin)
// 3. inverso(establecerParametro)
// 4. inverso(crearSend)
// El usuario puede deshacer pasos individuales o todos ellos.
```

Si se necesita "deshacer toda la operación de IA" como una sola acción, envolverla en una **macro con límite de undo**:

```typescript
const macro = commandRegistry.defineMacro("ai.vocalSetup", {
  commands: ["track.create", "plugin.load", "plugin.setParameter", "routing.createSend"],
  undoBoundary: true // marca esto como una sola unidad deshacible
});
```

## 7. Manejo de Fallos

```typescript
interface TransactionError {
  code: 'VALIDATION_FAILED' | 'PERMISSION_DENIED' | 'EXECUTION_ERROR' | 'ROLLBACK_FAILED';
  message: string;
  commandIndex: number; // qué comando en la secuencia falló
  originalError?: unknown;
}
```

- `ROLLBACK_FAILED` es un error crítico. El estado puede ser inconsistente. Se registra y se muestra al usuario inmediatamente.
- Las transacciones fallidas se registran en el log de auditoría con detalles completos.

## 8. Modo de Ejecución IA

El AI Harness puede ejecutar herramientas en dos modos:
- **Herramienta única**: `CommandExecutor.execute(toolName, params)` — sin transacción.
- **Secuencia planificada**: `TransactionManager` — multi-paso, atómica.

El Planificador decide qué modo usar según la complejidad de la tarea.

## 9. Transacciones de Larga Duración

Las transacciones que involucran renderizado o E/S de archivo pueden ser de larga duración. Estas se rastrean de forma asíncrona:

```typescript
interface AsyncTransaction {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number; // 0-100
  result?: TransactionResult;
}
```

El Bus de Eventos emite `transaction.started`, `transaction.progress`, `transaction.completed`, `transaction.failed`.
