# DSP Básico

## Objetivo
Implementar el procesamiento de señal digital básico en tiempo real: ganancia, paneo y filtros. Todo el DSP se ejecuta en el audio thread del motor nativo.

## Criterios de Aceptación
- [ ] Ganancia, paneo, clip gain
- [ ] Procesamiento en tiempo real sin clicks ni glitches
- [ ] Sin allocations en el audio thread
- [ ] Latencia mínima

## Requerimientos Detallados

### 1. Ganancia
- Aplicar ganancia lineal a señal de audio.
- Rango: -60 dB a +12 dB.
- Conversión dB a lineal: `linear = 10^(dB / 20)`.
- Aplicar por muestra o por bloque.
- Sin clipping automático (el usuario debe agregar limitador si lo necesita).

### 2. Paneo
- Paneo estéreo constante-power.
- Rango: -1 (izquierda) a +1 (derecha), 0 = centro.
- Fórmula: `left = signal * cos(pan * π/4)`, `right = signal * sin(pan * π/4)`.
- Asegurar potencia constante al mover paneo.

### 3. Clip Gain
- Ganancia por clip independiente del track.
- Rango: -60 dB a +12 dB.
- Se aplica antes de los inserts del track.
- Modifica el audio buffer temporalmente para el procesamiento.

### 4. Filtros Básicos (Opcional para MVP)
- HPF (High-Pass Filter): elimina frecuencias bajas.
- LPF (Low-Pass Filter): elimina frecuencias altas.
- Implementar como biquad filters.
- Parámetros: frecuencia, resonancia, activado.

### 5. Restricciones del Audio Thread
- Sin allocations dinámicas en el hot path.
- Usar pools de buffers preasignados.
- Sin llamadas a sistema de archivos.
- Sin logging excesivo.
- Todas las operaciones deben ser deterministas.

### 6. Integración con DSP Graph
- Cada nodo de track tiene nodos de DSP: gain, pan, clipGain, filters.
- El orden de procesamiento:
  1. Clip gain
  2. Filtros
  3. Gain
  4. Pan
  5. Inserts (plugins)
  6. Sends
  7. Output

### 7. Pruebas
- Test: ganancia aplica factor correcto
- Test: paneo constante-power mantiene volumen al mover
- Test: filtro atenúa frecuencias correctamente
- Test: procesamiento de 1000 buffers no hace allocations
- Test: sin clicks al cambiar parámetros en tiempo real
- Test: clipping se produce cuando señal > 1.0

## Dependencias
- Motor de Audio
- DSP Graph
- State Model

## Documentación Relacionada
- `docs/audio/MOTOR-AUDIO.md`
- `docs/arquitectura/VISION-GENERAL.md`
