# Instrumentos Virtuales

## Objetivo
Implementar la carga y ejecución de instrumentos virtuales VST3. Los instrumentos reciben eventos MIDI y producen audio en tiempo real.

## Criterios de Aceptación
- [ ] Carga y ejecución de VST3
- [ ] Los instrumentos virtuales se cargan y ejecutan
- [ ] Integración con MIDI y DSP graph
- [ ] Manejo de latencia

## Requerimientos Detallados

### 1. Carga de Instrumentos
- `plugin.load` comando:
  - Payload: `pluginId`, `trackId` (InstrumentTrack).
  - Validar que el plugin es de tipo instrumento.
  - Crear `PluginInstance` en la track.
  - Cargar en el Native Bridge.
  - Emitir `plugin.loaded`.
- `plugin.unload` comando:
  - Payload: `pluginInstanceId`.
  - Descargar del Native Bridge.
  - Remover de la track.
  - Emitir `plugin.unloaded`.

### 2. Ejecución
- El instrumento recibe eventos MIDI:
  - `noteOn`: pitch, velocity, channel.
  - `noteOff`: pitch, channel.
  - `ccChanged`: controller number, value.
- El instrumento produce audio:
  - Se inserta en el DSP graph después de los clips MIDI.
  - Procesa bloques de audio en el audio thread.
- Latencia del instrumento se compensa automáticamente.

### 3. Parámetros
- `plugin.setParameter` comando:
  - Payload: `pluginInstanceId`, `paramId`, `value`.
  - Validar rango.
  - Enviar al instrumento en tiempo real.
  - Emitir `plugin.parameter.changed`.
- `plugin.getParameter` comando:
  - Payload: `pluginInstanceId`, `paramId`.
  - Devuelve valor actual.

### 4. Presets
- `preset.load` comando:
  - Payload: `pluginInstanceId`, `presetPath`.
  - Cargar parámetros desde preset.
- `preset.save` comando:
  - Payload: `pluginInstanceId`, `name`, `category?`.
  - Guardar parámetros actuales.

### 5. UI
- Instrument Editor: panel para editar parámetros del instrumento.
- Teclado virtual: teclas de piano clickeables para probar el instrumento.
- Preset browser.

### 6. Formato
- MVP: VST3 como formato principal.
- Futuro: AU (macOS), LV2 (Linux).

### 7. Manejo de Errores
- Si el instrumento crashea:
  - Aislar el crash para no afectar el DAW.
  - Marcar plugin como problemático.
  - Permitir al usuario deshabilitarlo.
- Logging de errores de plugin.

### 8. Tests
- Test: cargar instrumento lo agrega a la track
- Test: descargar instrumento lo remueve
- Test: noteOn/noteOff se envían correctamente
- Test: parámetros se pueden cambiar en tiempo real
- Test: preset load/save funciona
- Test: latencia se compensa
- Test: crash de plugin no crashea el DAW

## Dependencias
- Plugin System
- Motor de Audio
- MIDI
- State Model
- Command System
- Event Bus

## Documentación Relacionada
- `docs/audio/SISTEMA-PLUGINS.md`
- `docs/arquitectura/SISTEMA-COMANDOS.md`
