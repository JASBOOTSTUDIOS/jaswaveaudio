/**
 * Profundidad adaptativa 2–10: el modelo decide en la capa `normalize`.
 * Las heurísticas solo actúan como respaldo si el modelo no emite <<<INTENT>>>.
 */

import type { AgentMode } from './modes'
import {
  isProjectAuditIntent,
  isSongRefineIntent,
  isStyleGapIntent,
  isTempoOnlyRefine,
  wantsFullProject,
  wantsWebResearch,
} from './modes'
import type { ReasoningPhase } from './reasoning-prompts'

export const REASONING_MIN_STEPS = 2
export const REASONING_MAX_STEPS = 10

export type ReasoningDepthPlan = {
  depth: number
  phases: ReasoningPhase[]
  reason: string
}

/** Intent estructurado que emite la capa normalize. */
export type ModelIntentBrief = {
  promptCanonico: string
  intent: string
  depth: number
  depthReason?: string
  aliasesMapped?: Array<{ from: string; to: string }>
  modeHint?: AgentMode
  entities?: Record<string, unknown>
  raw?: Record<string, unknown>
}

/**
 * Capas tras normalize, por profundidad total N (incluye normalize + commit).
 * normalize siempre es la 1ª; commit siempre la última.
 */
const DEPTH_PHASES: Record<number, ReasoningPhase[]> = {
  2: ['normalize', 'commit'],
  3: ['normalize', 'research1', 'commit'],
  4: ['normalize', 'frame', 'research1', 'commit'],
  5: ['normalize', 'frame', 'research1', 'synthesize', 'commit'],
  6: ['normalize', 'frame', 'research1', 'critique', 'synthesize', 'commit'],
  7: ['normalize', 'frame', 'research1', 'critique', 'research2', 'synthesize', 'commit'],
  8: ['normalize', 'frame', 'explore', 'research1', 'critique', 'synthesize', 'verify', 'commit'],
  9: [
    'normalize',
    'frame',
    'explore',
    'research1',
    'critique',
    'research2',
    'synthesize',
    'verify',
    'commit',
  ],
  10: [
    'normalize',
    'frame',
    'explore',
    'research1',
    'critique',
    'research2',
    'stress',
    'synthesize',
    'verify',
    'commit',
  ],
}

export function clampReasoningDepth(n: number): number {
  return Math.max(REASONING_MIN_STEPS, Math.min(REASONING_MAX_STEPS, Math.round(n)))
}

export function phasesForDepth(depth: number): ReasoningPhase[] {
  const d = clampReasoningDepth(depth)
  return [...(DEPTH_PHASES[d] ?? DEPTH_PHASES[5]!)]
}

/** Capas que faltan después de haber corrido `normalize`. */
export function remainingPhasesAfterNormalize(totalDepth: number): ReasoningPhase[] {
  const all = phasesForDepth(totalDepth)
  return all.slice(1)
}

function isClarificationOrTrackPick(text: string): boolean {
  return (
    /\[Respuestas a clarificaci[oó]n\]/i.test(text) ||
    /\[track_pick\]/i.test(text) ||
    /\(id=[\w-]+\)/i.test(text)
  )
}

function isAffirmativeShort(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 80) return false
  return /^(s[ií]|ok|vale|dale|hazlo|cr[eé]alo|aplica(lo)?|construir|construye|adelante|go|yes|do it)[\s!.]*$/i.test(
    t,
  )
}

function isSimpleTransportOrTrackToggle(text: string): boolean {
  const t = text.trim()
  if (t.length > 120) return false
  return (
    /\b(mute|unmute|solo|unsolo|arm(a|ar)?|play|stop|pausa|pause|loop|metr[oó]nomo|seek)\b/i.test(
      t,
    ) ||
    /^(silencia|activa solo|quita solo|arma|desarma)\b/i.test(t)
  )
}

function isSimpleBpmOnly(text: string): boolean {
  if (!isTempoOnlyRefine(text) && !/\b(\d{2,3})\s*bpm\b/i.test(text)) return false
  return !/\b(canci[oó]n|musicBuild|arreglo|estructura|pistas?|instrument)/i.test(text)
}

function isSingleClipEdit(text: string): boolean {
  return (
    /\b(edit(a|ar|ame)?|modifica|cambia|ajusta|arregla|mejora)\b/i.test(text) &&
    /\b(clip|comp[aá]s|bar(ra)?|nota|fill|hi-?hat|kick|snare|bater[ií]a|bajo|piano|pad)\b/i.test(
      text,
    ) &&
    !wantsFullProject(text)
  )
}

function isShortAsk(text: string, mode: AgentMode): boolean {
  if (mode !== 'ask' && !/\?/.test(text)) return false
  const words = text.trim().split(/\s+/).length
  return words <= 18 && !isProjectAuditIntent(text) && !wantsFullProject(text)
}

function isCriticalComplexity(text: string, mode: AgentMode): boolean {
  if (isProjectAuditIntent(text) || isStyleGapIntent(text) || wantsWebResearch(text)) return true
  if (wantsFullProject(text) && !isTempoOnlyRefine(text)) return true
  if (mode === 'think' && wantsFullProject(text)) return true
  if (
    /\b(multi-?pista|varias pistas|toda la canci|arreglo completo|desde cero|sidechain|cadena fx completa)\b/i.test(
      text,
    )
  ) {
    return true
  }
  if (/\b(ambig|no s[eé] cu[aá]l|varias opciones|elige entre)\b/i.test(text)) return true
  return false
}

/** Respaldo local si el modelo no elige profundidad. */
export function estimateReasoningDepth(userText: string, mode: AgentMode): ReasoningDepthPlan {
  const text = userText.trim()

  if (isClarificationOrTrackPick(text) || isAffirmativeShort(text)) {
    return { depth: 2, phases: phasesForDepth(2), reason: 'confirmación / clarificación ya resuelta' }
  }
  if (isSimpleTransportOrTrackToggle(text) || isSimpleBpmOnly(text)) {
    return { depth: 2, phases: phasesForDepth(2), reason: 'acción simple (transporte/BPM/mute)' }
  }
  if (isShortAsk(text, mode)) {
    return { depth: 3, phases: phasesForDepth(3), reason: 'consulta corta' }
  }
  if (isSingleClipEdit(text) || (isSongRefineIntent(text) && isTempoOnlyRefine(text))) {
    return { depth: 4, phases: phasesForDepth(4), reason: 'edición acotada / tempo' }
  }
  if (mode === 'ask' && !isProjectAuditIntent(text) && !isStyleGapIntent(text) && !wantsWebResearch(text)) {
    return { depth: 5, phases: phasesForDepth(5), reason: 'consulta con contexto' }
  }
  if (isSongRefineIntent(text) && !isTempoOnlyRefine(text)) {
    return { depth: 6, phases: phasesForDepth(6), reason: 'refinar estilo/feel' }
  }
  if (isCriticalComplexity(text, mode)) {
    const heavy =
      isProjectAuditIntent(text) ||
      isStyleGapIntent(text) ||
      wantsWebResearch(text) ||
      /\b(desde cero|arreglo completo|multi)/i.test(text) ||
      mode === 'think'
    const depth = isStyleGapIntent(text) || wantsWebResearch(text) ? 9 : heavy ? 10 : 8
    return {
      depth,
      phases: phasesForDepth(depth),
      reason: isStyleGapIntent(text)
        ? 'gap de estilo / referencia artística'
        : wantsWebResearch(text)
          ? 'investigación web + análisis'
          : heavy
            ? 'tarea crítica / auditoría o arreglo grande'
            : 'creación compleja',
    }
  }
  if (wantsFullProject(text) || mode === 'create' || mode === 'think') {
    return { depth: 7, phases: phasesForDepth(7), reason: 'creación / plan estándar' }
  }
  if (mode === 'plan') {
    return { depth: 6, phases: phasesForDepth(6), reason: 'planificación' }
  }
  return { depth: 5, phases: phasesForDepth(5), reason: 'complejidad media' }
}

export function planReasoningPhases(
  userText: string,
  mode: AgentMode,
  override?: ReasoningPhase[],
): ReasoningDepthPlan {
  if (override?.length) {
    const phases = override.slice(0, REASONING_MAX_STEPS)
    if (phases.length < REASONING_MIN_STEPS) {
      const filled = [...phases]
      if (!filled.includes('normalize') && !filled.includes('sense')) filled.unshift('normalize')
      if (!filled.includes('commit')) filled.push('commit')
      return {
        depth: clampReasoningDepth(filled.length),
        phases: filled.slice(0, REASONING_MAX_STEPS),
        reason: 'override (completado a mínimo 2)',
      }
    }
    return { depth: phases.length, phases, reason: 'override explícito' }
  }
  return estimateReasoningDepth(userText, mode)
}

const INTENT_RE = /<<<INTENT\s*([\s\S]*?)\s*INTENT>>>/i

function parseJsonLoose(raw: string): unknown {
  let t = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  try {
    return JSON.parse(t)
  } catch {
    const start = t.indexOf('{')
    const end = t.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function asModeHint(v: unknown): AgentMode | undefined {
  const s = String(v ?? '').toLowerCase()
  if (s === 'ask' || s === 'plan' || s === 'create' || s === 'think' || s === 'auto') return s
  return undefined
}

/**
 * Extrae el bloque <<<INTENT … INTENT>>> de la capa normalize.
 * Acepta claves en español o inglés.
 */
export function parseModelIntentBrief(text: string, fallbackUserText: string): ModelIntentBrief | null {
  const m = INTENT_RE.exec(text)
  if (!m) return null
  const parsed = parseJsonLoose(m[1]!)
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>

  const promptCanonico = String(
    o.promptCanonico ?? o.prompt_canonico ?? o.canonicalPrompt ?? o.prompt ?? o.pedido ?? '',
  ).trim()
  const intent = String(o.intent ?? o.intencion ?? o.tipo ?? 'unknown').trim() || 'unknown'
  const depthRaw = Number(o.depth ?? o.profundidad ?? o.capas ?? o.steps ?? NaN)
  const depth = Number.isFinite(depthRaw) ? clampReasoningDepth(depthRaw) : NaN
  if (!promptCanonico || !Number.isFinite(depth)) return null

  const aliasesRaw = o.aliasesMapped ?? o.aliases ?? o.traducciones
  const aliasesMapped: ModelIntentBrief['aliasesMapped'] = []
  if (Array.isArray(aliasesRaw)) {
    for (const a of aliasesRaw) {
      if (!a || typeof a !== 'object') continue
      const row = a as Record<string, unknown>
      const from = String(row.from ?? row.de ?? row.usuario ?? '').trim()
      const to = String(row.to ?? row.a ?? row.canon ?? row.sistema ?? '').trim()
      if (from && to) aliasesMapped.push({ from, to })
    }
  }

  const entities =
    o.entities && typeof o.entities === 'object'
      ? (o.entities as Record<string, unknown>)
      : o.entidades && typeof o.entidades === 'object'
        ? (o.entidades as Record<string, unknown>)
        : undefined

  return {
    promptCanonico: promptCanonico || fallbackUserText,
    intent,
    depth,
    depthReason: String(o.depthReason ?? o.razon ?? o.reason ?? '').trim() || undefined,
    aliasesMapped: aliasesMapped.length ? aliasesMapped : undefined,
    modeHint: asModeHint(o.modeHint ?? o.modo ?? o.mode),
    entities,
    raw: o,
  }
}

export function stripIntentBlock(text: string): string {
  return text.replace(INTENT_RE, '').replace(/\n{3,}/g, '\n\n').trim()
}
