# Sistema de Plugins Completo

## Objetivo
Implementar el sistema completo de plugins: escaneo, carga dinámica, preset manager y descubrimiento automático. Los plugins deben poder cargarse y ejecutarse sin reiniciar el DAW.

## Criterios de Aceptación
- [ ] Escaneo, carga, preset manager
- [ ] Los plugins se descubren y cargan dinámicamente
- [ ] Formato VST3 soportado
- [ ] Presets se guardan y cargan correctamente

## Requerimientos Detallados

### 1. PluginScanner
- Escanear rutas conocidas en busca de plugins:
  - Windows: `C:\Program Files\VST3\`
  - macOS: `/Library/Audio/Plug-Ins/VST3/`
  - Linux: `~/.vst3/`, `/usr/lib/vst3/`
- `PluginScanner.scan(paths)`:
  - Buscar archivos `.vst3` o bundles.
  - Validar compatibilidad.
  - Extraer metadata: nombre, fabricante, versión, categoría, parámetros.
- `PluginScanner.watch(paths)`:
  - Observar cambios en las carpetas.
  - Emitir `plugin.discovered` cuando se agrega un plugin.
- `PluginScanner.rescan()`:
  - Re-escanear todas las rutas.
  - Actualizar lista de plugins disponibles.

### 2. PluginDescriptor
Definir `PluginDescriptor`:
- `id: string`
- `name: string`
- `manufacturer: string`
- `format: 'vst3' | 'au' | 'lv2'`
- `category: string` — 'effect', 'instrument', 'analyzer', 'utility'.
- `version: string`
- `inputs: number`
- `outputs: number`
- `parameters: ParameterDescriptor[]`
- `latency: number`
- `canProcessInPlace: boolean`

### 3. ParameterDescriptor
Definir `ParameterDescriptor`:
- `id: string`
- `name: string`
- `type: 'float' | 'integer' | 'boolean' | 'enum'`
- `min: number`
- `max: number`
- `default: number`
- `unit: string` — 'dB', '%', 'Hz', 'ms', 'samples'.
- `automatable: boolean`
- `enumValues?: { value: number; label: string }[]`

### 4. PluginHost
- `PluginHost.load(pluginId, instanceId)`:
  - Cargar plugin en memoria.
  - Inicializar con sampleRate y bufferSize.
  - Crear `PluginInstance`.
- `PluginHost.unload(instanceId)`:
  - Liberar memoria.
  - Eliminar `PluginInstance`.
- `PluginHost.process(instanceId, input, output)`:
  - Procesar bloque de audio.
  - Ejecutar en audio thread.
- `PluginHost.getParameter(instanceId, paramId)`:
  - Obtener valor actual.
- `PluginHost.setParameter(instanceId, paramId, value)`:
  - Establecer valor.

### 5. PresetManager
- `PresetManager.list(pluginId?)`:
  - Listar presets disponibles para un plugin o todos.
- `PresetManager.load(pluginInstanceId, presetPath)`:
  - Cargar preset en instancia.
- `PresetManager.save(pluginInstanceId, name, category?)`:
  - Guardar preset actual.
- `PresetManager.delete(presetPath)`:
  - Eliminar preset.

### 6. Formato de Presets
- JSON plano por preset:
  - `pluginId`, `pluginVersion`, `parameters: Record<string, number>`.
- Almacenados en carpeta `presets/` del proyecto o global.
- Versionado: si el plugin cambia parámetros, el preset se migra o se marca como incompatible.

### 7. Dynamic Discovery
- Cuando un plugin carga, registrar herramientas automáticamente:
  - `plugin.{id}.getParameters`
  - `plugin.{id}.setParameter`
  - `plugin.{id}.getPresets`
  - `plugin.{id}.loadPreset`
- La IA puede descubrir y controlar plugins dinámicamente.

### 8. Sandboxing
- Limitar memoria por plugin.
- Timeout de procesamiento.
- Validación de parámetros antes de enviar al plugin.
- Logging de errores sin crash del DAW.
- Deshabilitar plugins problemáticos automáticamente.

### 9. Tests
- Test: escanear encuentra plugins instalados
- Test: cargar plugin crea instancia válida
- Test: descargar plugin libera recursos
- Test: parámetros se pueden leer y escribir
- Test: preset se guarda y carga correctamente
- Test: preset incompatible se detecta
- Test: plugin problemático se deshabilita
- Test: herramientas se registran automáticamente

## Dependencias
- Motor de Audio
- Plugin System
- State Model
- Command System
- Event Bus

## Documentación Relacionada
- `docs/audio/SISTEMA-PLUGINS.md`
- `docs/arquitectura/SISTEMA-COMANDOS.md`
