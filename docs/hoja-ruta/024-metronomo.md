# Metrónomo

## Objetivo
Implementar el metrónomo del DAW: click track sincronizado con el transporte y el tempo del proyecto.

## Criterios de Aceptación
- [ ] Click track con tiempo y compás
- [ ] Sincronizado con el transporte
- [ ] Configurable por usuario
- [ ] Sin clicks ni glitches

## Requerimientos Detallados

### 1. Concepto
- El metrónomo emite clicks en los beats del proyecto.
- Sincronizado con el transporte: play, pause, stop, seek.
- Respeta el tempo y el compás del proyecto.

### 2. Configuración
- `MetronomeConfig`:
  - `enabled: boolean`
  - `bpm: number` — si es diferente al del proyecto, usar este.
  - `timeSignature: TimeSignature` — si es diferente, usar este.
  - `volume: Decibel` — volumen del click.
  - `accentedNote: boolean` — primer beat del compás más fuerte.
  - `sound: 'default' | 'custom'` — sonido del click.
- El usuario puede configurar en Settings.

### 3. Comportamiento
- Al hacer play:
  - Si metrónomo activado, iniciar generación de clicks.
  - Primera posición de play es el primer beat después de la posición actual.
- Al hacer pause/stop:
  - Detener clicks.
- Al hacer seek:
  - Recalcular siguiente beat.
- Si el tempo cambia durante playback:
  - Recalcular intervalos de clicks.

### 4. Audio
- Los clicks se generan como buffers de audio cortos.
- Se inyectan en el DSP graph en tiempo real.
- No bloquear audio thread.
- Usar memoria preasignada para buffers de click.

### 5. Integración
- El metrónomo es un bus especial o un nodo en el DSP graph.
- Se puede enviar el metrónomo a una salida específica (ej: salida de cue).
- El usuario puede mutear el metrónomo sin desactivarlo.

### 6. Tests
- Test: play inicia clicks en beats correctos
- Test: pause detiene clicks
- Test: seek recalcula siguiente beat
- Test: cambio de tempo se refleja en intervalo
- Test: primer beat acentuado es más fuerte
- Test: metrónomo no produce clicks si está desactivado

## Dependencias
- Motor de Audio
- Transporte
- State Model
- Event Bus

## Documentación Relacionada
- `docs/audio/MOTOR-AUDIO.md`
- `docs/arquitectura/SISTEMA-COMANDOS.md`
