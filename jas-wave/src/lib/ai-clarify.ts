/**
 * Clarificaciones estructuradas: SOLO desde el bloque <<<CLARIFY>>> del modelo.
 * El cliente no inventa preguntas ni opciones estáticas.
 */

import { isSongRefineIntent, isTempoOnlyRefine } from '@jaswave/ai-harness'

export type ClarificationQuestion = {
  id: string
  question: string
  /** Opciones que inventó el modelo para esta pregunta (≥2) */
  options: string[]
  allowCustom?: boolean
  /** true = checkboxes (varias); false = una sola (botones) */
  multi?: boolean
}

export type ClarificationAnswer = {
  id: string
  optionIndexes: number[]
  value: string
}

const CLARIFY_RE = /<<<CLARIFY\s*([\s\S]*?)\s*CLARIFY>>>/i

function normalizeQuestion(o: Record<string, unknown>, i: number): ClarificationQuestion | null {
  const question = String(o.question ?? o.q ?? '').trim()
  if (!question) return null
  const optsRaw = o.options ?? o.choices ?? o.opciones
  const options = Array.isArray(optsRaw)
    ? optsRaw.map((x) => String(x).trim()).filter(Boolean)
    : []
  // Sin options del modelo → no hay tarjeta (no rellenamos defaults)
  if (options.length < 2) return null
  const multiHint =
    o.multi === true ||
    o.multiple === true ||
    o.selection === 'multiple' ||
    o.tipo === 'multiple' ||
    /cu[aá]les|todas las que|varios|selecciona.*(y|,)|instrumentos que/i.test(question)
  return {
    id: String(o.id ?? `q${i + 1}`),
    question,
    options: options.slice(0, 12),
    allowCustom: o.allowCustom !== false && o.custom !== false,
    multi: multiHint,
  }
}

/** Intenta recuperar JSON de CLARIFY aunque venga con basura alrededor. */
function parseClarifyJson(rawInner: string): unknown {
  let raw = rawInner.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('[')
    const end = raw.lastIndexOf(']')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * Única fuente de preguntas UI: bloque del modelo
 * <<<CLARIFY [ { id, question, options[], multi?, allowCustom? }, … ] CLARIFY>>>
 */
export function parseClarificationsFromText(text: string): ClarificationQuestion[] {
  const match = CLARIFY_RE.exec(text)
  if (!match) return []
  const parsed = parseClarifyJson(match[1]!)
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((q, i) => (q && typeof q === 'object' ? normalizeQuestion(q as Record<string, unknown>, i) : null))
    .filter((x): x is ClarificationQuestion => Boolean(x))
    .slice(0, 8)
}

/** Alias: solo el bloque del modelo (sin opciones inventadas en cliente). */
export function resolveClarificationsFromAssistant(text: string): ClarificationQuestion[] {
  return parseClarificationsFromText(text)
}

export function stripClarificationsBlock(text: string): string {
  return text.replace(CLARIFY_RE, '').replace(/\n{3,}/g, '\n\n').trim()
}

/** Quita el bloque CLARIFY del texto visible (la UI ya muestra la tarjeta). */
export function stripProseClarifyLists(text: string): string {
  return stripClarificationsBlock(text)
}

export function formatClarificationAnswersForPrompt(
  questions: ClarificationQuestion[],
  answers: ClarificationAnswer[],
  formCustom?: string,
): string {
  const lines = ['[Respuestas a clarificación]']
  const isMidiAudit = questions.some((q) => q.id === 'midi_audit_fix')
  const isTrackPick = questions.some((q) => q.id === 'track_pick')
  for (const q of questions) {
    const a = answers.find((x) => x.id === q.id)
    if (!a?.value.trim()) continue
    if (isMidiAudit || isTrackPick) lines.push(`- [${q.id}] ${q.question}`)
    else lines.push(`- ${q.question}`)
    lines.push(`  → ${a.value.trim()}`)
  }
  if (formCustom?.trim()) {
    lines.push('- Nota / respuesta personalizada del usuario')
    lines.push(`  → ${formCustom.trim()}`)
  }
  lines.push('')
  if (isTrackPick) {
    lines.push(
      'OBLIGATORIO: usa el trackId/pistaId indicado en TODAS las acciones MIDI de este turno.',
    )
    lines.push(
      'Para editar SOLO una sección del clip: midi.notes.patch { pistaId, clipId, rangeStart, rangeEnd, notas } o midi.clip.md.apply con rangeStart/rangeEnd (beats). NO reemplaces el clip entero si solo pidió una parte.',
    )
    lines.push('PROHIBIDO: track.create, daw.musicBuild u otro <<<CLARIFY>>>.')
    return lines.join('\n')
  }
  if (isMidiAudit) {
    lines.push(
      'OBLIGATORIO: ejecutar remediación MIDI (midi.notes.dedupe) según la opción elegida. PROHIBIDO daw.musicBuild ni más preguntas.',
    )
  } else {
    lines.push(
      'OBLIGATORIO ahora: un único bloque <<<ACTIONS [{"type":"daw.musicBuild","payload":{"aplicar":true,"prompt":"<resumen>","bpm":120,"minutos":N,"genero":"...","midiSource":"ai"}}] ACTIONS>>>.',
    )
    lines.push('PROHIBIDO: <<<CLARIFY>>>, más preguntas, o ACTIONS inventadas tipo plan.md:setBpm.')
  }
  return lines.join('\n')
}

export function isClarificationReply(text: string): boolean {
  return /\[Respuestas a clarificaci[oó]n\]/i.test(text)
}

export function isMidiAuditFixReply(text: string): boolean {
  return (
    /midi_audit_fix/i.test(text) ||
    /Aplicar:\s*quitar todos los duplicados/i.test(text) ||
    /Arr[eé]glalo todo lo posible ahora/i.test(text) ||
    (/\[Respuestas a clarificaci[oó]n\]/i.test(text) && /duplicad/i.test(text))
  )
}

export function isMidiAuditSkipFixReply(text: string): boolean {
  return /Solo el informe \(no tocar el DAW\)/i.test(text)
}

export function isTrackPickClarificationReply(text: string): boolean {
  return (
    /\[Respuestas a clarificaci[oó]n\]/i.test(text) &&
    (/\[track_pick\]/i.test(text) || /\(id=[\w-]+\)/i.test(text))
  )
}

export function mustForceMusicBuild(text: string): boolean {
  if (isMidiAuditFixReply(text) || isMidiAuditSkipFixReply(text) || isTrackPickClarificationReply(text)) {
    return false
  }
  if (isClarificationReply(text) || isAffirmativeBuildIntent(text)) return true
  // Refinar canción (sublime/estilo): forzar ACTIONS, no otra ronda de preguntas
  if (isSongRefineIntent(text) && !isTempoOnlyRefine(text)) return true
  return false
}

/** El modelo pidió al usuario que escriba opciones (fallo de protocolo). */
export function assistantAskedUserToWriteOptions(text: string): boolean {
  return /escribe(s)?\s+las?\s+\d*\s*opciones|proporciona(me)?\s+las?\s+opciones|ahora,?\s+por\s+favor,?\s+escribe|necesito una lista de \d+ opciones/i.test(
    text,
  )
}

export function extractMinutesFromClarifyText(text: string): number | undefined {
  const m =
    text.match(/→\s*~?\s*(\d+(?:[.,]\d+)?)\s*min/i) ||
    text.match(/duraci[oó]n[^\n]*→\s*~?\s*(\d+(?:[.,]\d+)?)/i) ||
    text.match(/\b(\d+(?:[.,]\d+)?)\s*minutos?\b/i)
  if (!m) return undefined
  const n = parseFloat(m[1]!.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.min(12, n) : undefined
}

export function extractGenreFromClarifyText(text: string): string | undefined {
  const m = text.match(/(?:tipo de m[uú]sica|g[eé]nero)[^\n]*\n\s*→\s*([^\n]+)/i)
  if (m) return m[1]!.trim().slice(0, 64)
  if (/\bambient\b/i.test(text)) return 'ambient'
  if (/\bfolk\b/i.test(text)) return 'folk'
  if (/\bpop\b/i.test(text)) return 'pop'
  return undefined
}

export function isAffirmativeBuildIntent(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false
  if (
    /^(s[ií]|ok|vale|dale|hazlo|cr[eé]alo|aplica|construir|adelante|go|yes|do it)[\s!.]*$/i.test(t)
  ) {
    return true
  }
  return /\b(hazlo|cr[eé]alo|aplica(lo)? ya|construir ahora|adelante|si hazlo|sí hazlo)\b/i.test(t)
}
