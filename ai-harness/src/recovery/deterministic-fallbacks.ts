/**
 * Fallbacks deterministas (sin decisión creativa).
 */

import {
  inferBpmFromTempoIntent,
  isTempoOnlyRefine,
  parseExplicitBpm,
  parseExplicitTimeSignature,
} from '../agent/modes'
import { forcePreviewAplicar } from '../agent/action-policy'
import type { HarnessDawAction } from '../types/actions'

export type DeterministicFallbackInput = {
  userText: string
  currentBpm?: number
  mode?: 'auto' | 'ask' | 'plan' | 'create' | 'think'
}

export function deterministicFallbacksFromUserIntent(
  input: DeterministicFallbackInput,
): HarnessDawAction[] {
  const actions: HarnessDawAction[] = []
  const userText = input.userText
  const lower = userText.toLowerCase()
  const mode = input.mode ?? 'auto'

  const bpmMatch = parseExplicitBpm(userText)
  if (bpmMatch != null) {
    actions.push({ type: 'project.setBpm', payload: { bpm: bpmMatch } })
  } else {
    const inferred = inferBpmFromTempoIntent(userText, input.currentBpm ?? 120)
    if (inferred != null) {
      actions.push({ type: 'project.setBpm', payload: { bpm: inferred } })
    }
  }
  const ts = parseExplicitTimeSignature(userText)
  if (ts) {
    actions.push({ type: 'project.setTimeSignature', payload: ts })
  }

  if (isTempoOnlyRefine(userText) && actions.some((a) => a.type === 'project.setBpm')) {
    return forcePreviewAplicar(actions, 'create')
  }

  const zoomMatch = lower.match(/zoom\s*(?:a|de|=|:|horizontal)?\s*(\d+(?:[.,]\d+)?)/)
  if (zoomMatch || /acercar|alejar|zoom\s+in|zoom\s+out/i.test(lower)) {
    let z = zoomMatch ? parseFloat(zoomMatch[1]!.replace(',', '.')) : undefined
    if (z == null) {
      if (/alejar|zoom\s+out|menos zoom/i.test(lower)) z = 0.5
      else z = 2
    }
    actions.push({
      type: 'ui.setZoom',
      payload: { horizontal: Math.min(256, Math.max(0.15, z)) },
    })
  }

  if (/evalu[aá](r|cion)?\s*(el )?plan|plan\.md.*(vs|contra|evalu)|compara(r)? (el )?plan/i.test(lower)) {
    actions.push({ type: 'doc.evaluate', payload: {} })
  }

  return forcePreviewAplicar(actions, mode)
}

/** Pedidos creativos: el fallback NO debe inventar musicBuild / generateMidi. */
export function isCreativeGenerationRequest(text: string): boolean {
  return (
    /\b(cr[eé]a(r|me)?|genera|arm[aá]|produce|construy)\b/i.test(text) &&
    /\b(canci[oó]n|tema|song|proyecto|arreglo)\b/i.test(text)
  )
}
