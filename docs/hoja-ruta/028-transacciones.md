# Transacciones

## Objetivo
Implementar el TransactionManager para operaciones multi-paso atómicas con rollback. Las transacciones garantizan que un conjunto de comandos se ejecutan todos o ninguno.

## Criterios de Aceptación
- [ ] TransactionManager con rollback
- [ ] Las operaciones complejas son atómicas
- [ ] Integración con Undo/Redo
- [ ] Manejo de fallos robusto

## Requerimientos Detallados

### 1. TransactionManager
Definir `TransactionManager`:
- `begin(description: string): Transaction`
- `addCommand(tx: Transaction, cmd: CommandPayload): void`
- `commit(tx: Transaction): Promise<TransactionResult>`
- `rollback(tx: Transaction): Promise<TransactionResult>`

### 2. Transaction
Definir `Transaction`:
- `id: string`
- `commands: Command[]`
- `description: string`
- `createdAt: number`
- `status: 'pending' | 'executing' | 'committed' | 'rolledBack' | 'failed'`

### 3. TransactionResult
Definir `TransactionResult`:
- `transactionId: string`
- `status: 'committed' | 'rolledBack'`
- `executedCommands: string[]` — IDs de comandos ejecutados exitosamente.
- `rolledBackCommands: string[]` — IDs de comandos revertidos.
- `error?: TransactionError`

### 4. TransactionError
Definir `TransactionError`:
- `code: 'VALIDATION_FAILED' | 'PERMISSION_DENIED' | 'EXECUTION_ERROR' | 'ROLLBACK_FAILED'`
- `message: string`
- `commandIndex: number` — qué comando en la secuencia falló.
- `originalError?: unknown`

### 5. Ejecución Atómica
Pasos:
1. Bloquear estado del proyecto para escritura.
2. Ejecutar comandos secuencialmente en orden.
3. Después de cada comando, push su inverso a la pila de rollback de la transacción.
4. Si todos los comandos tienen éxito:
   - Commit: estado se finaliza, se emiten eventos.
5. Si algún comando falla:
   - Rollback: ejecutar todos los inversos en orden inverso.
   - Emitir eventos de rollback.
   - Restaurar estado original.

### 6. Rollback
- Rollback es **todo o nada**.
- Si paso 3 de 5 falla, los pasos 1-2 se revierten junto con 3-5.
- Si el rollback falla (`ROLLBACK_FAILED`):
  - Error crítico.
  - Estado puede ser inconsistente.
  - Se registra y se muestra al usuario inmediatamente.

### 7. Integración con Command System
- Desde la perspectiva del Command System, una transacción confirmada es una serie de ejecuciones de comandos.
- La pila de Undo/Redo trata cada comando individualmente.
- Si se quiere deshacer toda la transacción como una sola acción:
  - Usar macro con `undoBoundary: true`.

### 8. Async Transactions
- Transacciones de larga duración (renderizado, E/S):
  - `AsyncTransaction`:
    - `id: string`
    - `status: 'pending' | 'running' | 'completed' | 'failed'`
    - `progress?: number` (0-100)
    - `result?: TransactionResult`
- Event Bus emite: `transaction.started`, `transaction.progress`, `transaction.completed`, `transaction.failed`.

### 9. Modo de Ejecución IA
- Herramienta única: `CommandExecutor.execute(toolName, params)` — sin transacción.
- Secuencia planificada: `TransactionManager` — multi-paso, atómica.
- El Planner decide qué modo usar según complejidad.

### 10. Tests
- Test: commit ejecuta todos los comandos
- Test: rollback revierte todos los comandos
- Test: fallo en paso 3 revierte pasos 1-2 también
- Test: rollback falla con error crítico
- Test: transacción se integra con undo/redo
- Test: async transaction emite eventos de progreso
- Test: transaction con undo boundary se deshace como una sola acción

## Dependencias
- Command System
- State Model
- Event Bus
- Validation Layer

## Documentación Relacionada
- `docs/arquitectura/TRANSACCIONES.md`
- `docs/arquitectura/SISTEMA-COMANDOS.md`
