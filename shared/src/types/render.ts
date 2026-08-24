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
}
