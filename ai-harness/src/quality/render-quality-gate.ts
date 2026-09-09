import type { QualityGateResult, QualityVerdict } from './types'

export type RenderQualityInput = {
  requireListen?: boolean
  lastListen?: { ok: boolean; issues?: string[]; summary?: string } | null
  loudnessTarget?: 'streaming' | 'club' | 'cd'
  sectionsCovered?: boolean
  hasMidiClips?: boolean
  builtOrMutated?: boolean
}

export function evaluateRenderQuality(input: RenderQualityInput): QualityGateResult {
  const findings: QualityGateResult['findings'] = []
  if (
    input.requireListen &&
    input.sectionsCovered &&
    input.builtOrMutated &&
    input.hasMidiClips
  ) {
    const listen = input.lastListen
    if (!listen) {
      findings.push({
        verdict: 'fail',
        code: 'listen-missing',
        message: `Ejecuta render.start + analysis.compareTarget { target: "${input.loudnessTarget ?? 'streaming'}" }.`,
      })
    } else if (listen.ok === false) {
      findings.push({
        verdict: 'fail',
        code: 'listen-failed',
        message: `AudioListenReport no OK: ${listen.issues?.join('; ') || listen.summary || 'issues'}`,
      })
    }
  }
  const verdict: QualityVerdict = findings.length ? 'fail' : 'pass'
  return { verdict, findings }
}
