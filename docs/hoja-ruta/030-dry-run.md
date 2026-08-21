# Dry Run

## Objetivo
Implementar el modo dry run para que la IA pueda previsualizar acciones sin ejecutarlas. El usuario ve exactamente qué cambiará antes de confirmar.

## Criterios de Aceptación
- [ ] Preview de cambios sin ejecución
- [ ] La IA puede mostrar qué hará antes de commitear
- [ ] StateDiff detallado
- [ ] Integración con Command System

## Requerimientos Detallados

### 1. Dry Run Mode
- Soportar modo dry run en:
  - `CommandExecutor.execute()` — opción `dryRun: true`.
  - `TransactionManager.commit()` — opción `dryRun: true`.
  - `ToolRunner.execute()` — opción `dryRun: true`.
- En dry run:
  - NO se modifica el estado.
  - NO se emiten eventos reales.
  - Se simula la ejecución y se devuelve `StateDiff`.

### 2. StateDiff
Definir `StateDiff`:
- `tracksAdded: Track[]`
- `tracksRemoved: string[]`
- `tracksModified: Track[]`
- `clipsAdded: AudioClip[]`
- `clipsRemoved: string[]`
- `clipsMoved: { clipId: string, oldStart: number, newStart: number }[]`
- `pluginsLoaded: PluginInstance[]`
- `pluginsUnloaded: string[]`
- `volumeChanges: { trackId: string, oldDb: number, newDb: number }[]`
- `panChanges: { trackId: string, oldPan: number, newPan: number }[]`
- `muteChanges: { trackId: string, oldMuted: boolean, newMuted: boolean }[]`
- `automationAdded: AutomationLane[]`
- `automationRemoved: string[]`

### 3. Validación de Dry Run
- El dry run pasa por la misma pipeline de validación que la ejecución real.
- Si la validación falla, el dry run devuelve errores sin ejecutar nada.
- Si la validación pasa, el dry run devuelve el StateDiff simulado.

### 4. Integración con IA
- La IA solicita dry run antes de ejecutar operaciones complejas.
- Flujo:
  1. IA genera plan de ejecución.
  2. IA solicita dry run al sistema.
  3. Sistema devuelve StateDiff.
  4. IA presenta resumen al usuario.
  5. Usuario confirma o cancela.
  6. Si confirma, se ejecuta la operación real.

### 5. UI
- Mostrar preview de cambios en panel de chat o modal.
- Resaltar:
  - Tracks nuevas (verde).
  - Tracks eliminadas (rojo).
  - Cambios de volumen (naranja).
  - Plugins cargados (azul).
- Mostrar número total de cambios.

### 6. Transaction Dry Run
- Para transacciones multi-paso:
  - Simular todos los pasos secuencialmente.
  - Acumular StateDiff de todos los pasos.
  - Si algún paso falla, devolver error en ese paso.
- El dry run de transacción no hace rollback porque no modifica estado.

### 7. Tests
- Test: dry run no modifica el estado
- Test: dry run devuelve StateDiff correcto
- Test: dry run detecta errores de validación
- Test: dry run de transacción acumula cambios
- Test: dry run se integra con chat de IA
- Test: StateDiff incluye todos los cambios relevantes

## Dependencias
- Command System
- Transaction Manager
- Validation Layer
- State Model

## Documentación Relacionada
- `docs/arquitectura/TRANSACCIONES.md`
- `docs/arquitectura/VALIDACION.md`
