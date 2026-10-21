/**
 * Parser de criterios medibles para A9 - audit.step.
 * Interpreta criterios del plan como: "LUFS −14 ±1", "TP ≤ −1", "pista X −18 ±3 dBFS RMS",
 * "sin masking kick/bajo", etc.
 */

export type MeasurableMetric =
  | 'lufs'
  | 'tp'
  | 'rms'
  | 'peak'
  | 'dynamic_range'
  | 'plr'
  | 'masking'
  | 'stereo_width'
  | 'balance'
  | 'other'

export type NumericCriterion = {
  metric: Exclude<MeasurableMetric, 'masking'>
  target: number
  tolerance?: number
  operator: 'eq' | 'le' | 'lt' | 'ge' | 'gt' | 'approx'
  unit?: string
  track?: string
  band?: string
}

export type BooleanCriterion = {
  metric: 'masking'
  requires: boolean
  description: string
}

export type Criterion = NumericCriterion | BooleanCriterion

export type ParsedCriteria = Criterion[]

const OP_REGEX = /(≤|<=|<|>=|≥|>|==|=|±)/

function normalizeNumber(s: string): number {
  return parseFloat(s.replace(',', '.'))
}

export function parseCriteria(criteriaText: string): ParsedCriteria {
  if (!criteriaText || criteriaText.trim().length === 0) {
    return []
  }

  const text = criteriaText.toLowerCase()
  const criteria: ParsedCriteria = []

  // LUFS: "LUFS −14 ±1", "LUFS -14 ± 1", "LUFS -14 +/-1"
  const lufsRegex = /lufs\s*[-−]?\s*(-?\d+(?:[.,]\d+)?)\s*(?:±|\+\/-)\s*(\d+(?:[.,]\d+)?)/gi
  for (const m of text.matchAll(lufsRegex)) {
    const target = normalizeNumber(m[1])
    const tol = normalizeNumber(m[2])
    criteria.push({
      metric: 'lufs',
      target,
      tolerance: tol,
      operator: 'approx',
      unit: 'LUFS',
    })
  }

  // True Peak: "TP ≤ −1", "TP <= -1", "TP < -1"
  const tpRegex = /tp\s*(≤|<=|<|>=|≥|>)\s*[-−]?\s*(-?\d+(?:[.,]\d+)?)/gi
  for (const m of text.matchAll(tpRegex)) {
    const op = m[1]
    const val = normalizeNumber(m[2])
    criteria.push({
      metric: 'tp',
      target: val,
      operator: op === '≤' || op === 'le' || op === '<=' ? 'le' : op === '<' ? 'lt' : op === '>=' || op === '≥' ? 'ge' : 'gt',
      unit: 'dBTP',
    })
  }

  // RMS por pista: "pista X -18 ±3 dBFS RMS", "kick -18 ±3 RMS"
  const rmsTrackRegex = /(pista\s+\w+|track\s+\w+|kick|snare|clap|hat|hihat|bass|bajo|sub|lead|pad|vox|voz|vocal)\s+[-−]?\s*(-?\d+(?:[.,]\d+)?)\s*(?:±|\+\/-)\s*(\d+(?:[.,]\d+)?)\s*(?:dBFS\s*)?rms/gi
  for (const m of text.matchAll(rmsTrackRegex)) {
    const track = m[1].replace(/pista\s+/i, '').trim()
    const target = normalizeNumber(m[2])
    const tol = normalizeNumber(m[3])
    criteria.push({
      metric: 'rms',
      target,
      tolerance: tol,
      operator: 'approx',
      unit: 'dBFS',
      track,
    })
  }

  // RMS genérico con ±
  const rmsRegex = /rms\s+[-−]?\s*(-?\d+(?:[.,]\d+)?)\s*(?:±|\+\/-)\s*(\d+(?:[.,]\d+)?)/gi
  for (const m of text.matchAll(rmsRegex)) {
    // Evitar duplicados si ya matcheó track
    const key = `rms-${m.index}`
    if (!criteria.some((c) => c.metric === 'rms' && 'track' in c === false && Math.abs((c as any).target - normalizeNumber(m[1])) < 0.01)) {
      criteria.push({
        metric: 'rms',
        target: normalizeNumber(m[1]),
        tolerance: normalizeNumber(m[2]),
        operator: 'approx',
        unit: 'dBFS',
      })
    }
  }

  // Masking: "sin masking kick/bajo", "sin masking", "no masking"
  const maskingRegex = /(sin|no)\s+masking(?:\s+([^,.;]+))?/gi
  for (const m of text.matchAll(maskingRegex)) {
    const desc = m[2] ? `sin masking ${m[2].trim()}` : 'sin masking'
    criteria.push({
      metric: 'masking',
      requires: false,
      description: desc,
    })
  }

  // PLR/Dynamic range
  const plrRegex = /plr\s*(≤|<=|<)\s*(-?\d+(?:[.,]\d+)?)/gi
  for (const m of text.matchAll(plrRegex)) {
    criteria.push({
      metric: 'plr',
      target: normalizeNumber(m[2]),
      operator: m[1] === '<' || m[1] === '<=' || m[1] === '≤' ? 'le' : 'gt',
      unit: 'dB',
    })
  }

  return criteria
}

export function evaluateNumericCriterion(
  criterion: NumericCriterion,
  measured: number,
): { cumple: boolean; diff: number; evidencia: string[] } {
  const tol = criterion.tolerance ?? 0
  const target = criterion.target
  let cumple = false
  let diff = measured - target

  switch (criterion.operator) {
    case 'approx':
      cumple = Math.abs(diff) <= tol + 1e-6
      break
    case 'eq':
      cumple = Math.abs(diff) <= 1e-6
      break
    case 'le':
      cumple = measured <= target + 1e-6
      break
    case 'lt':
      cumple = measured < target
      break
    case 'ge':
      cumple = measured >= target - 1e-6
      break
    case 'gt':
      cumple = measured > target
      break
  }

  const unit = criterion.unit ? ` ${criterion.unit}` : ''
  const evidencia = [
    `${criterion.metric}${criterion.track ? ` (${criterion.track})` : ''}: medido=${measured.toFixed(2)}${unit}, target=${target.toFixed(2)}${unit}${tol ? ` ±${tol}` : ''}, diff=${diff.toFixed(2)}${unit}`,
  ]

  return { cumple, diff, evidencia }
}
