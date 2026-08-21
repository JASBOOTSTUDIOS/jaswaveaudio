# Clips

## Objetivo
Implementar la creación, movimiento, redimensionado, división y eliminación de clips de audio en la timeline. Los clips son los segmentos de audio o MIDI que se disponen en las tracks.

## Criterios de Aceptación
- [ ] Crear clips de audio en tracks
- [ ] Mover clips dentro de la misma track
- [ ] Redimensionar clips (cambiar duración)
- [ ] Dividir clips en dos
- [ ] Eliminar clips

## Requerimientos Detallados

### 1. AudioClip
Definir `AudioClip`:
- `id: string`
- `trackId: string`
- `name: string`
- `start: TimePosition` — posición en la timeline
- `duration: TimeDuration` — duración del clip
- `offset: TimeDuration` — offset dentro del archivo de audio origen
- `source: AudioSource` — referencia al archivo de audio
- `fadeIn?: Fade`
- `fadeOut?: Fade`
- `color: string`
- `muted: boolean`
- `waveform: WaveformSummary` — resumen para UI/IA

### 2. MidiClip
Definir `MidiClip`:
- `id: string`
- `trackId: string`
- `name: string`
- `start: TimePosition`
- `duration: TimeDuration`
- `notes: MidiNote[]`
- `velocity: VelocityCurve`
- `quantization: QuantizationSettings`

`MidiNote`:
- `pitch: number` (0-127)
- `velocity: number` (0-127)
- `start: TimePosition`
- `duration: TimeDuration`
- `channel: number` (0-15)

### 3. Crear Clip
- `clip.create` comando:
  - Payload: `trackId: string`, `source: AudioSource`, `start: TimePosition`, `duration?: TimeDuration`
  - Si no se proporciona `duration`, usar duración completa del archivo.
  - Generar `AudioClip` con ID único.
  - Calcular `waveform` summary (downsample para UI/IA).
  - Validar que el `trackId` existe y es de tipo audio.
  - Validar que no se superpone con otro clip (política de superposición a definir).
  - Emitir `clip.created`.

### 4. Mover Clip
- `clip.move` comando:
  - Payload: `clipId: string`, `newStart: TimePosition`, `newTrackId?: string`
  - Validar que el clip existe.
  - Si `newTrackId` se proporciona, validar que es track válida y compatible.
  - Validar nueva posición no causa superposición (si la política lo requiere).
  - Actualizar `start` y `trackId`.
  - Emitir `clip.moved`.

### 5. Redimensionar Clip
- `clip.resize` comando:
  - Payload: `clipId: string`, `newDuration: TimeDuration`, `newOffset?: TimeDuration`
  - Validar que `newDuration > 0`.
  - Validar que no se excede la duración del archivo origen.
  - Actualizar `duration` y `offset` si se proporciona.
  - Recalcular `waveform` summary si es necesario.
  - Emitir `clip.resized`.

### 6. Dividir Clip
- `clip.split` comando:
  - Payload: `clipId: string`, `splitPosition: TimePosition`
  - Validar que `splitPosition` está dentro del clip (entre start y start+duration).
  - Crear nuevo clip con la segunda mitad.
  - Ajustar duración del clip original.
  - Ajustar offset del nuevo clip.
  - Emitir `clip.split`.

### 7. Eliminar Clip
- `clip.delete` comando:
  - Payload: `clipId: string`
  - Validar que el clip existe.
  - Eliminar clip de la track.
  - Emitir `clip.deleted`.

### 8. Fades
- `clip.setFadeIn` comando:
  - Payload: `clipId: string`, `fade: Fade`
- `clip.setFadeOut` comando:
  - Payload: `clipId: string`, `fade: Fade`
- `Fade`: `type ('linear' | 'exponential' | 'logarithmic')`, `duration: TimeDuration`

### 9. Superposiciones
- Definir política de superposición:
  - **Opción A**: No permitir superposiciones (validar y rechazar).
  - **Opción B**: Permitir superposiciones (crossfade automático o manual).
  - **Opción C**: Permitir superposiciones en diferentes capas.
- Para MVP: **Opción A** — no permitir superposiciones, devolver error claro.

### 10. Waveform Summary
- `WaveformSummary` es un downsample del waveform para UI y consulta de IA:
  - Array de puntos `{ time: number, min: number, max: number }`
  - Resolución: aprox 1 punto cada 10-50 píxeles en UI.
- Se genera al crear el clip y se recalcula al redimensionar.

### 11. Validación
- Track destino debe existir y ser compatible.
- Posiciones deben estar dentro de rango válido.
- Duración debe ser mayor a 0.
- No superponer clips (si política A).

### 12. Tests
- Test: crear clip produce clip válido en track correcta
- Test: mover clip actualiza posición
- Test: redimensionar cambia duración
- Test: dividir crea dos clips con longitudes correctas
- Test: eliminar clip lo remueve
- Test: superposición es rechazada (política A)
- Test: fades se aplican correctamente
- Test: waveform summary se genera

## Dependencias
- State Model
- Command System
- Validation Layer
- Event Bus

## Documentación Relacionada
- `docs/arquitectura/MODELO-ESTADO.md`
- `docs/arquitectura/SISTEMA-COMANDOS.md`
