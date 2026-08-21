# Grabación

## Objetivo
Implementar la grabación de audio en tiempo real: clips se crean automáticamente en tracks armadas cuando el transporte está en play.

## Criterios de Aceptación
- [ ] Grabar audio en clips
- [ ] La grabación crea clips en el track armado
- [ ] Sin clicks ni glitches
- [ ] Manejo de underruns

## Requerimientos Detallados

### 1. Armado de Tracks
- Solo `AudioTrack` y `MidiTrack` pueden armarse para grabación.
- `track.arm` comando:
  - Payload: `trackId`, `armed: boolean`.
  - Solo una track puede estar armada a la vez (política para MVP).
  - Emitir `track.armed`.
- Visualización: track armada muestra indicador rojo.

### 2. Iniciar Grabación
- `transport.record` comando:
  - Precondición: al menos una track armada.
  - Iniciar captura desde el dispositivo de entrada.
  - Asociar buffer circular a cada track armada.
  - Emitir `recording.started`.
- Si no hay tracks armadas, mostrar error.

### 3. Detener Grabación
- `transport.stop` o `transport.pause` detiene la grabación.
- Los buffers capturados se convierten en `AudioClip`.
- `AudioClip`:
  - `id` generado.
  - `trackId` de la track armada.
  - `start` = posición actual del transporte.
  - `duration` = duración de la grabación.
  - `source` = buffer de audio recién grabado.
  - Se guarda como archivo WAV/FLAC en carpeta `media/`.
- Emitir `recording.stopped` y `clip.created` por cada clip generado.

### 4. Buffer Circular
- Buffer circular preasignado para captura continua.
- Escritura por el audio thread (captura).
- Lectura por worker thread (procesamiento y guardado).
- Tamaño suficiente para evitar underruns.

### 5. Underruns
- Detectar underruns en captura.
- Logging con timestamp.
- Rellenar con silencio si es necesario (no crashear).
- Notificar al usuario si los underruns son frecuentes.

### 6. AudioSource
- `AudioSource` para grabación:
  - `id: string` — ID del buffer de audio.
  - `filePath: string` — ruta del archivo guardado.
  - `sampleRate: number`
  - `channels: number`
  - `duration: TimeDuration`
  - `format: 'wav' | 'flac'`

### 7. Waveform Summary
- Al finalizar grabación, generar `WaveformSummary` para el clip.
- Downsample para UI/IA.

### 8. Validación
- No grabar si no hay tracks armadas.
- No grabar si el dispositivo de entrada no está disponible.
- Validar que hay espacio en disco suficiente.

### 9. Tests
- Test: armar track la marca como armada
- Test: iniciar grabación crea buffer circular
- Test: detener grabación genera AudioClip
- Test: clip se agrega a la track correcta
- Test: clip tiene duración correcta
- Test: underrun no crashea
- Test: waveform summary se genera
- Test: sin tracks armadas, grabación falla

## Dependencias
- Motor de Audio
- Audio I/O
- Clips
- Transporte
- State Model
- Event Bus

## Documentación Relacionada
- `docs/audio/MOTOR-AUDIO.md`
- `docs/arquitectura/SISTEMA-COMANDOS.md`
