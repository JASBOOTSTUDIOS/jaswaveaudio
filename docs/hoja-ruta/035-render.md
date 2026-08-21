# Render/Exportación

## Objetivo
Implementar el sistema de renderizado y exportación: convertir el proyecto a archivos de audio en formatos WAV, FLAC y MP3.

## Criterios de Aceptación
- [ ] Exportación a WAV, FLAC, MP3
- [ ] El renderizado se ejecuta correctamente
- [ ] Progreso visible
- [ ] Calidad de audio preservada

## Requerimientos Detallados

### 1. RenderJob
Definir `RenderJob`:
- `id: string`
- `projectId: string`
- `format: 'wav' | 'flac' | 'mp3'`
- `sampleRate: number`
- `bitDepth: number` (para WAV/FLAC)
- `bitrate: number` (para MP3, kbps)
- `start: TimePosition`
- `end: TimePosition`
- `progress: number` (0-100)
- `status: 'pending' | 'rendering' | 'completed' | 'failed' | 'cancelled'`
- `outputPath?: string`
- `error?: string`

### 2. Comandos
- `render.start`:
  - Payload: `format`, `sampleRate?`, `bitDepth?`, `bitrate?`, `start?`, `end?`.
  - Validar rango start < end.
  - Crear `RenderJob`.
  - Iniciar renderizado en worker thread.
  - Emitir `render.started`.
- `render.cancel`:
  - Payload: `renderJobId`.
  - Cancelar renderizado.
  - Emitir `render.cancelled`.
- `render.getStatus`:
  - Payload: `renderJobId`.
  - Devuelve estado actual del job.

### 3. Motor de Renderizado
- Se ejecuta en worker thread dedicado (no audio thread).
- Procesa el proyecto desde `start` hasta `end`.
- Aplica:
  - Todos los tracks, clips, plugins.
  - Automatización.
  - Efectos y DSP.
  - Routing y mezcla.
- El motor de audio puede tener modo offline dedicado para renderizado.

### 4. Formatos
- **WAV**: PCM sin compresión, 16/24/32 bit.
- **FLAC**: compresión sin pérdida, 16/24 bit.
- **MP3**: compresión con pérdida, bitrate configurable (128-320 kbps).
- Futuro: AAC, OGG, OPUS.

### 5. Progreso
- El worker thread reporta progreso periódicamente.
- Event Bus emite `render.progress` con `{ jobId, progress }`.
- UI muestra barra de progreso.
- Si el renderizado se cancela, se detiene en el punto actual.

### 6. Calidad
- El renderizado debe ser idéntico a la reproducción en tiempo real.
- Dithering al bajar bit depth.
- Normalización opcional.
- Dithering para MP3.

### 7. Exportación de Stems
- Futuro: exportar cada track por separado.
- Futuro: exportar stems de buses.

### 8. Validación
- Validar que el proyecto tiene contenido para renderizar.
- Validar que el disco tiene espacio suficiente.
- Validar que la ruta de salida es escribible.

### 9. Tests
- Test: crear render job con parámetros válidos
- Test: render WAV produce archivo correcto
- Test: render FLAC produce archivo correcto
- Test: render MP3 produce archivo correcto
- Test: progreso se actualiza durante render
- Test: cancelar render detiene el proceso
- Test: render de proyecto vacío falla
- Test: calidad de audio se preserva

## Dependencias
- Motor de Audio
- State Model
- Command System
- Event Bus
- Worker Threads

## Documentación Relacionada
- `docs/arquitectura/SISTEMA-COMANDOS.md`
- `docs/audio/MOTOR-AUDIO.md`
