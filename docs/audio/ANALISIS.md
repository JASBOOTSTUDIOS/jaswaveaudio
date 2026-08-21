# Análisis de Audio

## 1. Propósito

El Motor de Audio produce información estructurada de análisis. La IA recibe estos datos cuando son relevantes. Nunca se usa el LLM para calcular DSP que debe hacer el motor.

El motor calcula. La IA interpreta y decide.

## 2. Métricas de Análisis

```typescript
interface AudioAnalysis {
  trackId: string;
  timestamp: number;
  peak: number; // 0.0 - 1.0 (dBFS)
  truePeak: number; // True Peak en dBTP
  rms: number; // RMS en dBFS
  lufsIntegrated: number; // LUFS integrado
  lufsShortTerm: number; // LUFS corto plazo (3s)
  lufsMomentary: number; // LUFS momentáneo (0.4s)
  dynamicRange: number; // Rango dinámico en dB
  crestFactor: number; // Factor de cresta en dB
  spectrum: SpectrumPoint[]; // Espectro de frecuencia
  fundamentalFrequency: number | null; // Frecuencia fundamental en Hz
  pitch: number | null; // Tono detectado (MIDI note number)
  tempo: number | null; // BPM detectado
  phaseCorrelation: number; // Correlación de fase -1 a 1
  clipping: boolean; // ¿Hay clipping?
  silence: boolean; // ¿Es silencio?
  transients: TimePosition[]; // Posiciones de transientes
}

interface SpectrumPoint {
  frequency: number; // Hz
  magnitude: number; // dB
}
```

## 3. Análisis en Tiempo Real

El análisis se ejecuta en el hilo de audio o en un worker dedicado:

```typescript
interface AudioAnalyzer {
  startAnalysis(trackId: string, metrics: AnalysisMetric[]): void;
  stopAnalysis(trackId: string): void;
  getAnalysis(trackId: string): AudioAnalysis;
  onAnalysisUpdate(callback: (analysis: AudioAnalysis) => void): Subscription;
}

type AnalysisMetric = 
  | 'peak'
  | 'truePeak'
  | 'rms'
  | 'lufsIntegrated'
  | 'lufsShortTerm'
  | 'lufsMomentary'
  | 'dynamicRange'
  | 'crestFactor'
  | 'spectrum'
  | 'fundamentalFrequency'
  | 'pitch'
  | 'tempo'
  | 'phaseCorrelation'
  | 'clipping'
  | 'silence'
  | 'transients';
```

## 4. Actualización de Eventos

El análisis se comunica mediante el Event Bus:

```typescript
// Evento emitido periódicamente durante el análisis
eventBus.emit('audio.analysis.updated', {
  trackId: 'track-123',
  analysis: { peak: -6.2, rms: -18.5, lufsIntegrated: -14.0 }
});
```

El Gestor de Contexto suscribe a estos eventos para mantener información actualizada para la IA.

## 5. Análisis de Proyecto

Además del análisis por track, existe un análisis agregado del proyecto:

```typescript
interface ProjectAnalysis {
  tracks: Record<string, TrackAnalysis>;
  master: MasterAnalysis;
  overall: OverallAnalysis;
}

interface TrackAnalysis {
  peak: number;
  rms: number;
  lufsIntegrated: number;
  clipping: boolean;
  spectralCentroid: number; // Centroide espectral
}

interface MasterAnalysis {
  peak: number;
  rms: number;
  lufsIntegrated: number;
  clipping: boolean;
  truePeak: number;
}

interface OverallAnalysis {
  duration: TimeDuration;
  estimatedDynamicRange: number;
  spectralBalance: SpectrumPoint[];
}
```

## 6. Uso por la IA

La IA consulta el análisis para tomar decisiones:

```typescript
// Ejemplo: la IA detecta clipping y sugiere acción
if (analysis.tracks['vocal-1'].clipping) {
  // Sugerir reducir volumen o añadir limitador
}
```

El análisis NUNCA se calcula en el lado de la IA. El motor calcula; la IA interpreta.

## 7. Configuración de Análisis

```typescript
interface AnalysisConfig {
  enabled: boolean;
  updateInterval: number; // ms (ej: 100ms para tiempo real)
  fftSize: number; // 2048, 4096, etc.
  windowFunction: 'hann' | 'hamming' | 'blackman';
  spectrumResolution: number; // bins de frecuencia
}
```

## 8. Optimización

- El análisis de espectro se calcula en bloques con overlap
- Se usa pooling de FFT para reducir overhead
- Las métricas de baja frecuencia (LUFS integrado) se actualizan menos frecuentemente
- El análisis se puede habilitar/deshabilitar por track para ahorrar CPU
