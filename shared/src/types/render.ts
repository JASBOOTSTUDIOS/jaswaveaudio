/**
 * Tipos de bounce/render (hoja-ruta 035).
 */

import type { TimePosition } from './tiempo'

/** WAV sale directo del motor; el resto se codifica a partir del WAV con ffmpeg. */
export type RenderFormat = 'wav' | 'aiff' | 'flac' | 'mp3' | 'ogg' | 'aac' | 'opus'

export const RENDER_FORMATS: readonly RenderFormat[] = ['wav', 'aiff', 'flac', 'mp3', 'ogg', 'aac', 'opus']
/** Formatos con pérdida: usan `bitrate` (kbps) en vez de `bitDepth`. */
export const RENDER_FORMATS_LOSSY: readonly RenderFormat[] = ['mp3', 'ogg', 'aac', 'opus']
export const RENDER_SAMPLE_RATES = [44100, 48000, 88200, 96000] as const
export const RENDER_BIT_DEPTHS = [16, 24, 32] as const
/** Extensión de archivo por formato (AAC va en contenedor M4A). */
export const RENDER_EXTENSION: Record<RenderFormat, string> = {
  wav: 'wav',
  aiff: 'aiff',
  flac: 'flac',
  mp3: 'mp3',
  ogg: 'ogg',
  aac: 'm4a',
  opus: 'opus',
}

/** Qué se exporta como stem: salida de la pista tras fader (con envíos recibidos) o antes del fader. */
export type RenderStemsTap = 'post' | 'pre'
export type RenderJobStatus = 'pending' | 'rendering' | 'completed' | 'failed' | 'cancelled'

export interface RenderJob {
  id: string
  projectId: string
  format: RenderFormat
  sampleRate: number
  bitDepth: number
  bitrate?: number
  start: TimePosition
  end: TimePosition
  progress: number
  status: RenderJobStatus
  outputPath?: string
  error?: string
  frames?: number
  loudness?: {
    integrated: number
    shortTerm: number
    momentary: number
    rangoDinamico: number
    peak: number
    truePeak: number
    lufs: number
  }
  /** Informe extendido post-bounce (P1/P7). */
  analysis?: import('../audio/mix-analysis').MixAnalysisReport
  listenReport?: import('../audio/mix-analysis').AudioListenReport
  stemsPaths?: string[]
  normalized?: boolean
  /** Opciones pedidas al iniciar (persistidas en el job). */
  normalize?: 'peak' | 'lufs' | false
  normalizeTargetDb?: number
  exportStems?: boolean
  listenTarget?: 'streaming' | 'club' | 'cd'
  /** El final se detectó del contenido (no lo fijó el usuario): se renderiza cola y se recorta el silencio. */
  autoEnd?: boolean
  /** Final del contenido (s) cuando `autoEnd`: el recorte de la cola nunca corta antes. */
  contentEndSec?: number
  /** Stems: pistas a exportar (vacío/ausente = todas las que suenan) y punto de toma. */
  stemTrackIds?: string[]
  stemsTap?: RenderStemsTap
  /** Dither TPDF al reducir a 16/24 bits (por defecto activado). */
  dither?: boolean
  /** Sin ganancia ni limitador de monitorización en el master (freeze, stems para mezclar fuera). */
  transparentMaster?: boolean
}

export interface RenderStartPayload {
  format?: RenderFormat
  sampleRate?: number
  bitDepth?: number
  bitrate?: number
  /**
   * Segundos timeline. Sin `endSec` el final se detecta solo (último clip audible + cola de
   * reverb hasta el silencio); con `endSec` se respeta exactamente el rango pedido.
   */
  startSec?: number
  endSec?: number
  outputPath?: string
  stems?: boolean
  stemTrackIds?: string[]
  stemsTap?: RenderStemsTap
  /** `true` se trata como `'lufs'` en render.start. */
  normalize?: 'peak' | 'lufs' | boolean
  normalizeTargetDb?: number
  listenTarget?: 'streaming' | 'club' | 'cd'
  dither?: boolean
  transparentMaster?: boolean
}
