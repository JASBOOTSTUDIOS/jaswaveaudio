# Command Palette

## Objetivo
Implementar la paleta de comandos: búsqueda y ejecución rápida de cualquier comando del DAW mediante texto. Accesible con `Ctrl+Shift+P` o `Cmd+Shift+P`.

## Criterios de Aceptación
- [ ] Búsqueda y ejecución de comandos
- [ ] Accesible con Ctrl+Shift+P
- [ ] Filtrado en tiempo real
- [ ] Ejecución por teclado y mouse

## Requerimientos Detallados

### 1. Apertura/Cierre
- Atajo global: `Ctrl+Shift+P` (Windows/Linux) o `Cmd+Shift+P` (macOS).
- También accesible desde menú o status bar.
- Al abrir: foco en input de búsqueda.
- Al cerrar: restaurar foco al panel activo.

### 2. Búsqueda
- Input de texto con filtrado en tiempo real.
- Buscar sobre:
  - `commandType` (nombre del comando)
  - `description`
  - `category`
- Matching: prefijo, substring, y fuzzy matching opcional.
- Resultados ordenados por relevancia (prefijo > substring > fuzzy).
- Mostrar máximo 20 resultados.

### 3. Ejecución
- Cada resultado muestra:
  - Icono de categoría (si existe)
  - Nombre del comando
  - Descripción
  - Atajo de teclado asociado (si existe)
- Ejecutar con:
  - Enter (teclado)
  - Click (mouse)
  - Arrow keys para navegar resultados.
- Al ejecutar:
  - Cerrar palette.
  - Ejecutar comando mediante `CommandExecutor.execute()`.
  - Si requiere parámetros, mostrar input modal o pasar valores por defecto.
  - Mostrar feedback visual (toast o status bar) del resultado.

### 4. Comandos sin Parámetros
- Comandos como `transport.play`, `transport.stop`, `undo`, `redo` se ejecutan directamente.

### 5. Comandos con Parámetros
- Si el comando requiere parámetros, la palette debe recolectarlos:
  - Input simple para strings y numbers.
  - Select para enums.
  - Confirmación antes de ejecutar.
- Ejemplo: `track.create` → palette pide nombre de track.

### 6. Historial
- Recordar últimos comandos ejecutados.
- Mostrar al abrir palette si no hay búsqueda activa.
- Ordenar por frecuencia de uso.

### 7. Categorías
- Agrupar resultados por categoría si hay múltiples matches.
- Mostrar categoría como encabezado en la lista.

### 8. Accesibilidad
- Navegación completa por teclado (arrow keys, enter, escape).
- ARIA labels para lectores de pantalla.
- Focus trap dentro de la palette mientras está abierta.

### 9. Integración con IA
- La IA puede sugerir comandos para ejecutar:
  - Ejemplo: IA dice "¿Quieres que reproduzca?" → palette muestra `transport.play` como sugerencia.
- Los comandos ejecutados por IA pasan por la misma palette (pero pueden ejecutarse directamente si el usuario lo permite).

### 10. Tests
- Test: abrir palette con atajo funciona
- Test: búsqueda filtra correctamente
- Test: ejecutar comando lo ejecuta correctamente
- Test: comando con parámetros solicita valores
- Test: historial se muestra al abrir
- Test: escape cierra palette
- Test: navegación por teclado funciona

## Dependencias
- Command System
- State Model (para key bindings)

## Documentación Relacionada
- `docs/arquitectura/SISTEMA-COMANDOS.md`
- `docs/interfaz/ARQUITECTURA-UI.md`
