# Undo/Redo

## Objetivo
Implementar la pila de undo/redo funcional para todas las operaciones del DAW. El usuario y la IA comparten la misma pila; no hay sistemas separados.

## Criterios de Aceptación
- [ ] Pila funcional para todas las operaciones
- [ ] Se puede deshacer/rehacer cualquier acción
- [ ] Límite de pila configurable
- [ ] Undo boundaries funcionan

## Requerimientos Detallados

### 1. Principio
- Toda operación modificable debe pasar por el Command System.
- El undo/redo NO almacena snapshots del estado; almacena comandos inversos.
- La pila es compartida: acciones de usuario, macros, scripts e IA usan la misma pila.
- No crear sistema separado para IA.

### 2. UndoRedoStack
Implementar `UndoRedoStack`:
- `undoStack: Command[]` — comandos ejecutados, listos para undo.
- `redoStack: Command[]` — comandos deshechos, listos para redo.
- `maxSize: number` — default 1000, configurable.
- `push(command: Command): void` — agrega comando a undo stack, limpia redo stack.
- `popUndo(): Command | null` — extrae último comando de undo stack.
- `popRedo(): Command | null` — extrae último comando de redo stack.
- `canUndo(): boolean`
- `canRedo(): boolean`
- `clear(): void`

### 3. Flujo de Undo
1. Usuario presiona Ctrl+Z o selecciona "Undo".
2. `CommandExecutor.undo()`:
   - Pop de `undoStack` obtiene comando `C`.
   - Ejecutar `C.inverse` (el comando inverso).
   - Push de `C.inverse` a `redoStack`.
   - Emitir eventos del comando inverso.
3. Estado restaurado al estado anterior.

### 4. Flujo de Redo
1. Usuario presiona Ctrl+Y o Ctrl+Shift+Z o selecciona "Redo".
2. `CommandExecutor.redo()`:
   - Pop de `redoStack` obtiene comando `C`.
   - Ejecutar `C` (el comando original).
   - Push de `C.inverse` a `undoStack`.
   - Emitir eventos del comando.
3. Estado avanza al estado siguiente.

### 5. Undo Boundary
- Un comando puede declarar `undoBoundary: true`.
- Después de ejecutar un comando con boundary, se limpia `redoStack`.
- Usado para acciones "mayores" como:
  - Guardar proyecto
  - Renderizar
  - Cerrar proyecto
- El boundary evita que el usuario haga redo de operaciones antiguas después de una acción mayor.

### 6. Comandos Irreversibles
- Si un comando no tiene `inverse`, no se puede deshacer.
- Ejemplos: `project.delete`, `renderProject` (si no se guarda estado intermedio).
- El Command System debe marcar estos comandos claramente.
- UI debe mostrar indicador cuando no hay acciones para deshacer.

### 7. Integración con Transacciones
- Una transacción confirmada genera múltiples comandos en el undo stack.
- Cada comando se deshace individualmente.
- Si se quiere deshacer toda la transacción como una sola acción, usar macro con `undoBoundary: true`.
- Ver `docs/arquitectura/TRANSACCIONES.md`.

### 8. Keyboard Bindings
- Atajos por defecto:
  - `Ctrl+Z` / `Cmd+Z` — undo
  - `Ctrl+Y` / `Cmd+Shift+Z` — redo
  - `Ctrl+Shift+Z` — redo alternativo
- Los bindings son configurables y se serializan en `ProjectState.metadata`.

### 9. UI Feedback
- Status bar muestra última acción disponible para undo/redo.
- Menú Edit muestra:
  - Undo [nombre del comando]
  - Redo [nombre del comando]
- Deshabilitar botones cuando no hay acciones disponibles.

### 10. Tests
- Test: ejecutar comando lo agrega a undo stack
- Test: undo ejecuta inverso y lo mueve a redo stack
- Test: redo ejecuta original y lo mueve a undo stack
- Test: nuevo comando después de undo limpia redo stack
- Test: comando irreversible no se agrega a undo stack
- Test: undo boundary limpia redo stack
- Test: maxSize respeta límite (FIFO)
- Test: batch opera correctamente con undo/redo

## Dependencias
- State Model
- Command System
- Event Bus

## Documentación Relacionada
- `docs/arquitectura/SISTEMA-COMANDOS.md`
- `docs/arquitectura/TRANSACCIONES.md`
- `docs/arquitectura/VISION-GENERAL.md`
