# Análisis

## Objetivo
Implementar el análisis de audio en tiempo real: peak, RMS, LUFS, espectro, detección de clipping y transientes. El motor calcula; la IA interpreta.

## Criterios de Aceptación
- [ ] Peak, RMS, LUFS, espectro
- [ ] Los valores se actualizan en tiempo real
- [ ] Análisis por track y por proyecto
- [ ] Sin bloquear el audio thread

## Requerimientos Detallados

### 1. Métricas por Track
Definir `AudioAnalysis`:
- `trackId: string`
- `timestamp: number`
- `peak: number` — 0.0 a 1.0 (dBFS)
- `truePeak: number` — True Peak en dBTP
- `rms: number` — RMS en dBFS
- `lufsIntegrated: number` — LUFS integrado
- `lufsShortTerm: number` — LUFS corto plazo (3s)
- `lufsMomentary: number` — LUFS momentáneo (0.4s)
- `dynamicRange: number` — rango dinámico en dB
- `crestFactor: number` — factor de cresta en dB
- `spectrum: SpectrumPoint[]` — espectro de frecuencia
- `fundamentalFrequency: number | null` — frecuencia fundamental en Hz
- `pitch: number | null` — tono detectado (MIDI note number)
- `tempo: number | null` — BPM detectado
- `phaseCorrelation: number` — correlación de fase (-1 a 1)
- `clipping: boolean` — ¿hay clipping?
- `silence: boolean` — ¿es silencio?
- `transients: TimePosition[]` — posiciones de transientes

### 2. Análisis por Proyecto
Definir `ProjectAnalysis`:
- `tracks: Record<string, TrackAnalysis>` — análisis por track.
- `master: MasterAnalysis` — análisis del master.
- `overall: OverallAnalysis` — análisis agregado.

`TrackAnalysis`:
- `peak`, `rms`, `lufsIntegrated`, `clipping`, `spectralCentroid`

`MasterAnalysis`:
- `peak`, `rms`, `lufsIntegrated`, `clipping`, `truePeak`

`OverallAnalysis`:
- `duration`, `estimatedDynamicRange`, `spectralBalance`

### 3. Motor de Análisis
- El análisis se ejecuta en un worker thread dedicado o en el audio thread con cuidado.
- Actualizaciones periódicas:
  - Peak/RMS: cada 50-100ms.
  - LUFS integrado: cada 1-5s (lento).
  - LUFS short term: cada 200-300ms.
  - Espectro: cada 100-200ms.
- El análisis se puede habilitar/deshabilitar por track para ahorrar CPU.

### 4. Eventos
- El motor emite `audio.analysis.updated` cuando hay datos nuevos.
- El Event Bus distribuye a:
  - UI (VU meters en mixer y timeline).
  - Context Manager (para IA).
  - Clipping detector.
- Backpressure: agrupar actualizaciones de alta frecuencia.

### 5. Configuración
- `AnalysisConfig`:
  - `enabled: boolean`
  - `updateInterval: number` — ms
  - `fftSize: number` — 2048, 4096, etc.
  - `windowFunction: 'hann' | 'hamming' | 'blackman'`
  - `spectrumResolution: number`

### 6. Uso por IA
- La IA consulta `analysis.getPeak(trackId)`, `analysis.getLUFS(trackId)`, etc.
- La IA recibe estos datos cuando son relevantes.
- El motor calcula; la IA interpreta y decide.
- Ejemplo: si `clipping = true`, la IA puede sugerir reducir volumen o agregar limitador.

### 7. Optimización
- FFT pooling para reducir overhead.
- Métricas de baja frecuencia se actualizan menos frecuentemente.
- Análisis se puede deshabilitar por track.
- No bloquear audio thread.

### 8. Tests
- Test: peak/RMS se calculan correctamente sobre buffer conocido
- Test: LUFS integrado converge al valor esperado
- Test: clipping se detecta cuando señal > 0 dBFS
- Test: espectro tiene resolución correcta
- Test: eventos se emiten al intervalo configurado
- Test: deshabilitar análisis reduce CPU
- Test: análisis de proyecto agrega correctamente

## Dependencias
- Motor de Audio
- Event Bus
- State Model

## Documentación Relacionada
- `docs/audio/ANALISIS.md`
- `docs/arquitectura/VISION-GENERAL.md`
