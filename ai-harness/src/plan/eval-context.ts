/**
 * Contexto opcional para evaluación plan.md con evidencia externa (audit, render).
 */

export type PlanEvalAuditTrack = {
  id: string
  name: string
  peak: number
  notes: number
  vstSlot?: string
}

export type PlanEvalContext = {
  auditTracks?: PlanEvalAuditTrack[]
  /** Rutas sidechain enrutadas en el host (I/O confirmado). */
  sidechainHostRouted?: boolean
  /** Peak sidechain por pista destino (stem id → peak). */
  sidechainPeaks?: Record<string, number>
  /** Rutas de archivos render recientes (bounce/master). */
  renderPaths?: string[]
  /** LUFS integrado del último bounce, si disponible. */
  lastBounceLufs?: number
  /** compareTarget ejecutado y dentro de rango (|Δ| ≤ 1.5 dB). */
  compareTargetOk?: boolean
  /** Delta dB del último compareTarget. */
  compareTargetDeltaDb?: number
  /** Sends activos con amount > 0. */
  activeSendCount?: number
}
