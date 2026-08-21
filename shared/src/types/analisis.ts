/**
 * Análisis de audio del proyecto y pistas.
 *
 * Propósito:
 *   Modelar resultados de análisis de audio (niveles, espectro, forma
 *   de onda, loudness, etc.) para visualización y toma de decisiones.
 *
 * Importancia:
 *   - Provee datos objetivos para la UI de medidores, waveforms y
 *     visualizadores espectrales.
 *   - Permite a la IA sugerir ajustes basados en mediciones reales.
 *   - Facilita la exportación de reportes de análisis y metadatos.
 *
 * Función:
 *   Exporta AudioAnalysis, SpectrumPoint, LoudnessData, WaveformData,
 *   AudioMeter y ProjectAnalysis con métricas normalizadas.
 */

export interface SpectrumPoint {
  frecuencia: number;
  magnitud: number;
  fase: number;
}

export interface LoudnessData {
  integrated: number;
  shortTerm: number;
  momentary: number;
  rangoDinamico: number;
  peak: number;
  truePeak: number;
  lufs: number;
}

export interface WaveformData {
  samples: number[];
  peaks: number[];
  rms: number[];
  duracion: number;
  sampleRate: number;
  canales: number;
}

export interface AudioMeter {
  peak: number;
  rms: number;
  truePeak: number;
  crestFactor: number;
}

export interface AudioAnalysis {
  trackId?: string;
  loudness: LoudnessData;
  spectrum: SpectrumPoint[];
  waveform: WaveformData;
  nivelPico: number;
  nivelRMS: number;
  clipping: boolean;
  phase: number;
  stereoCorrelation: number;
  frecuenciaFundamental?: number;
  notaFundamental?: number;
}

export interface ProjectAnalysis {
  tracks: AudioAnalysis[];
  master: AudioAnalysis;
  resumen: {
    duracionTotal: number;
    pistasActivas: number;
    clipsTotales: number;
    usoCPU: number;
    usoMemoriaMB: number;
    xruns: number;
    latenciaMs: number;
  };
  histograma: {
    frecuencias: number[];
    magnitudes: number[];
  };
}
