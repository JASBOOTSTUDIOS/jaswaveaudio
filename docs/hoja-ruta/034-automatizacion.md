# Automatización

## Objetivo
Implementar el sistema de automatización: curvas de automatización editables para cualquier parámetro del DAW a lo largo del tiempo.

## Criterios de Aceptación
- [ ] Curvas de automatización editables
- [ ] La automatización se puede crear y editar
- [ ] Grabación de automatización en tiempo real
- [ ] Integración con mixer y plugins

## Requerimientos Detallados

### 1. AutomationLane
Definir `AutomationLane`:
- `id: string`
- `targetId: string` — ID del track, plugin o parámetro objetivo.
- `targetType: 'track' | 'plugin' | 'master'`
- `parameter: string` — nombre del parámetro (ej: 'volume', 'pan', 'threshold').
- `points: AutomationPoint[]`
- `enabled: boolean`

### 2. AutomationPoint
Definir `AutomationPoint`:
- `time: TimePosition`
- `value: number` — valor del parámetro en ese punto.
- `interpolation: 'linear' | 'hold' | 'spline'`

### 3. Comandos
- `automation.create`:
  - Payload: `targetId`, `parameter`, `points[]`.
  - Emitir `automation.created`.
- `automation.addPoint`:
  - Payload: `automationLaneId`, `time`, `value`.
  - Emitir `automation.pointAdded`.
- `automation.removePoint`:
  - Payload: `automationLaneId`, `pointId`.
  - Emitir `automation.pointRemoved`.
- `automation.modifyPoint`:
  - Payload: `automationLaneId`, `pointId`, `time?`, `value?`.
  - Emitir `automation.pointChanged`.
- `automation.toggle`:
  - Payload: `automationLaneId`, `enabled: boolean`.
  - Emitir `automation.toggled`.

### 4. Grabación en Tiempo Real
- Mientras el transporte está en play:
  - El usuario puede grabar automatización moviendo un fader o knob.
  - Se crean puntos de automatización en tiempo real.
- `automation.record` comando:
  - Payload: `targetId`, `parameter`.
  - Iniciar grabación de automatización.
  - Emitir `automation.recording.started`.
- Al detener grabación:
  - Emitir `automation.recording.stopped`.
  - Los puntos grabados se agregan a la lane.

### 5. Interpolación
- **Linear**: línea recta entre puntos.
- **Hold**: valor constante hasta el siguiente punto.
- **Spline**: curva suave (Bezier o Catmull-Rom).

### 6. UI
- Automation lanes en mixer y timeline.
- Línea de automatización sobre la track.
- Puntos editables: arrastrar para cambiar valor o tiempo.
- Zoom vertical para edición precisa.
- Color por parámetro.

### 7. Integración
- La automatización modifica el valor del parámetro en tiempo real durante playback.
- Si no hay automatización, usar valor fijo del parámetro.
- Si hay automatización, el valor fijo se ignora durante playback.

### 8. Tests
- Test: crear lane de automatización
- Test: agregar punto actualiza curva
- Test: modificar punto cambia valor
- Test: eliminar punto lo remueve
- Test: interpolación linear calcula valores correctos
- Test: grabación en tiempo real crea puntos
- Test: automatización modifica parámetro durante playback
- Test: toggle habilita/deshabilita lane

## Dependencias
- State Model
- Command System
- Event Bus
- Transporte
- Mixer

## Documentación Relacionada
- `docs/arquitectura/MODELO-ESTADO.md`
- `docs/arquitectura/SISTEMA-COMANDOS.md`
