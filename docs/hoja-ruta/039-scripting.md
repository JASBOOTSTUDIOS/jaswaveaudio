# Scripting

## Objetivo
Implementar la API de scripts sandboxeados para extender el DAW. Los scripts pueden automatizar tareas, crear herramientas personalizadas y modificar el comportamiento del DAW.

## Criterios de Aceptación
- [ ] API de scripts sandboxeados
- [ ] Los scripts pueden extender el DAW
- [ ] Seguridad: acceso limitado
- [ ] Ejemplos de scripts útiles

## Requerimientos Detallados

### 1. ScriptAPI
Definir `ScriptAPI` (exposed al script):
- `executeCommand(type: string, payload: unknown): Promise<CommandResult>` — ejecutar comando.
- `getState(): DAWState` — obtener estado actual (solo lectura).
- `subscribe(event: string, handler: Function): Subscription` — suscribirse a eventos.
- `log(message: string): void` — logging.
- `createTool(definition: ToolDefinition, handler: ToolHandler): void` — registrar herramienta.

### 2. Sandbox
- Los scripts se ejecutan en un worker thread aislado.
- Sin acceso a DOM.
- Sin acceso a Node.js `fs`, `child_process`, `net` a menos que se conceda explícitamente.
- Sin acceso al Native Bridge directamente.
- Timeout de ejecución: 30 segundos por defecto.
- Límite de memoria por script.

### 3. Permisos de Script
- `ScriptPermission`:
  - `readState` — puede leer el estado.
  - `executeCommands` — puede ejecutar comandos.
  - `registerTools` — puede registrar herramientas.
  - `subscribeEvents` — puede suscribirse a eventos.
  - `fileSystem` — acceso a sistema de archivos (denegado por defecto).
  - `network` — acceso a red (denegado por defecto).
- El usuario concede permisos por script al instalarlo.

### 4. Ciclo de Vida
1. Usuario instala script (archivo `.js`/`.ts` o bundle).
2. Se valida el script (schema, permisos).
3. Se carga en sandbox.
4. El script se ejecuta o queda disponible para invocación.
5. El usuario puede habilitar/deshabilitar scripts.
6. Al desinstalar, se limpian herramientas y suscripciones registradas.

### 5. Herramientas Personalizadas
- Un script puede registrar herramientas personalizadas:
  - `script.registerTool({ name: 'my.custom.tool', ... }, handler)`
  - La herramienta aparece en el Tool Registry.
  - La IA puede ejecutarla.
- Ejemplo: un script que implementa `metronome.start` usando comandos existentes.

### 6. Eventos
- Los scripts pueden suscribirse a eventos del Event Bus.
- Ejemplo: un script que escucha `track.created` y aplica un preset automáticamente.
- Las suscripciones se limpian al desinstalar el script.

### 7. Ejemplos de Scripts
- **Auto-rename**: renombrar tracks según patrones.
- **Auto-color**: asignar colores según tipo de track.
- **Auto-save**: guardar proyecto automáticamente cada N minutos.
- **Custom metronome**: implementar metrónomo con sonido personalizado.
- **Batch export**: exportar múltiples regiones automáticamente.

### 8. Seguridad
- No permitir scripts sin firma en modo producción.
- Cuarentena para scripts nuevos.
- Logging de todas las acciones de scripts.
- El usuario puede revocar permisos en cualquier momento.

### 9. Tests
- Test: script en sandbox puede ejecutar comando permitido
- Test: script sin permisos no accede a fs
- Test: script puede registrar herramienta
- Test: script se suscribe a eventos
- Test: timeout detiene script largo
- Test: desinstalar limpia suscripciones
- Test: script malicioso es bloqueado

## Dependencias
- Command System
- Event Bus
- Tool Registry
- State Model

## Documentación Relacionada
- `docs/arquitectura/SISTEMA-COMANDOS.md`
- `docs/arquitectura/VISION-GENERAL.md`
