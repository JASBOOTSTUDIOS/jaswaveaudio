export type QualityVerdict = 'pass' | 'warning' | 'fail'

export type QualityFinding = {
  verdict: QualityVerdict
  code: string
  message: string
}

export type QualityGateResult = {
  verdict: QualityVerdict
  findings: QualityFinding[]
}

export interface QualityGate<TInput> {
  evaluate(input: TInput): QualityGateResult
}
