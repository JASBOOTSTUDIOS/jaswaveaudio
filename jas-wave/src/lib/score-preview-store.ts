/**
 * Estado global para abrir la vista previa de partitura PDF.
 */

import type { MidiNote } from '@jaswave/shared'

export type ScorePreviewRequest = {
  title: string
  subtitle?: string
  fileName: string
  notes: MidiNote[]
  bpm: number
  drums?: boolean
}

const listeners = new Set<() => void>()
let current: ScorePreviewRequest | null = null

function notify(): void {
  listeners.forEach((l) => l())
}

export function getScorePreviewRequest(): ScorePreviewRequest | null {
  return current
}

export function openScorePreview(req: ScorePreviewRequest): void {
  current = req
  notify()
}

export function closeScorePreview(): void {
  current = null
  notify()
}

export function subscribeScorePreview(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
