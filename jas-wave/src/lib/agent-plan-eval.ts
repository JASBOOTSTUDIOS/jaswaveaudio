/**
 * Contrasta plan.md con el DAW: lo planeado vs lo implementado.
 */

import type { DAWState } from '../../../shared/src/types/state'
import type { ProjectPlanData } from './project-plan'
import {
  DEFAULT_PLAN_MD,
  PLAN_SLUG,
  USER_NOTES_HEADING,
  getAgentDoc,
  getMarkdownSection,
  listAgentDocs,
  setMarkdownSection,
  writeAgentDoc,
} from './agent-docs'

export type PlanTask = {
  text: string
  done: boolean
  source: string
}

export type PlanEvaluation = {
  planned: number
  done: number
  missing: string[]
  extraTracks: string[]
  summary: string
  markdown: string
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function parseTasks(md: string): PlanTask[] {
  const tasks: PlanTask[] = []
  for (const heading of ['Por implementar', 'En curso', 'Implementado']) {
    const body = getMarkdownSection(md, heading)
    for (const line of body.split('\n')) {
      const m = /^\s*[-*]\s*\[( |x|X)\]\s+(.+?)\s*$/.exec(line)
      if (!m) continue
      tasks.push({
        text: m[2]!.trim(),
        done: heading === 'Implementado' || m[1] !== ' ',
        source: heading,
      })
    }
  }
  return tasks
}

function projectFacts(state: DAWState): string[] {
  const facts: string[] = []
  for (const t of state.project.tracks ?? []) {
    facts.push(t.nombre || t.id)
    for (const p of t.plugins ?? []) facts.push(p.nombre)
    for (const c of t.clips ?? []) {
      const n = (c as { nombre?: string }).nombre
      if (n) facts.push(n)
    }
  }
  return facts
}

function isSatisfied(task: string, facts: string[]): boolean {
  const nt = norm(task)
  if (!nt) return false
  return facts.some((f) => {
    const nf = norm(f)
    if (!nf) return false
    return nf === nt || nt.includes(nf) || nf.includes(nt)
  })
}

export function planMarkdownFromProjectPlan(plan: ProjectPlanData): string {
  const intent = [
    plan.pensamiento || `Producción «${plan.nombre}».`,
    `${plan.keyLabel} · ${plan.bpm} BPM · ${plan.minutes} min.`,
  ].join(' ')
  const todos = plan.tracks
    .map((t) => {
      const plug = t.pluginNombre ? ` · VST ${t.pluginNombre}` : ''
      const art = t.articulacion ? ` · ${t.articulacion}` : ''
      return `- [ ] Pista «${t.nombre}» (${t.rol}${plug}${art})`
    })
    .join('\n')
  return `# Plan: ${plan.nombre}

## Intención
${intent}

## Por implementar
${todos || '- [ ] (sin pistas aún)'}

## En curso

## Implementado

## Evaluación
Pendiente de ejecutar en el DAW. Puedes editar este archivo antes de aplicar.

## ${USER_NOTES_HEADING}
_Tus notas no se pisan automáticamente. Escríbelas aquí._
`
}

export function evaluatePlanAgainstDaw(md: string, state: DAWState): PlanEvaluation {
  const tasks = parseTasks(md)
  const facts = projectFacts(state)
  const unique = new Map<string, PlanTask>()
  for (const t of tasks) {
    const k = norm(t.text)
    if (!k) continue
    const prev = unique.get(k)
    if (!prev) unique.set(k, t)
    else if (t.done) unique.set(k, t)
  }
  const planned = [...unique.values()]
  const missing: string[] = []
  const doneItems: string[] = []
  for (const t of planned) {
    const ok = t.done || isSatisfied(t.text, facts)
    if (ok) doneItems.push(t.text)
    else missing.push(t.text)
  }
  const known = new Set(planned.map((t) => norm(t.text)))
  const extraTracks = (state.project.tracks ?? [])
    .map((t) => t.nombre)
    .filter((n) => n && ![...known].some((k) => k.includes(norm(n)) || norm(n).includes(k)))

  const intent = getMarkdownSection(md, 'Intención').trim()
  const now = new Date().toLocaleString()
  const ratio = planned.length ? `${doneItems.length}/${planned.length}` : '0/0'
  const summary =
    planned.length === 0
      ? 'El plan no tiene tareas con checkbox. Añade líneas `- [ ] …` en «Por implementar».'
      : missing.length === 0
        ? `Evaluación ${ratio}: lo planeado está cubierto en el DAW.`
        : `Evaluación ${ratio}. Falta: ${missing.slice(0, 6).join('; ')}${missing.length > 6 ? '…' : ''}`

  const evalBody = [
    `Última revisión: ${now}`,
    '',
    '### Intención vs ejecución',
    intent || '_Sin intención escrita._',
    '',
    `### Por implementar (${missing.length})`,
    missing.length ? missing.map((t) => `- ${t}`).join('\n') : '_Nada pendiente._',
    '',
    `### Implementado en el DAW (${doneItems.length}/${planned.length || 0})`,
    doneItems.length ? doneItems.map((t) => `- ${t}`).join('\n') : '_Aún no hay coincidencias en pistas/plugins/clips._',
    extraTracks.length ? `\nPistas en el DAW no listadas en el plan: ${extraTracks.join(', ')}.` : '',
    '',
    `| Planeado | En el DAW | Resultado |`,
    `| --- | --- | --- |`,
    ...planned.map((t) => {
      const ok = doneItems.includes(t.text)
      return `| ${t.text.replace(/\|/g, '/')} | ${ok ? 'sí' : 'no'} | ${ok ? 'ok' : 'pendiente'} |`
    }),
    '',
    summary,
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n')

  let next = md
  next = setMarkdownSection(
    next,
    'Por implementar',
    missing.length ? missing.map((t) => `- [ ] ${t}`).join('\n') : '_Nada pendiente._',
  )
  next = setMarkdownSection(
    next,
    'Implementado',
    doneItems.length ? doneItems.map((t) => `- [x] ${t}`).join('\n') : '_Aún no hay ítems implementados._',
  )
  next = setMarkdownSection(next, 'Evaluación', evalBody)

  return {
    planned: planned.length,
    done: doneItems.length,
    missing,
    extraTracks,
    summary,
    markdown: next,
  }
}

export function syncPlanAfterDawChange(projectId: string, state: DAWState): PlanEvaluation | null {
  const doc = getAgentDoc(projectId, PLAN_SLUG)
  if (!doc) return null
  if (doc.content.trim() === DEFAULT_PLAN_MD.trim() && parseTasks(doc.content).every((t) => t.text.includes('añade tareas'))) {
    return null
  }
  const ev = evaluatePlanAgainstDaw(doc.content, state)
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
    parseTasks(existing.content).every((t) => /añade tareas/i.test(t.text))
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
