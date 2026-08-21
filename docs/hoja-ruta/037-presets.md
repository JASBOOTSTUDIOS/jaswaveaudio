# Presets

## Objetivo
Implementar el sistema de presets: guardar, cargar, organizar y aplicar presets de tracks, plugins y proyectos completos.

## Criterios de Aceptación
- [ ] Guardar/cargar presets de tracks, plugins, proyectos
- [ ] Los presets persisten y se aplican correctamente
- [ ] Organización por categorías
- [ ] Versionado de presets

## Requerimientos Detallados

### 1. Tipos de Presets
- **Plugin Preset**: parámetros de un plugin específico.
- **FX Chain Preset**: cadena completa de plugins con sus parámetros.
- **Track Preset**: configuración completa de un track (plugins, volumen, paneo, envíos, automatización).
- **Project Preset**: configuración de proyecto (tempo, transporte, tracks base, routing).

### 2. Estructura
- `Preset`:
  - `id: string`
  - `name: string`
  - `category: string` — ej: 'Vocals', 'Drums', 'Master'.
  - `type: 'plugin' | 'fxChain' | 'track' | 'project'`
  - `pluginId?: string` — para presets de plugin.
  - `trackType?: TrackType` — para presets de track.
  - `parameters: Record<string, number>` — parámetros serializados.
  - `createdAt: number`
  - `updatedAt: number`
  - `version: string`

### 3. Comandos
- `preset.save`:
  - Payload: `type`, `name`, `category?`, `targetId` (plugin/track/project).
  - Serializar estado actual a preset.
  - Guardar en carpeta `presets/`.
  - Emitir `preset.saved`.
- `preset.load`:
  - Payload: `presetId`, `targetId`.
  - Cargar preset y aplicar parámetros.
  - Emitir `preset.loaded`.
- `preset.delete`:
  - Payload: `presetId`.
  - Eliminar archivo de preset.
  - Emitir `preset.deleted`.
- `preset.list`:
  - Payload: `type?`, `category?`, `pluginId?`.
  - Devuelve lista de presets filtrados.

### 4. Almacenamiento
- Carpeta `presets/` en el directorio del DAW.
- Subcarpetas por tipo:
  - `presets/plugins/`
  - `presets/fx-chains/`
  - `presets/tracks/`
  - `presets/projects/`
- Archivos JSON con nombre `{preset-id}.json`.
- Metadatos en índice `presets/index.json`.

### 5. Organización
- Categorías jerárquicas: `Vocal > Compresion > LA-2A`.
- Tags para búsqueda.
- Favoritos.
- Ordenar por: nombre, fecha, uso.

### 6. Versionado
- Cada preset tiene `version`.
- Si el plugin cambia parámetros, el preset se marca como incompatible.
- Al cargar preset incompatible, ofrecer migración o cancelar.

### 7. Preset Manager UI
- Browser de presets con:
  - Árbol de categorías.
  - Búsqueda.
  - Preview de preset.
  - Botones guardar/cargar/eliminar.
- Preview: al hacer hover, aplicar preset temporalmente sin guardar.

### 8. Integración con IA
- La IA puede sugerir presets:
  - "Tengo un preset de compresión vocal que te puede servir."
- La IA puede crear presets automáticamente:
  - "He configurado este compresor, ¿quieres guardarlo como preset?"

### 9. Tests
- Test: guardar preset crea archivo JSON
- Test: cargar preset aplica parámetros correctamente
- Test: eliminar preset lo remueve del índice
- Test: preset incompatible se detecta
- Test: categorías se organizan correctamente
- Test: búsqueda filtra presets
- Test: preview no modifica estado permanentemente

## Dependencias
- Plugin System
- State Model
- Command System
- Event Bus

## Documentación Relacionada
- `docs/arquitectura/SISTEMA-COMANDOS.md`
- `docs/audio/SISTEMA-PLUGINS.md`
