# Macros

## Objetivo
Implementar el sistema de macros: definir, grabar, ejecutar y editar secuencias de comandos para automatizar tareas repetitivas.

## Criterios de Aceptación
- [ ] Definir y ejecutar macros de comandos
- [ ] Las macros se pueden grabar y reproducir
- [ ] Compartir macros entre proyectos
- [ ] Integración con Command System

## Requerimientos Detallados

### 1. Macro
Definir `Macro`:
- `id: string`
- `name: string`
- `description: string`
- `commands: MacroCommand[]`
- `createdAt: number`
- `updatedAt: number`
- `author?: string`

`MacroCommand`:
- `type: string` — tipo de comando.
- `payload: unknown` — parámetros del comando.
- `delay?: number` — ms de espera antes de ejecutar.

### 2. Comandos
- `macro.create`:
  - Payload: `name`, `description?`, `commands[]`.
  - Validar que todos los comandos existen en el registry.
  - Guardar macro en el proyecto.
  - Emitir `macro.created`.
- `macro.update`:
  - Payload: `macroId`, `commands[]?`, `name?`.
  - Actualizar macro.
  - Emitir `macro.updated`.
- `macro.delete`:
  - Payload: `macroId`.
  - Eliminar macro.
  - Emitir `macro.deleted`.
- `macro.execute`:
  - Payload: `macroId`.
  - Ejecutar todos los comandos secuencialmente.
  - Si un comando falla, detener ejecución.
  - Emitir `macro.executed`.

### 3. Grabación
- `macro.record`:
  - Iniciar grabación de macro.
  - Capturar todos los comandos ejecutados por el usuario.
  - Al detener, crear macro con comandos capturados.
- Durante grabación:
  - Mostrar indicador de grabación en UI.
  - Ignorar comandos internos (solo comandos de usuario).
  - Permitir agregar delays entre comandos.

### 4. Ejecución
- Las macros se ejecutan mediante `CommandExecutor.batch()`.
- Si un comando falla, la macro se detiene (no rollback automático, a menos que se envuelva en transacción).
- El usuario puede elegir ejecutar macro como transacción con rollback.

### 5. Compartir
- Las macros se serializan en `ProjectState.metadata`.
- Se pueden exportar/importar como JSON.
- Formato de exportación:
  - `{ name, description, commands: [{ type, payload }] }`

### 6. UI
- Macro Manager: lista de macros con botones ejecutar, editar, eliminar.
- Grabación con botón grabar/detener.
- Asignación de key bindings a macros.
- Ejecutar macro desde Command Palette.

### 7. Tests
- Test: crear macro guarda comandos correctamente
- Test: ejecutar macro ejecuta todos los comandos
- Test: fallo en comando detiene macro
- Test: grabar macro captura comandos del usuario
- Test: export/import macro funciona
- Test: macro se ejecuta desde Command Palette
- Test: key binding ejecuta macro

## Dependencias
- Command System
- State Model
- Event Bus

## Documentación Relacionada
- `docs/arquitectura/SISTEMA-OMANDOS.md`
- `docs/arquitectura/TRANSACCIONES.md`
