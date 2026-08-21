# Proyectos

## Objetivo
Implementar el ciclo de vida completo de proyectos: creación, guardado, carga, cierre y persistencia. El proyecto es el contenedor principal de toda la información del DAW.

## Criterios de Aceptación
- [ ] Crear proyectos desde cero
- [ ] Guardar proyectos en disco
- [ ] Cargar proyectos desde disco
- [ ] Cerrar proyectos sin perder cambios no guardados
- [ ] Persistencia correcta sin corrupción

## Requerimientos Detallados

### 1. Creación de Proyecto
- `project.new` comando crea un `ProjectState` con valores por defecto:
  - `id` — generado con `Date.now()` + aleatorio (no UUID)
  - `nombre` — "Untitled" o nombre proporcionado
  - `sampleRate` — 44100 por defecto
  - `bitDepth` — 24 por defecto
  - `bpm` — 120 BPM
  - `timeSignature` — 4/4
  - `tracks` — array vacío
  - `routing` — buses vacíos, sin sends
  - `master` — volumen 0 (lineal, no dB), paneo 0
  - `metadata` — con `autor`, `genero`, `tags`, `notas`, `copyright`, `fechaCreacion`, `fechaModificacion`, `version`, `readOnly`, `customData`
- Validar que el nombre no esté vacío.
- Emitir evento `proyecto.creado`.

### 2. Guardado de Proyecto
- `project.save` comando serializa el `ProjectState` a JSON.
- Formato de archivo: `.jaswave` (JSON con extensión custom).
- Estructura del archivo:
  - `version`: número de versión del formato
  - `project`: `ProjectState` serializado
  - `audioReferences`: mapa de referencias de audio → ruta de archivo en disco
- Guardar referencias de audio como rutas relativas al proyecto.
- Validar que el archivo se escribió correctamente (checksum o tamaño).
- Emitir evento `proyecto.guardado`.

### 3. Carga de Proyecto
- `project.load` comando:
  - Leer archivo `.jaswave`
  - Validar versión del formato
  - Deserializar `ProjectState`
  - Validar integridad básica (campos requeridos presentes)
  - Construir routing matrix desde datos serializados
  - Cargar metadatos de UI
- Si el archivo está corrupto, devolver error legible.
- Emitir evento `proyecto.cargado`.

### 4. Cierre de Proyecto
- Al cerrar, verificar si hay cambios no guardados.
- Si hay cambios, solicitar confirmación al usuario.
- Si el usuario confirma guardar, ejecutar `project.save`.
- Limpiar estado de UI.
- Emitir evento `proyecto.cerrado`.

### 5. Metadatos de Proyecto
- `ProjectMetadata`:
  - `readOnly: boolean`
  - `fechaCreacion: number`
  - `fechaModificacion: number`
  - `keyBindings: KeyBinding[]`
  - `customData: Record<string, unknown>`
- Los metadatos se serializan con el proyecto.

### 6. Validación
- No permitir crear proyecto con nombre vacío.
- No permitir guardar proyecto en ruta de solo-lectura (validar `configuracion.soloLectura` o `metadata.readOnly`).
- No permitir cargar archivo que no sea `.jaswave`.
- Validar schema del JSON al cargar.

### 7. Referencias de Audio
- Los buffers de audio NO se serializan dentro del JSON.
- Se guardan como archivos WAV/FLAC en carpeta `media/` junto al `.jaswave`.
- El proyecto guarda solo referencias (`AudioBufferId`, ruta relativa, formato, sampleRate, channels, duration).
- Al cargar, se verifica que los archivos de audio existan.

### 8. Tests
- Test: crear proyecto produce estado válido
- Test: guardar y cargar produce estado idéntico (round-trip)
- Test: cerrar con cambios sin guardar pide confirmación
- Test: cargar archivo corrupto devuelve error
- Test: cargar archivo con versión incompatible devuelve error
- Test: referencias de audio se resuelven correctamente al cargar

## Dependencias
- State Model
- Command System
- Validation Layer
- Event Bus

## Documentación Relacionada
- `docs/arquitectura/MODELO-ESTADO.md`
- `docs/arquitectura/SISTEMA-COMANDOS.md`

## Notas de Alineación
- Eventos de dominio se emiten en español (`proyecto.creado`, `proyecto.cargado`, `proyecto.guardado`, `proyecto.cerrado`) para mantener coherencia con el resto del sistema.
- Campos de `ProjectState` usan nomenclatura en español: `nombre`, `bpm`, `fechaCreacion`, `fechaModificacion`.
- `ProjectState` implementado contiene campos adicionales no listados aquí (hipertrofia documentada en `MODELO-ESTADO.md`).
- El flag de solo-lectura está presente tanto en `metadata.readOnly` como en `configuracion.soloLectura`; debe unificarse en una sola ubicación.
- El ID de proyecto se genera con `Date.now()` + aleatorio, no con UUID.
- `master.volumen` es valor lineal (0), no dB.
