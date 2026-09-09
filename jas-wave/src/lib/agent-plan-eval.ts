/**
 * Adaptador jas-wave → @jaswave/ai-harness (persistencia plan.md vía agent-docs).
 */

export type {
  PlanEvaluation,
  PlanTask,
  PlanTaskCheck,
  PlanTaskKind,
  ProjectPlanData,
  ProjectPlanTrack,
} from '@jaswave/ai-harness'

export {
  DEFAULT_PLAN_MD,
  PLAN_SLUG,
  USER_NOTES_HEADING,
  classifyPlanTask,
  evaluatePlanAgainstDaw,
  evaluatePlanTask,
  getMarkdownSection,
  parsePlanTasks,
  planMarkdownFromProjectPlan,
  setMarkdownSection,
  type PlanEvalContext,
} from '@jaswave/ai-harness'

import type { DAWState } from '../../../shared/src/types/state'
import {
  DEFAULT_PLAN_MD,
  PLAN_SLUG,
  evaluatePlanAgainstDaw,
  getMarkdownSection,
  parsePlanTasks,
  planMarkdownFromProjectPlan,
  setMarkdownSection,
  type PlanEvaluation,
  type PlanEvalContext,
} from '@jaswave/ai-harness'
import type { ProjectPlanData } from './project-plan'
import { getAgentDoc, listAgentDocs, writeAgentDoc } from './agent-docs'
import {
  isAffirmativeBuildIntent,
  isGreetingOrChitchat,
  isProjectStatusQuestion,
} from './ai-clarify'

export function syncPlanAfterDawChange(
  projectId: string,
  state: DAWState,
  ctx?: PlanEvalContext,
): PlanEvaluation | null {
  const doc = getAgentDoc(projectId, PLAN_SLUG)
  if (!doc) return null
  if (
    doc.content.trim() === DEFAULT_PLAN_MD.trim() &&
    parsePlanTasks(doc.content).every((t) => /añade tareas|tareas concretas/i.test(t.text))
  ) {
    return null
  }
  const ev = evaluatePlanAgainstDaw(doc.content, state, ctx)
  writeAgentDoc(projectId, PLAN_SLUG, ev.markdown, { origin: 'ai', preserveUserNotes: true })
  return ev
}

export function ensurePlanFromCompose(
  projectId: string,
  plan: ProjectPlanData,
  opts?: { force?: boolean },
): void {
  const existing = getAgentDoc(projectId, PLAN_SLUG)
  const emptyish =
    !existing ||
    existing.content.trim() === DEFAULT_PLAN_MD.trim() ||
    parsePlanTasks(existing.content).every((t) => /añade tareas|tareas concretas/i.test(t.text))
  if (opts?.force || emptyish) {
    writeAgentDoc(projectId, PLAN_SLUG, planMarkdownFromProjectPlan(plan), {
      origin: 'ai',
      preserveUserNotes: true,
    })
  }
}

export function listDocSlugs(projectId: string): string[] {
  return listAgentDocs(projectId).map((d) => d.slug)
}

function normPlanText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const PLAN_WORK_RE =
  /\b(crea|cr[eé]ame|creame|genera|hazme|arm[aá]|a[nñ]ade|agrega|cambia|quita|borra|limpia|mezcla|bpm|pista|clip|midi|bater|drum|canci[oó]n|tema|groove|toms?|pad|bajo|guitar|piano|lead|intro|verso|coro|mix|eq|reverb|sidechain|bounce|export|master|vst|plugin|tempo|tonalidad|cuantiz|humaniz|arregla|arreglo|mejora|suaviz|energ[ií]a|lento|r[aá]pid)\b/i

/** Órdenes de UI / meta-plan: no deben contaminar Intención ni «Por implementar». */
function isMetaPlanControlMessage(text: string): boolean {
  const t = text.trim()
  if (/^Implementa SOLO (la secci[oó]n|esta tarea)/i.test(t)) return true
  if (/^Ejecuta (YA )?esta tarea del plan/i.test(t)) return true
  if (/^Ejecuta en el DAW lo descrito en/i.test(t)) return true
  if (/^La secci[oó]n «.+» del plan est[aá] vac[ií]a/i.test(t)) return true
  if (/^(actualiza|limpia|reescribe|corrige)\s+(el\s+)?plan\b/i.test(t)) return true
  if (/^contin[uú]a\.?$/i.test(t)) return true
  return false
}

function shouldAbsorbPlanRequest(text: string): boolean {
  const t = text.trim()
  if (t.length < 8) return false
  if (/^\[Respuestas a clarificación\]/i.test(t)) return false
  if (isMetaPlanControlMessage(t)) return false
  if (isGreetingOrChitchat(t) || isProjectStatusQuestion(t) || isAffirmativeBuildIntent(t)) return false
  const actionVerb =
    /\b(crea|cr[eé]ame|creame|genera|hazme|arm[aá]|a[nñ]ade|agrega|cambia|quita|borra|limpia|arregla|mejora|haz|pon|sube|baja)\b/i.test(
      t,
    )
  if (/\?\s*$/.test(t) && !actionVerb && t.length < 80) return false
  return PLAN_WORK_RE.test(t) || t.length >= 80
}

function replaceIntentWithRequest(intent: string, snippet: string): string {
  const withoutLast = intent.replace(/\n*### Último pedido\n[\s\S]*$/i, '').trim()
  const busca = /### Qué se busca\n([\s\S]*?)(?=\n### |\s*$)/i.exec(withoutLast)
  const buscaBody = (busca?.[1] ?? withoutLast).trim()
  const placeholder =
    !buscaBody ||
    /^_/.test(buscaBody) ||
    /reescribe en cada pedido|Actualízalo en cada pedido/i.test(buscaBody)
  if (placeholder) {
    return [
      '### Qué se busca',
      snippet,
      '',
      '### Forma',
      '_Por definir con el arreglo._',
      '',
      '### Pistas previstas',
      '_Por definir._',
      '',
      '### Último pedido',
      snippet,
    ].join('\n')
  }
  return `${withoutLast}\n\n### Último pedido\n${snippet}`
}

/** Puro: incorpora el pedido al markdown del plan (intención + tarea). */
export function applyUserRequestToPlanMd(md: string, userText: string): string | null {
  if (!shouldAbsorbPlanRequest(userText)) return null
  const snippet = userText.replace(/\s+/g, ' ').trim().slice(0, 240)
  let next = md || DEFAULT_PLAN_MD

  next = setMarkdownSection(
    next,
    'Intención',
    replaceIntentWithRequest(getMarkdownSection(next, 'Intención'), snippet),
  )

  const pending = getMarkdownSection(next, 'Por implementar')
  const nPending = normPlanText(pending)
  const nSnip = normPlanText(snippet)
  const already =
    Boolean(nPending && nSnip) &&
    (nPending.includes(nSnip.slice(0, 48)) || nSnip.includes(nPending.slice(0, 48)))
  if (!already) {
    const cleaned = pending
      .split('\n')
      .filter((l) => !/tareas concretas|añade tareas/i.test(l) && !/^\s*[-*]\s*\[[ xX]?\]\s*\(/.test(l))
      .join('\n')
      .trim()
    next = setMarkdownSection(next, 'Por implementar', [cleaned, `- [ ] ${snippet}`].filter(Boolean).join('\n'))
  }
  return next
}

/** Incorpora el pedido del usuario al plan.md (intención + tarea) antes de que la IA actúe. */
export function absorbUserRequestIntoPlan(projectId: string, userText: string): boolean {
  const existing = getAgentDoc(projectId, PLAN_SLUG)
  const next = applyUserRequestToPlanMd(existing?.content || DEFAULT_PLAN_MD, userText)
  if (!next) return false
  writeAgentDoc(projectId, PLAN_SLUG, next, { origin: 'ai', preserveUserNotes: true })
  return true
}
