/**
 * Harness de producción (estilo Cursor, dominio DAW).
 *
 * Bucle: ejecutar → inspeccionar el proyecto → reparar solo lo roto → parar
 * si está sano, si no hay progreso o si se alcanza el tope de turnos.
 * El audio thread nunca entra aquí: solo comandos de estado / MIDI / plugins.
 */

import { getAgentDoc, PLAN_SLUG } from './agent-docs'
import type { PlanEvaluation } from './agent-plan-eval'
import type { ActionResult, DawAction } from './ai-daw-agent'
import type { DAWState } from '../../../shared/src/types/state'

const READ_ONLY = new Set(['doc.list', 'doc.read', 'doc.evaluate', 'plugin.lookup'])

export const HARNESS_MAX_REPAIR_TURNS = 3
export const HARNESS_MAX_ACTIONS_PER_REPAIR = 8

export type DawHealthIssue = {
  severity: 'error' | 'warn'
  code: string
  message: string
}

export type DawHealthReport = {
  ok: boolean
  errors: DawHealthIssue[]
  warnings: DawHealthIssue[]
  failedActions: ActionResult[]
  snapshot: {
    tracks: number
    midiClips: number
    emptyMidiTracks: string[]
    plugins: number
  }
}

export type HarnessFollowupTurn = {
  index: number
  report: DawHealthReport
  results: ActionResult[]
  text: string
}

export type HarnessStopReason = 'healthy' | 'max-turns' | 'no-progress' | 'aborted' | 'no-model'

export type HarnessFollowupResult = {
  results: ActionResult[]
  text: string
  evaluation: PlanEvaluation | null
  actionsSummary: string
  turns: HarnessFollowupTurn[]
  stoppedReason: HarnessStopReason
  lastReport: DawHealthReport
}

export type HarnessProgressEvent = {
  turn: number
  maxTurns: number
  report: DawHealthReport
}

export function harnessReviewNeeded(results: ActionResult[]): boolean {
  return results.some((r) => r.success && !READ_ONLY.has(r.type))
}

const NO_RETRY = new Set([
  'track.create',
  'plugin.insert',
  'daw.musicBuild',
  'daw.composeProject',
  'midi.clip.create',
])

export function actionFingerprint(type: string, payload?: Record<string, unknown>): string {
  const plugin = payload?.plugin as { nombre?: unknown } | undefined
  const nombre =
    payload?.nombre ??
    payload?.pluginName ??
    plugin?.nombre ??
    payload?.trackId ??
    payload?.pistaId ??
    ''
  return `${type}:${String(nombre).toLowerCase()}`
}

/** Recupera fingerprints de resultados que ya mencionan el nombre («Plugin «X»»). */
export function seedAttemptedFingerprints(results: ActionResult[]): Set<string> {
  const out = new Set<string>()
  for (const r of results) {
    if (r.success && (r.type === 'daw.musicBuild' || r.type === 'daw.composeProject')) {
      out.add(`${r.type}:`)
    }
    const named = r.message.match(/«([^»]+)»/)
    if (named && NO_RETRY.has(r.type)) {
      out.add(`${r.type}:${named[1].toLowerCase()}`)
    }
  }
  return out
}

export function filterRedundantRepairActions(
  actions: DawAction[],
  previous: ActionResult[],
  attempted?: Iterable<string>,
): DawAction[] {
  const ok = new Set(
    previous.filter((r) => r.success).map((r) => actionFingerprint(r.type)),
  )
  const tried = new Set(attempted)
  const seen = new Set<string>()
  const out: DawAction[] = []
  for (const a of actions) {
    const fp = actionFingerprint(a.type, a.payload)
    if (a.type === 'track.create' && ok.has(fp)) continue
    if (a.type === 'daw.musicBuild' && (ok.has('daw.musicBuild:') || tried.has('daw.musicBuild:'))) continue
    if (a.type === 'daw.composeProject' && (ok.has('daw.composeProject:') || tried.has('daw.composeProject:'))) continue
    if (NO_RETRY.has(a.type) && tried.has(fp)) continue
    if (seen.has(fp) && a.type === 'track.create') continue
    seen.add(fp)
    out.push(a)
    if (out.length >= HARNESS_MAX_ACTIONS_PER_REPAIR) break
  }
  return out
}

function clipNoteCount(clip: unknown): number {
  const c = clip as { notas?: unknown[]; notes?: unknown[]; midi?: { notas?: unknown[] } }
  const notas = c.notas ?? c.notes ?? c.midi?.notas
  return Array.isArray(notas) ? notas.length : 0
}

export function inspectDawHealth(
  state: DAWState,
  results: ActionResult[],
  evaluation: PlanEvaluation | null,
): DawHealthReport {
  const errors: DawHealthIssue[] = []
  const warnings: DawHealthIssue[] = []
  const failedActions = results.filter((r) => !r.success)
  for (const r of failedActions) {
    errors.push({
      severity: 'error',
      code: 'action-failed',
      message: `${r.type}: ${r.message}`,
    })
  }

  const mutatedMidi = results.some(
    (r) =>
      r.success &&
      (r.type === 'midi.clip.create' ||
        r.type === 'midi.notes.set' ||
        r.type === 'daw.generateMidiSong' ||
        r.type === 'daw.composeProject' ||
        r.type === 'daw.musicBuild'),
  )
  const builtProject = results.some(
    (r) => r.success && (r.type === 'daw.musicBuild' || r.type === 'daw.composeProject'),
  )

  const tracks = state.project?.tracks ?? []
  const emptyMidiTracks: string[] = []
  const bareInstruments: string[] = []
  const pluginErrors: string[] = []
  let midiClips = 0
  let plugins = 0
  for (const t of tracks) {
    const chain = t.plugins ?? []
    plugins += chain.length
    for (const pl of chain) {
      if (pl.estado === 'error') pluginErrors.push(`${t.nombre || t.id}/${pl.nombre}`)
    }
    const clips = t.clips ?? []
    const isMidi = t.tipo === 'midi' || t.tipo === 'instrumento'
    let notes = 0
    for (const c of clips) {
      const n = clipNoteCount(c)
      if (n > 0) midiClips += 1
      notes += n
    }
    if (isMidi && clips.length > 0 && notes === 0) emptyMidiTracks.push(t.nombre || t.id)
    if (isMidi && mutatedMidi && clips.length === 0) emptyMidiTracks.push(t.nombre || t.id)
    if (builtProject && isMidi && chain.length === 0) bareInstruments.push(t.nombre || t.id)
  }
  if (mutatedMidi && emptyMidiTracks.length) {
    errors.push({
      severity: 'error',
      code: 'empty-midi',
      message: `Pistas MIDI sin notas: ${emptyMidiTracks.slice(0, 8).join(', ')}`,
    })
  }
  if (bareInstruments.length) {
    errors.push({
      severity: 'error',
      code: 'missing-instrument',
      message: `Pistas MIDI sin instrumento: ${bareInstruments.slice(0, 8).join(', ')}`,
    })
  }
  if (pluginErrors.length) {
    errors.push({
      severity: 'error',
      code: 'plugin-error',
      message: `Plugins en error: ${pluginErrors.slice(0, 8).join(', ')}`,
    })
  }

  for (const r of results) {
    if (r.type !== 'daw.musicBuild' || !r.data) continue
    const build = r.data as {
      status?: string
      stages?: Array<{ status?: string; label?: string; detail?: string }>
      issues?: Array<{ severity?: string; message?: string }>
    }
    if (build.status === 'failed' || r.success === false) {
      errors.push({
        severity: 'error',
        code: 'music-build-failed',
        message: 'Music Build falló en una fase.',
      })
    }
    for (const s of build.stages ?? []) {
      if (s.status === 'fail') {
        errors.push({
          severity: 'error',
          code: 'music-build-stage',
          message: `${s.label ?? 'fase'}: ${s.detail ?? 'falló'}`,
        })
      }
    }
    for (const issue of build.issues ?? []) {
      if (issue.severity === 'error') {
        errors.push({ severity: 'error', code: 'midi-validate', message: issue.message || 'MIDI inválido' })
      } else if (issue.message) {
        warnings.push({ severity: 'warn', code: 'midi-validate', message: issue.message })
      }
    }
  }

  if (evaluation?.missing.length) {
    warnings.push({
      severity: 'warn',
      code: 'plan-gap',
      message: `Plan pendiente: ${evaluation.missing.slice(0, 5).join('; ')}`,
    })
  }

  const snapshot = {
    tracks: tracks.length,
    midiClips,
    emptyMidiTracks,
    plugins,
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    failedActions,
    snapshot,
  }
}

export function harnessShouldRepair(report: DawHealthReport): boolean {
  return report.errors.length > 0
}

export function healthSignature(report: DawHealthReport): string {
  return [...new Set(report.errors.map((e) => `${e.code}:${e.message}`))].sort().join('|')
}

export function formatHarnessProgress(turn: number, maxTurns: number, report: DawHealthReport): string {
  const head = report.errors[0]?.message ?? 'revisando el DAW'
  return `Reparación ${turn}/${maxTurns}: ${head}`
}

export function formatHarnessStopLine(
  reason: HarnessStopReason,
  turns: number,
  leftover: string[] = [],
): string {
  const tail = leftover.length ? ` Pendiente: ${leftover.slice(0, 3).join('; ')}` : ''
  if (reason === 'healthy') {
    return turns ? `Harness: ${turns} reparación(es), DAW sano.` : 'Harness: DAW sano.'
  }
  if (reason === 'no-progress') return `Harness: sin progreso (mismos fallos).${tail}`
  if (reason === 'max-turns') return `Harness: tope de reparaciones.${tail}`
  if (reason === 'aborted') return 'Harness: detenido por el usuario.'
  return 'Harness: el modelo no respondió al turno de reparación.'
}

export function buildHarnessReviewMessage(opts: {
  userText: string
  evalSummary: string
  actionsSummary: string
  projectId: string
  evaluation: PlanEvaluation | null
}): string {
  const plan = getAgentDoc(opts.projectId, PLAN_SLUG)
  const missing = opts.evaluation?.missing ?? []
  const planned = opts.evaluation?.planned ?? 0
  const done = opts.evaluation?.done ?? 0
  return [
    '## Turno de revisión del harness (un solo pase, obligatorio)',
    `Pedido original del usuario:\n${opts.userText}`,
    '',
    'Contrasta estas tres capas y actualiza plan.md:',
    '1) Intención — qué se quería producir (sección Intención y el pedido).',
    '2) Por implementar — tareas del plan, incluidas las que el USUARIO haya editado.',
    '3) Implementado — pistas, plugins y clips que hay AHORA en el DAW.',
    '',
    `Evaluación mecánica: ${opts.evalSummary || '(sin eval automática)'}`,
    `Cobertura checkbox: ${done}/${planned}. Falta: ${missing.join('; ') || 'nada'}`,
    opts.evaluation?.extraTracks.length
      ? `Pistas extra en el DAW: ${opts.evaluation.extraTracks.join(', ')}`
      : '',
    '',
    'Acciones ya ejecutadas:',
    opts.actionsSummary || '(ninguna)',
    '',
    '### plan.md actual (respeta «Notas del usuario»)',
    plan?.content ?? '(no hay plan.md)',
    '',
    'Responde 2-4 frases en español con tu juicio (qué coincidió, qué falta, si el resultado es musicalmente coherente con la intención).',
    'Actualiza plan.md con <<<DOC plan.md ... DOC>>> o doc.write / doc.evaluate:',
    '- ## Evaluación: tu juicio (no copies solo la tabla mecánica)',
    '- ## Implementado / ## Por implementar / ## En curso',
    'Si falta algo concreto y puedes crearlo ahora, un bloque ACTIONS (un ajuste, no rehacer el proyecto). Si el usuario debe decidir, déjalo pendiente en el plan.',
    'NO pises la sección «Notas del usuario». NO repitas las acciones que ya salieron bien.',
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n')
}

export function buildHarnessRepairMessage(opts: {
  userText: string
  report: DawHealthReport
  actionsSummary: string
  projectId: string
  turn: number
  maxTurns: number
}): string {
  const errors = opts.report.errors.map((e) => `- ${e.message}`).join('\n')
  const warns = opts.report.warnings.map((e) => `- ${e.message}`).join('\n')
  const snap = opts.report.snapshot
  return [
    `## Harness de producción — reparación ${opts.turn}/${opts.maxTurns}`,
    'Eres el agente de JasWave (DAW). El usuario no debe ver JSON. Arregla SOLO lo roto.',
    '',
    `Pedido original:\n${opts.userText}`,
    '',
    '### Estado del DAW ahora',
    `Pistas: ${snap.tracks} · clips MIDI con notas: ${snap.midiClips} · plugins: ${snap.plugins}`,
    snap.emptyMidiTracks.length
      ? `MIDI vacío: ${snap.emptyMidiTracks.join(', ')}`
      : 'MIDI: sin pistas vacías detectadas.',
    '',
    '### Errores (obligatorio resolver o declarar que el usuario debe decidir)',
    errors || '_Ninguno._',
    warns ? `### Avisos\n${warns}` : '',
    '',
    'Ya ejecutado (NO lo repitas si salió bien):',
    opts.actionsSummary || '(nada)',
    '',
    'Reglas (como un agente de producción, no un chatbot):',
    `- Máximo ${HARNESS_MAX_ACTIONS_PER_REPAIR} acciones.`,
    '- NO hagas daw.musicBuild ni daw.composeProject de nuevo si ya se aplicó.',
    '- NO crees pistas que ya existen. Completa clips/plugins/notas que faltan.',
    '- Si un VST falló, elige otro del catálogo o Soft Pad; no insistas en el mismo path.',
    '- Si no puedes arreglarlo sin una decisión del usuario, 2 frases y CERO ACTIONS.',
    '',
    '<<<ACTIONS',
    '[{"type":"...","payload":{...}}]',
    'ACTIONS>>>',
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n')
}

export async function runHarnessFollowups(opts: {
  userText: string
  initialResults: ActionResult[]
  evaluation: PlanEvaluation | null
  actionsSummary: string
  projectId: string
  abort?: AbortSignal
  maxRepairTurns?: number
  chat: (userContent: string) => Promise<{ success: boolean; content?: string }>
  parseActions: (raw: string) => DawAction[]
  execute: (actions: DawAction[]) => Promise<ActionResult[]>
  getState: () => DAWState
  afterTurn?: (results: ActionResult[], raw?: string) => PlanEvaluation | null
  formatResults: (results: ActionResult[]) => string
  onProgress?: (event: HarnessProgressEvent) => void
}): Promise<HarnessFollowupResult> {
  const maxTurns = opts.maxRepairTurns ?? HARNESS_MAX_REPAIR_TURNS
  let results = [...opts.initialResults]
  let evaluation = opts.evaluation
  let actionsSummary = opts.actionsSummary
  let text = ''
  const turns: HarnessFollowupTurn[] = []
  let lastSig = ''
  const attempted = seedAttemptedFingerprints(results)

  const done = (stoppedReason: HarnessStopReason, report?: DawHealthReport): HarnessFollowupResult => ({
    results,
    text,
    evaluation,
    actionsSummary,
    turns,
    stoppedReason,
    lastReport: report ?? inspectDawHealth(opts.getState(), results, evaluation),
  })

  for (let i = 1; i <= maxTurns; i++) {
    if (opts.abort?.aborted) return done('aborted')
    const report = inspectDawHealth(opts.getState(), results, evaluation)
    if (!harnessShouldRepair(report)) return done('healthy', report)
    const sig = healthSignature(report)
    if (sig && sig === lastSig) return done('no-progress', report)
    lastSig = sig
    opts.onProgress?.({ turn: i, maxTurns, report })

    const prompt = buildHarnessRepairMessage({
      userText: opts.userText,
      report,
      actionsSummary,
      projectId: opts.projectId,
      turn: i,
      maxTurns,
    })
    const reply = await opts.chat(prompt)
    if (opts.abort?.aborted) return done('aborted', report)
    if (!reply.success || !reply.content?.trim()) return done('no-model', report)
    const raw = reply.content
    const actions = filterRedundantRepairActions(opts.parseActions(raw), results, attempted)
    for (const a of actions) attempted.add(actionFingerprint(a.type, a.payload))
    const turnResults = actions.length ? await opts.execute(actions) : []
    results = [...results, ...turnResults]
    if (turnResults.length) {
      actionsSummary = [actionsSummary, opts.formatResults(turnResults)].filter(Boolean).join('\n')
    }
    evaluation = opts.afterTurn?.(turnResults, raw) ?? evaluation
    const visible = raw
      .replace(/<<<ACTIONS[\s\S]*?ACTIONS>>>/gi, '')
      .replace(/<<<DOC[\s\S]*?DOC>>>/gi, '')
      .trim()
    if (visible) text = [text, visible].filter(Boolean).join('\n\n')
    turns.push({ index: i, report, results: turnResults, text: visible })
    if (actions.length === 0) return done('no-progress', inspectDawHealth(opts.getState(), results, evaluation))
  }

  const finalReport = inspectDawHealth(opts.getState(), results, evaluation)
  return done(harnessShouldRepair(finalReport) ? 'max-turns' : 'healthy', finalReport)
}
