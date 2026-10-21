/**
 * Parser de criterios medibles para A9 - audit.step.
 *
 * Interpreta criterios del plan como:
 *   - "LUFS -14 ±1", "LUFS -14 +/- 1"
 *   - "TP <= -1", "TP ≤ -1"
 *   - "kick -18 ±3 dBFS RMS", "pista Bajo -18 +/-3 RMS"
 *   - "sin masking kick/bajo"
 *   - "PLR <= 12"
 *
 * Regla: el signo "-" pegado al número es parte del valor; separado por
 * espacio se interpreta igualmente como signo (evita perder el negativo).
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

/** Números con signo, coma o punto decimal. */
const NUM = '(-?\\d+(?:[.,]\\d+)?)'

function normalizeNumber(raw: string): number {
  const cleaned = raw.replace(/\s+/g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

function toOperator(op: string): NumericCriterion['operator'] {
  switch (op) {
    case '<=':
    case '≤':
      return 'le'
    case '<':
      return 'lt'
    case '>=':
    case '≥':
      return 'ge'
    case '>':
      return 'gt'
    case '≈':
    case '~':
      return 'approx'
    default:
      return 'eq'
  }
}

export function parseCriteria(criteriaText: string): ParsedCriteria {
  if (!criteriaText || criteriaText.trim().length === 0) {
    return []
  }

  const text = criteriaText.toLowerCase()
  const criteria: ParsedCriteria = []

  // LUFS: "LUFS -14 ±1", "LUFS -14 +/- 1", "LUFS ≈ -14"
  const lufsRegex = new RegExp(`lufs\\s*(?:≈|~)?\\s*${NUM}\\s*(?:±|\\+/-)\\s*(\\d+(?:[.,]\\d+)?)`, 'gi')
  for (const m of text.matchAll(lufsRegex)) {
    criteria.push({
      metric: 'lufs',
      target: normalizeNumber(m[1]),
      tolerance: normalizeNumber(m[2]),
      operator: 'approx',
      unit: 'LUFS',
    })
  }

  // True Peak: "TP <= -1", "TP ≤ -1", "TP > -0.5"
  const tpRegex = new RegExp(`\\btp\\s*(<=|<|>=|>|≤|≥)\\s*${NUM}`, 'gi')
  for (const m of text.matchAll(tpRegex)) {
    criteria.push({
      metric: 'tp',
      target: normalizeNumber(m[2]),
      operator: toOperator(m[1]),
      unit: 'dBTP',
    })
  }

  // RMS por pista: "kick -18 ±3 dBFS RMS", "pista Bajo -18 +/-3 RMS"
  const rmsTrackRegex = new RegExp(
    `(pista\\s+[\\w\\u00C0-\\u024F]+|track\\s+[\\w\\u00C0-\\u024F]+|kick|snare|clap|hat|hihat|bass|bajo|sub|lead|pad|vox|voz|vocal|guitar|piano)\\s*${NUM}\\s*(?:±|\\+/-)\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:dBFS\\s*)?rms`,
    'gi',
  )
  for (const m of text.matchAll(rmsTrackRegex)) {
    const track = m[1].replace(/^pista\s+/i, '').replace(/^track\s+/i, '').trim()
    criteria.push({
      metric: 'rms',
      target: normalizeNumber(m[2]),
      tolerance: normalizeNumber(m[3]),
      operator: 'approx',
      unit: 'dBFS',
      track,
    })
  }

  // RMS genérico: "RMS -18 ±3"
  const rmsRegex = new RegExp(`\\brms\\s*${NUM}\\s*(?:±|\\+/-)\\s*(\\d+(?:[.,]\\d+)?)`, 'gi')
  for (const m of text.matchAll(rmsRegex)) {
    const target = normalizeNumber(m[1])
    const yaCubierto = criteria.some(
      (c) => c.metric === 'rms' && Math.abs((c as NumericCriterion).target - target) < 0.01,
    )
    if (!yaCubierto) {
      criteria.push({
        metric: 'rms',
        target,
        tolerance: normalizeNumber(m[2]),
        operator: 'approx',
        unit: 'dBFS',
      })
    }
  }

  // Masking: "sin masking kick/bajo", "no masking"
  const maskingRegex = /(sin|no)\s+masking(?:\s+([^,.;]+))?/gi
  for (const m of text.matchAll(maskingRegex)) {
    const desc = m[2] ? `sin masking ${m[2].trim()}` : 'sin masking'
    criteria.push({
      metric: 'masking',
      requires: false,
      description: desc,
    })
  }

  // PLR / rango dinámico
  const plrRegex = new RegExp(`\\bplr\\s*(<=|<|>=|>|≤|≥)\\s*${NUM}`, 'gi')
  for (const m of text.matchAll(plrRegex)) {
    criteria.push({
      metric: 'plr',
      target: normalizeNumber(m[2]),
      operator: toOperator(m[1]),
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
  const diff = measured - target
  let cumple = false

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
  const rango = criterion.operator === 'approx' ? ` ±${tol}` : ''
  const evidencia = [
    `${criterion.metric}${criterion.track ? ` (${criterion.track})` : ''}: medido=${measured.toFixed(2)}${unit}, target=${target.toFixed(2)}${unit}${rango}, diff=${diff.toFixed(2)}${unit}`,
  ]

  return { cumple, diff, evidencia }
}
