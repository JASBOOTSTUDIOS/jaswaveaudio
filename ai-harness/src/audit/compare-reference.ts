/**
 * Comparación contra referencia (A9) - audit.compareReference
 *
 * Diferencias contra una referencia (banda, LUFS, ancho estéreo, dinámica).
 * Si A7b (`analysis.reference`) está disponible, sus datos se usan tal cual;
 * si no, se comparan las mediciones del host contra los valores de referencia.
 */

import type { AuditEvidence } from './schemas';

export type Referencia = {
  nombre: string
  lufs?: number
  truePeak?: number
  plr?: number
  stereoWidth?: number
  banda?: string
  rango?: { lo: number; hi: number }
}

export type DiferenciaReferencia = {
  metrica: string
  actual?: number
  referencia?: number
  diff?: number
  unidad?: string
  ok: boolean
}

export type ResultadoCompareReference = {
  referencia: string
  diferencias: DiferenciaReferencia[]
  cumple: boolean
  evidencia: AuditEvidence[]
  timestamp: number
}

const TOLERANCIA_LUFS = 1
const TOLERANCIA_TP = 1
const TOLERANCIA_PLR = 2

export function compareReference(opts: {
  referencia: Referencia
  mediciones?: Record<string, number>
}): ResultadoCompareReference {
  const m = opts.mediciones ?? {}
  const r = opts.referencia
  const diferencias: DiferenciaReferencia[] = []

  const push = (metrica: string, actual: number | undefined, ref: number | undefined, unidad: string, tol: number) => {
    if (actual === undefined || ref === undefined) return
    const diff = actual - ref
    diferencias.push({
      metrica,
      actual,
      referencia: ref,
      diff,
      unidad,
      ok: Math.abs(diff) <= tol,
    })
  }

  push('lufs', m['lufs'], r.lufs, 'LUFS', TOLERANCIA_LUFS)
  push('tp', m['tp'], r.truePeak, 'dBTP', TOLERANCIA_TP)
  push('plr', m['plr'], r.plr, 'dB', TOLERANCIA_PLR)
  push('stereoWidth', m['stereoWidth'], r.stereoWidth, '%', 10)

  const cumple = diferencias.every((d) => d.ok)

  return {
    referencia: r.nombre,
    diferencias,
    cumple,
    evidencia: [
      {
        tipo: 'medicion',
        descripcion: `Comparación contra «${r.nombre}»${r.banda ? ` (${r.banda})` : ''}`,
        valor: { diferencias: diferencias.length, cumple },
      },
    ],
    timestamp: Date.now(),
  }
}
