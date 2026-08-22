# FX Chains

## Objetivo
Implementar cadenas de efectos por track/insert/send. Los plugins de efecto procesan el audio en tiempo real dentro del DSP graph.

## Criterios de Aceptación
- [x] Cadena de efectos por track (`track.plugins` + comandos `plugin.*`, ADR-0012)
- [ ] Los plugins de efecto procesan el audio (host VST3 / audio engine)
- [x] Bypass por plugin (`plugin.bypass`)
- [x] Orden de plugins configurable (`plugin.move`)
- [x] Master FX (`project.master.plugins`, trackId `master`)
- [x] replace / copy-paste / presets de cadena
- [x] setParameter + clave automatización `plugin:instance:param`

## Requerimientos Detallados

### 1. FX Chain
- Cada track tiene `inserts: Insert[]` — plugins en serie.
- Cada send puede tener su propia FX chain.
- El master tiene `inserts: Insert[]`.
- Una FX chain es una lista ordenada de `PluginInstance`.

### 2. PluginInstance
- `id: string` — único por instancia.
- `pluginId: string` — referencia al plugin escaneado.
- `trackId: string` — track dueña.
- `position: number` — posición en la cadena.
- `bypass: boolean` — si está activo.
- `parameters: ParameterValue[]` — valores actuales.
- `latency: number` — latencia en samples.

### 3. Carga/Descarga
- `plugin.load` comando:
  - Payload: `pluginId`, `trackId`, `position?`.
  - Cargar plugin en el Native Bridge.
  - Insertar en la FX chain de la track.
  - Inicializar parámetros por defecto.
  - Emitir `plugin.loaded`.
- `plugin.unload` comando:
  - Payload: `pluginInstanceId`.
  - Descargar plugin del Native Bridge.
  - Remover de la FX chain.
  - Emitir `plugin.unloaded`.

### 4. Parámetros
- `plugin.setParameter` comando:
  - Payload: `pluginInstanceId`, `paramId`, `value`.
  - Validar rango del parámetro.
  - Enviar al motor en tiempo real.
  - Emitir `plugin.parameter.changed`.
- `plugin.getParameter` comando:
  - Payload: `pluginInstanceId`, `paramId`.
  - Devuelve valor actual.

### 5. Bypass
- `plugin.bypass` comando:
  - Payload: `pluginInstanceId`, `bypass: boolean`.
  - Si bypass=true, el plugin no procesa (passthrough).
  - Emitir `plugin.bypass.changed`.

### 6. Orden
- El usuario puede cambiar el orden de plugins en la FX chain.
- `plugin.move` comando:
  - Payload: `pluginInstanceId`, `newPosition`.
  - Reconstruir orden de la cadena.
  - Emitir `plugin.moved`.

### 7. Latencia
- Cada plugin reporta su latencia.
- El sistema compensa automáticamente:
  - Aumentar buffer de retardo en plugins con menor latencia.
  - Asegurar que todas las señales lleguen al mismo tiempo al mixer.
- La compensación se calcula al cargar el plugin y al cambiar parámetros.

### 8. Presets
- `preset.load` comando:
  - Payload: `pluginInstanceId`, `presetPath`.
  - Cargar valores de parámetros desde archivo JSON.
- `preset.save` comando:
  - Payload: `pluginInstanceId`, `name`, `category?`.
  - Guardar valores actuales en archivo JSON.
- Formato JSON plano por preset.

### 9. Integración con UI
- Plugin Editor: ventana/panel para editar parámetros.
- Inserts visuales en mixer.
- Bypass button por plugin.
- Orden drag & drop en la cadena.

### 10. Validación
- No cargar el mismo plugin dos veces en la misma posición.
- Validar que el plugin existe en el escáner.
- Validar parámetros dentro de rango.

### 11. Tests
- Test: cargar plugin lo agrega a la FX chain
- Test: descargar plugin lo remueve
- Test: cambiar parámetro emite evento
- Test: bypass desactiva procesamiento
- Test: cambiar orden actualiza posición
- Test: latencia se compensa correctamente
- Test: preset load/save funciona

## Dependencias
- Motor de Audio
- Plugin System
- State Model
- Command System
- Event Bus

## Documentación Relacionada
- `docs/audio/SISTEMA-PLUGINS.md`
- `docs/arquitectura/SISTEMA-COMANDOS.md`
