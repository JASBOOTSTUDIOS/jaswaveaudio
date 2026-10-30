import type { DAWState } from '@jaswave/shared'
import {
  clipArrangeRange,
  formatSectionGapLine,
  isMidiLikeTrack,
  listSectionGaps,
  listSectionSpans,
} from '../plan/section-coverage'
import type { QualityGateResult, QualityVerdict } from './types'

export function evaluateArrangementQuality(state: DAWState): QualityGateResult {
  const gaps = listSectionGaps(state)
  const findings: QualityGateResult['findings'] = []
  if (gaps.length) {
    findings.push({
      verdict: 'fail',
      code: 'section-gap',
      message: `Huecos de sección (${gaps.length}): ${gaps.slice(0, 8).map(formatSectionGapLine).join('; ')}.`,
    })
  }

  const spans = listSectionSpans(state)
  if (spans.length) {
    // Rangos de marcador sin extender al último clip (si no, todo clip “cae” en la última sección).
    const markers = [...(state.project?.marcadores ?? [])].sort(
      (a, b) => Number(a.tiempo) - Number(b.tiempo),
    )
    const gridSpans = markers.map((m, i) => {
      const start = Math.max(0, Number(m.tiempo) || 0)
      const next = markers[i + 1]
      const end = next
        ? Math.max(start, Number(next.tiempo) || 0)
        : start + 16
      return { start, end }
    }).filter((s) => s.end - s.start >= 1)

    for (const t of state.project?.tracks ?? []) {
      if (!isMidiLikeTrack(t.tipo)) continue
      for (const c of t.clips ?? []) {
        const notes = (c as { notas?: unknown[] }).notas?.length ?? 0
        if (!notes) continue
        const r = clipArrangeRange(c as { inicio?: number; duracion?: number; notas?: Array<{ inicio?: number; duracion?: number }> })
        const overlaps = (gridSpans.length ? gridSpans : spans).some(
          (s) => Math.min(r.end, s.end) - Math.max(r.start, s.start) > 0.5,
        )
        if (!overlaps) {
          findings.push({
            verdict: 'warning',
            code: 'clip-off-grid-section',
            message: `Clip «${(c as { nombre?: string }).nombre || c.id}» en «${t.nombre}» (@${r.start}) no solapa ningún marcador de sección.`,
          })
        }
      }
    }
  }

  const verdict: QualityVerdict = findings.some((f) => f.verdict === 'fail')
    ? 'fail'
    : findings.some((f) => f.verdict === 'warning')
      ? 'warning'
      : 'pass'
  return { verdict, findings }
}
