/**
 * Evaluación plan.md ↔ DAW (sin persistencia — puro dominio).
 */

import type { DAWState } from '@jaswave/shared'
import { getMarkdownSection, setMarkdownSection, USER_NOTES_HEADING } from './markdown'
import type { PlanEvalContext } from './eval-context'
import type {
  PlanEvaluation,
  PlanTask,
  PlanTaskCheck,
  PlanTaskKind,
  ProjectPlanData,
} from './types'

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function parsePlanTasks(md: string): PlanTask[] {
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

function clipNoteCount(clip: unknown): number {
  const c = clip as { notas?: unknown[]; notes?: unknown[] }
  const n = c.notas ?? c.notes
  return Array.isArray(n) ? n.length : 0
}

function findTrackByName(state: DAWState, nameHint: string) {
  const nh = norm(nameHint)
  if (!nh) return undefined
  return (state.project?.tracks ?? []).find((t) => {
    const n = norm(t.nombre || t.id)
    return n === nh || n.includes(nh) || nh.includes(n)
  })
}

function extractQuotedName(task: string): string | null {
  const m =
    /[«"']([^»"']+)[»"']/.exec(task) ||
    /pista\s+[«"']?([^»"'\]\(]+)/i.exec(task) ||
    /track\s+[«"']?([^»"'\]\(]+)/i.exec(task)
  return m?.[1]?.trim() ?? null
}

export function classifyPlanTask(text: string): PlanTaskKind {
  const t = norm(text)
  if (/sidechain|side chain|compresor side/.test(t)) return 'sidechain'
  if (/bounce|export|render|master pass|entrega|wav|flac|mp3|master|lufs|streaming target/.test(t)) return 'bounce'
  if (/vol|pan|mezcla|mix|reverb|send|bus|automation|limiter|eq/.test(t)) return 'mix'
  if (/vst|plugin|instrumento|roles|kontakt|bfd|decent|analog/.test(t)) return 'vst'
  if (/pista|track|bajo|bass|drums|bater|pad|lead|guitar|piano|voc|coro|teclado/.test(t)) return 'track'
  return 'generic'
}

function projectFacts(state: DAWState): string[] {
  const facts: string[] = []
  for (const t of state.project?.tracks ?? []) {
    facts.push(t.nombre || t.id)
    for (const p of t.plugins ?? []) facts.push(p.nombre)
    for (const c of t.clips ?? []) {
      const n = (c as { nombre?: string }).nombre
      if (n) facts.push(n)
    }
  }
  return facts
}

function isSatisfiedFuzzy(task: string, facts: string[]): boolean {
  const nt = norm(task)
  if (!nt) return false
  return facts.some((f) => {
    const nf = norm(f)
    if (!nf) return false
    return nf === nt || nt.includes(nf) || nf.includes(nt)
  })
}

export type { PlanEvalContext, PlanEvalAuditTrack } from './eval-context'

function taskNeedsLoudnessEvidence(task: string): boolean {
  const t = norm(task)
  return /master|lufs|streaming|club|cd|target|limiter|entrega|bounce|export|render/.test(t)
}

function hasLoudnessEvidence(ctx?: PlanEvalContext): boolean {
  if (ctx?.compareTargetOk) return true
  if (typeof ctx?.lastBounceLufs === 'number' && Number.isFinite(ctx.lastBounceLufs)) return true
  return false
}

export function evaluatePlanTask(task: string, state: DAWState, ctx?: PlanEvalContext): PlanTaskCheck {
  const kind = classifyPlanTask(task)
  const nameHint = extractQuotedName(task) ?? task

  if (kind === 'sidechain') {
    const sidechains = state.project?.routing?.sidechains?.length ?? 0
    if (sidechains === 0) {
      return {
        task,
        ok: false,
        kind,
        reason: 'Sidechain no configurado en routing del proyecto.',
      }
    }
    // 1.0: sidechain es solo estado/meter — no marcar plan OK como «audible».
    return {
      task,
      ok: false,
      kind,
      reason:
        'Sidechain en estado del proyecto, pero I/O audible a plugins no está en 1.0 (sidechain-unverified).',
    }
  }

  if (kind === 'track' || kind === 'vst') {
    const track = findTrackByName(state, nameHint)
    if (!track) {
      return { task, ok: false, kind, reason: `No hay pista que coincida con «${nameHint}».` }
    }
    const clips = track.clips ?? []
    let notes = 0
    for (const c of clips) notes += clipNoteCount(c)
    const isMidi = track.tipo === 'midi' || track.tipo === 'instrumento'
    const plugins = track.plugins ?? []

    if (kind === 'vst' || /vst|plugin|instrumento/i.test(task)) {
      if (plugins.length === 0) {
        return { task, ok: false, kind: 'vst', reason: `Pista «${track.nombre}» sin plugin en cadena.` }
      }
      const err = plugins.find((p) => p.estado === 'error')
      if (err) {
        return { task, ok: false, kind: 'vst', reason: `Plugin «${err.nombre}» en error.` }
      }
      return {
        task,
        ok: true,
        kind: 'vst',
        reason: `Instrumento en «${track.nombre}»: ${plugins.map((p) => p.nombre).join(', ')}.`,
      }
    }

    if (isMidi) {
      if (clips.length === 0) {
        return { task, ok: false, kind: 'track', reason: `Pista «${track.nombre}» sin clips.` }
      }
      if (notes === 0) {
        return { task, ok: false, kind: 'track', reason: `Pista «${track.nombre}» con clips vacíos (0 notas).` }
      }
      if (plugins.length === 0) {
        return {
          task,
          ok: false,
          kind: 'track',
          reason: `Pista «${track.nombre}» con ${notes} notas pero sin instrumento.`,
        }
      }
      return {
        task,
        ok: true,
        kind: 'track',
        reason: `Pista «${track.nombre}»: ${clips.length} clip(s), ${notes} notas, ${plugins.length} plugin(s).`,
      }
    }

    if (clips.length === 0) {
      return { task, ok: false, kind: 'track', reason: `Pista audio «${track.nombre}» sin clips.` }
    }
    return { task, ok: true, kind: 'track', reason: `Pista «${track.nombre}» con ${clips.length} clip(s).` }
  }

  if (kind === 'mix') {
    const sends = state.project?.routing?.sends?.filter((s) => s.activo !== false && (s.cantidad ?? 0) > 0) ?? []
    const buses = state.project?.routing?.buses?.length ?? 0
    const tracks = state.project?.tracks ?? []
    const volChanges = tracks.filter((t) => typeof t.volumen === 'number' && t.volumen !== 0.8).length
    const panChanges = tracks.filter((t) => typeof t.paneo === 'number' && t.paneo !== 0).length
    const autoLanes = tracks.reduce((n, t) => n + (t.automatizaciones?.length ?? 0), 0)
    const activeSends = ctx?.activeSendCount ?? sends.length
    const hasMix = volChanges > 0 || panChanges > 0 || activeSends > 0 || buses > 0 || autoLanes > 0
    if (taskNeedsLoudnessEvidence(task)) {
      if (!hasLoudnessEvidence(ctx)) {
        return {
          task,
          ok: false,
          kind,
          reason: 'Mezcla/master sin analysis.compareTarget ni LUFS de bounce — ejecuta compareTarget tras render.',
        }
      }
      return {
        task,
        ok: true,
        kind,
        reason: `Master/mezcla con loudness verificado${typeof ctx?.lastBounceLufs === 'number' ? ` (LUFS ${ctx.lastBounceLufs.toFixed(1)})` : ''}${ctx?.compareTargetOk ? ' · compareTarget OK' : ''}.`,
      }
    }
    if (hasMix) {
      return {
        task,
        ok: true,
        kind,
        reason: `Mezcla: ${volChanges} vol, ${panChanges} pan, ${activeSends} send(s), ${autoLanes} lane(s) auto.`,
      }
    }
    if (isSatisfiedFuzzy(task, projectFacts(state))) {
      return { task, ok: true, kind, reason: 'Coincidencia fuzzy con pistas/plugins del proyecto.' }
    }
    return { task, ok: false, kind, reason: 'Sin evidencia de ajustes de mezcla en el DAW.' }
  }

  if (kind === 'bounce') {
    const paths = ctx?.renderPaths ?? []
    if (paths.length > 0) {
      if (!hasLoudnessEvidence(ctx)) {
        return {
          task,
          ok: false,
          kind,
          reason: 'Bounce sin LUFS/compareTarget — ejecuta analysis.compareTarget o daw.masterPass.',
        }
      }
      const lufs =
        typeof ctx?.lastBounceLufs === 'number' ? ` · LUFS ${ctx.lastBounceLufs.toFixed(1)}` : ''
      const cmp =
        ctx?.compareTargetOk === true
          ? ' · compareTarget OK'
          : typeof ctx?.compareTargetDeltaDb === 'number'
            ? ` · Δ ${ctx.compareTargetDeltaDb.toFixed(1)} dB`
            : ''
      return {
        task,
        ok: true,
        kind,
        reason: `Bounce confirmado: ${paths[paths.length - 1]}${lufs}${cmp}`,
      }
    }
    if (isSatisfiedFuzzy(task, projectFacts(state))) {
      return { task, ok: true, kind, reason: 'Coincidencia por nombre (sin archivo render verificado).' }
    }
    return {
      task,
      ok: false,
      kind,
      reason: 'Export/bounce sin archivo — ejecuta render.start o daw.masterPass.',
    }
  }

  const ok = isSatisfiedFuzzy(task, projectFacts(state))
  return {
    task,
    ok,
    kind: 'generic',
    reason: ok ? 'Coincidencia fuzzy con pistas/plugins/clips.' : 'Sin coincidencia en el DAW.',
  }
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

export function evaluatePlanAgainstDaw(md: string, state: DAWState, ctx?: PlanEvalContext): PlanEvaluation {
  const tasks = parsePlanTasks(md)
  const unique = new Map<string, PlanTask>()
  for (const t of tasks) {
    const k = norm(t.text)
    if (!k) continue
    const prev = unique.get(k)
    if (!prev) unique.set(k, t)
    else if (t.done) unique.set(k, t)
  }
  const planned = [...unique.values()]
  const checks: PlanTaskCheck[] = []
  const missing: string[] = []
  const doneItems: string[] = []

  for (const t of planned) {
    if (t.done) {
      doneItems.push(t.text)
      checks.push({ task: t.text, ok: true, kind: 'generic', reason: 'Marcado implementado en plan.md.' })
      continue
    }
    const check = evaluatePlanTask(t.text, state, ctx)
    checks.push(check)
    if (check.ok) doneItems.push(t.text)
    else missing.push(t.text)
  }

  const known = new Set(planned.map((t) => norm(t.text)))
  const extraTracks = (state.project?.tracks ?? [])
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
    '### Criterios por tarea',
    ...checks.map((c) => `- ${c.ok ? '✓' : '✗'} [${c.kind}] ${c.task} — ${c.reason}`),
    '',
    `| Planeado | En el DAW | Resultado |`,
    `| --- | --- | --- |`,
    ...checks.map((c) => {
      return `| ${c.task.replace(/\|/g, '/')} | ${c.ok ? 'sí' : 'no'} | ${c.reason.replace(/\|/g, '/')} |`
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
    checks,
  }
}
