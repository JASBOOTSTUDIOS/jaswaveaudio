# Transporte

## Objetivo
Implementar el sistema de transporte del DAW: play, pause, stop, seek y loop. El transporte controla la posición del playhead y la reproducción de audio.

## Criterios de Aceptación
- [ ] Play inicia reproducción
- [ ] Pause detiene temporalmente
- [ ] Stop detiene y resetea posición
- [ ] Seek mueve playhead a posición específica
- [ ] Loop define región de repetición

## Requerimientos Detallados

### 1. TransportState
Definir `TransportState`:
- `isPlaying: boolean`
- `isPaused: boolean`
- `position: TimePosition` — posición actual en segundos
- `loopEnabled: boolean`
- `loopStart: TimePosition`
- `loopEnd: TimePosition`
- `timeSignature: TimeSignature`
- `tempo: BPM`

### 2. Comandos de Transporte
- `transport.play` — inicia reproducción.
  - Precondición: no debe estar ya playing.
  - Emite `transport.started`.
- `transport.pause` — pausa reproducción.
  - Precondición: debe estar playing.
  - Emite `transport.paused`.
- `transport.stop` — detiene y resetea posición a 0 o al inicio del loop.
  - Precondición: playing o paused.
  - Emite `transport.stopped`.
- `transport.seek` — mueve playhead a posición específica.
  - Payload: `position: TimePosition`
  - Validar que position esté dentro del rango del proyecto.
  - Emite `transport.positionChanged`.
- `transport.setLoop` — define loop.
  - Payload: `enabled: boolean`, `start?: TimePosition`, `end?: TimePosition`
  - Validar start < end.
  - Emite `transport.loopChanged`.

### 3. Playhead
- El playhead es la representación visual de la posición actual.
- Se actualiza mediante eventos `transport.positionChanged`.
- La UI suscribe a este evento para actualizar la timeline.
- El playhead NUNCA se consulta por polling; la UI reacciona al evento.

### 4. Sincronización
- El transporte debe estar sincronizado con:
  - Timeline (playhead visual)
  - Mixer (si aplica)
  - Audio Engine (posición de reproducción real)
  - Metrónomo (si aplica)
- El Event Bus es el mecanismo de sincronización.

### 5. Integración con Audio Engine
- `transport.play` envía comando al Native Bridge para iniciar playback.
- `transport.pause` envía comando al Native Bridge para pausar.
- `transport.stop` envía comando al Native Bridge para detener.
- `transport.seek` envía comando al Native Bridge para buscar posición.
- El audio engine devuelve la posición real mediante eventos.

### 6. Validación
- No permitir play si ya está playing.
- No permitir pause si no está playing.
- Validar posición de seek dentro de rango válido.
- Validar loop start < loop end.

### 7. Tests
- Test: play cambia isPlaying a true
- Test: pause cambia isPlaying a false y isPaused a true
- Test: stop resetea posición
- Test: seek actualiza posición correctamente
- Test: loop se puede habilitar/deshabilitar
- Test: eventos se emiten correctamente
- Test: validaciones bloquean acciones inválidas

## Dependencias
- State Model
- Command System
- Event Bus
- Validation Layer
- Native Bridge (para comunicación con audio engine)

## Documentación Relacionada
- `docs/arquitectura/SISTEMA-COMANDOS.md`
- `docs/arquitectura/BUS-EVENTOS.md`
