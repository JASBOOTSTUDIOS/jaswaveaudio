/**
 * Tipos de bounce/render (hoja-ruta 035).
 */

import type { TimePosition } from './tiempo'

export type RenderFormat = 'wav' | 'flac' | 'mp3'
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
}

export interface RenderStartPayload {
  format?: RenderFormat
  sampleRate?: number
  bitDepth?: number
  bitrate?: number
  /** Segundos timeline (alternativa a TimePosition). */
  startSec?: number
  endSec?: number
  outputPath?: string
  stems?: boolean
  /** `true` se trata como `'lufs'` en render.start. */
  normalize?: 'peak' | 'lufs' | boolean
  normalizeTargetDb?: number
  listenTarget?: 'streaming' | 'club' | 'cd'
}
