/**
 * Harness de producción (estilo Cursor, dominio DAW).
 *
 * Bucle: ejecutar → inspeccionar el proyecto → reparar solo lo roto → parar
 * si está sano, si no hay progreso o si se alcanza el tope de turnos.
 * El audio thread nunca entra aquí: solo comandos de estado / MIDI / plugins.
 */

import type { PlanEvaluation } from '../plan/types'
import type { HarnessActionResult, HarnessDawAction } from '../types/actions'
import type { DAWState } from '@jaswave/shared'
import {
  formatNextGapInstruction,
  inspectProduction,
  type ProductionListenEvidence,
  type ProductionPluginGuide,
} from './production-audit'
import { formatSectionGapLine, listSectionGaps, type SectionGap } from '../plan/section-coverage'

export type { HarnessActionResult, HarnessDawAction } from '../types/actions'

export type ActionResult = HarnessActionResult
export type DawAction = HarnessDawAction

const READ_ONLY = new Set([
  'doc.list',
  'doc.read',
  'doc.evaluate',
  'plugin.lookup',
  'plugin.probe',
  'library.preset.list',
  'library.preset.search',
  'library.preset.listGlobal',
  'library.preset.searchGlobal',
  'analysis.loudness',
  'analysis.compareTarget',
  'analysis.spectrum',
  'analysis.stereo',
  'analysis.fullReport',
  'analysis.timing',
  'analysis.buffer',
  'analysis.fxBlame',
  'render.getStatus',
])

export const HARNESS_MAX_REPAIR_TURNS = 24
export const HARNESS_MAX_ACTIONS_PER_REPAIR = 12
/** Cuántas veces seguidas puede repetirse la misma firma de error antes de parar. */
export const HARNESS_STALE_LIMIT = 2

export type DawHealthIssue = {
  severity: 'error' | 'warn'
  code: string
  message: string
}

export type HarnessAuditTrack = {
  id: string
  name: string
  notes: number
  clips: number
  peak: number
  vstSlot?: string
  plugins: string[]
}

/** Contexto opcional del snapshot CLI / runtime VST para gates de audibilidad. */
export type HarnessHealthContext = {
  auditTracks?: HarnessAuditTrack[]
  masterPeak?: number
  hostOk?: boolean | null
  auditIssues?: string[]
  hangSuspect?: boolean
  /** sidechain.connect aplicó en esta sesión. */
  sidechainApplied?: boolean
  /** Sidechain enrutado en graph del host (encoding $). */
  sidechainHostRouted?: boolean
  /** Peak sidechain por track destino (id → peak). */
  sidechainPeaks?: Record<string, number>
  pluginGuides?: ProductionPluginGuide[]
  lastListen?: ProductionListenEvidence | null
  loudnessTarget?: 'streaming' | 'club' | 'cd'
  /** Si true, 0 huecos de sección exige bounce+compareTarget. */
  requireListen?: boolean
}

export const HARNESS_MIN_AUDIBLE_PEAK = 0.0005

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
    silentMidiTracks: string[]
    hostSlotMissing: string[]
  }
  /** Dump legible del proyecto para el modelo (debug real). */
  debugDump: string
  sectionGaps?: SectionGap[]
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
  // Clips por sección: no colapsar dos creates distintos en la misma pista.
  if (
    type === 'midi.clip.create' ||
    type === 'midi.notes.patch' ||
    type === 'midi.notes.set' ||
    type === 'midi.clip.md.apply' ||
    type === 'midi.clip.md.upsert'
  ) {
    const pista = String(payload?.pistaId ?? payload?.trackId ?? payload?.clipId ?? '')
    const inicio =
      payload?.inicio ?? payload?.rangeStart ?? payload?.start ?? payload?.inicioBeats ?? ''
    return `${type}:${pista.toLowerCase()}:${String(inicio)}`
  }
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

function isMidiLikeTrack(tipo: string | undefined): boolean {
  return tipo === 'midi' || tipo === 'instrumento'
}

function auditLineForTrack(trackId: string, ctx?: HarnessHealthContext): HarnessAuditTrack | undefined {
  return ctx?.auditTracks?.find((t) => t.id === trackId)
}

function applyAudibilityAndRuntimeChecks(opts: {
  state: DAWState
  results: ActionResult[]
  builtProject: boolean
  mutatedMidi: boolean
  errors: DawHealthIssue[]
  warnings: DawHealthIssue[]
  ctx?: HarnessHealthContext
}): { silentMidiTracks: string[]; hostSlotMissing: string[] } {
  const silentMidiTracks: string[] = []
  const hostSlotMissing: string[] = []
  const tracks = opts.state.project?.tracks ?? []

  if (opts.ctx?.sidechainApplied && !opts.ctx?.sidechainHostRouted) {
    opts.warnings.push({
      severity: 'warn',
      code: 'sidechain-unverified',
      message:
        'Sidechain en estado del proyecto pero sin I/O host confirmado — sincroniza el graph o reproduce.',
    })
  } else if (opts.ctx?.sidechainHostRouted) {
    const peaks = opts.ctx.sidechainPeaks ?? {}
    const hasSignal = Object.values(peaks).some((p) => p > HARNESS_MIN_AUDIBLE_PEAK)
    if (!hasSignal && opts.ctx?.sidechainApplied) {
      opts.warnings.push({
        severity: 'warn',
        code: 'sidechain-silent',
        message: 'Sidechain enrutado en host pero sin señal audible — reproduce el proyecto.',
      })
    }
  }
  if (opts.ctx?.hangSuspect) {
    opts.errors.push({
      severity: 'error',
      code: 'engine-hang',
      message: 'Motor de audio con playhead congelado — revisa transporte/host antes de cerrar el plan.',
    })
  }
  if (opts.ctx?.hostOk === false) {
    opts.errors.push({
      severity: 'error',
      code: 'host-down',
      message: 'Plugin-host no disponible — los VST no pueden sonar.',
    })
  }
  for (const issue of opts.ctx?.auditIssues ?? []) {
    if (/Meters en silencio/i.test(issue)) {
      opts.warnings.push({ severity: 'warn', code: 'meters-silent', message: issue })
    }
  }

  for (const t of tracks) {
    if (!isMidiLikeTrack(t.tipo)) continue
    const clips = t.clips ?? []
    let notes = 0
    for (const c of clips) notes += clipNoteCount(c)
    if (notes === 0) continue

    const chain = t.plugins ?? []
    const audit = auditLineForTrack(t.id, opts.ctx)
    const slot = audit?.vstSlot
    const label = t.nombre || t.id

    if (audit) {
      if (chain.length === 0) continue
      if (!slot) {
        hostSlotMissing.push(label)
      }
    }

    if (audit && audit.peak < HARNESS_MIN_AUDIBLE_PEAK && notes > 0 && !t.silenciada) {
      silentMidiTracks.push(`${label} (peak=${audit.peak})`)
    }
  }

  if (hostSlotMissing.length) {
    opts.errors.push({
      severity: 'error',
      code: 'host-slot-unconfirmed',
      message: `VST sin slot host confirmado: ${hostSlotMissing.slice(0, 8).join(', ')}`,
    })
  }
  if (silentMidiTracks.length && opts.builtProject) {
    opts.warnings.push({
      severity: 'warn',
      code: 'silent-midi-track',
      message: `Pistas MIDI sin señal audible en meters: ${silentMidiTracks.slice(0, 6).join(', ')}`,
    })
  }

  return { silentMidiTracks, hostSlotMissing }
}

/** Inventario real del DAW para que el modelo debuggee sin inventar. */
export function formatDawDebugDump(state: DAWState, gaps?: SectionGap[]): string {
  const tracks = state.project?.tracks ?? []
  if (!tracks.length) return '(proyecto sin pistas)'
  const lines: string[] = []
  for (const t of tracks) {
    const clips = t.clips ?? []
    let notes = 0
    let pitchMin = Infinity
    let pitchMax = -Infinity
    for (const c of clips) {
      notes += clipNoteCount(c)
      const raw = (c as { notas?: Array<{ pitch?: number }> }).notas ?? []
      for (const n of raw) {
        const p = Math.round(Number(n.pitch))
        if (!Number.isFinite(p)) continue
        if (p < pitchMin) pitchMin = p
        if (p > pitchMax) pitchMax = p
      }
    }
    const role =
      (t.tags ?? [])
        .map((x) => String(x))
        .find((x) => x.startsWith('role:'))
        ?.slice(5) || '—'
    const plugs = (t.plugins ?? [])
      .map((p) => `${p.nombre}${p.estado === 'error' ? '[ERR]' : p.estado === 'cargado' ? '' : `[${p.estado ?? '?'}]`}`)
      .join(', ')
    const clipBits = clips
      .slice(0, 6)
      .map((c) => {
        const cl = c as { inicio?: number; duracion?: number; nombre?: string; notas?: unknown[] }
        const n = Array.isArray(cl.notas) ? cl.notas.length : 0
        return `${cl.nombre ?? 'clip'}@${Number(cl.inicio ?? 0)}+${Number(cl.duracion ?? 0)}n=${n}`
      })
      .join(', ')
    const pitchBit =
      notes > 0 && Number.isFinite(pitchMin) ? ` pitch=${pitchMin}–${pitchMax}` : ''
    lines.push(
      `- «${t.nombre || t.id}» rol=${role} tipo=${t.tipo} vol=${Number(t.volumen ?? 1).toFixed(2)} pan=${Number(t.paneo ?? 0).toFixed(2)} mute=${t.silenciada ? 1 : 0} clips=${clips.length} notas=${notes}${pitchBit} plugins=[${plugs || '—'}]${clipBits ? ` [${clipBits}]` : ''}`,
    )
  }
  const markers = state.project?.marcadores ?? []
  if (markers.length) {
    lines.push(
      `- Marcadores: ${markers.map((m) => `${m.nombre}@${Number(m.tiempo)}`).join(' → ')}`,
    )
  }
  const gapList = gaps ?? listSectionGaps(state)
  if (gapList.length) {
    lines.push(`- Huecos: ${gapList.slice(0, 8).map(formatSectionGapLine).join('; ')}`)
  }
  const master = state.project?.master
  if (master) {
    const mp = (master.plugins ?? []).map((p) => p.nombre).join(', ')
    lines.push(`- Master vol=${Number(master.volumen ?? 1).toFixed(2)} plugins=[${mp || '—'}]`)
  }
  const bpm = state.project?.bpm?.valor ?? state.transport?.bpm
  if (bpm != null) lines.push(`- BPM=${bpm}`)
  return lines.join('\n')
}

export function inspectDawHealth(
  state: DAWState,
  results: ActionResult[],
  evaluation: PlanEvaluation | null,
  ctx?: HarnessHealthContext,
): DawHealthReport {
  const errors: DawHealthIssue[] = []
  const warnings: DawHealthIssue[] = []
  const failedActions = results.filter((r) => !r.success)
  for (const r of failedActions) {
    const unsupported = /no soportada/i.test(r.message)
    errors.push({
      severity: 'error',
      code: unsupported ? 'action-unsupported' : 'action-failed',
      message: `${r.type}: ${r.message}`,
    })
  }

  const setParamCount = results.filter((r) => r.success && r.type === 'plugin.setParameter').length
  if (setParamCount > 3) {
    warnings.push({
      severity: 'warn',
      code: 'excessive-set-parameter',
      message: `${setParamCount} plugin.setParameter en este turno — preferir library.preset.search/apply o presetId en daw.musicBuild.`,
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
  const mutatedAny = results.some((r) => r.success && !READ_ONLY.has(r.type))

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
    const isMidi = isMidiLikeTrack(t.tipo) || t.tipo === 'audio'
    let notes = 0
    for (const c of clips) {
      const n = clipNoteCount(c)
      if (n > 0) midiClips += 1
      notes += n
    }
    if (isMidi && clips.length > 0 && notes === 0) emptyMidiTracks.push(t.nombre || t.id)
    if (builtProject && isMidi && chain.length === 0) bareInstruments.push(t.nombre || t.id)
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
  if (builtProject && tracks.length === 0) {
    errors.push({
      severity: 'error',
      code: 'no-tracks',
      message: 'Music Build/compose reportó OK pero el proyecto no tiene pistas.',
    })
  }

  for (const r of results) {
    if (r.type === 'plugin.probe' && r.success === false) {
      warnings.push({
        severity: 'warn',
        code: 'probe-failed',
        message: r.message,
      })
    }
    if (
      (r.type === 'render.start' || r.type === 'daw.masterPass') &&
      r.success &&
      r.data &&
      typeof r.data === 'object'
    ) {
      const data = r.data as {
        listenReport?: { ok?: boolean; issues?: string[]; summary?: string }
        listenSummary?: string
        ok?: boolean
        deltaDb?: number
      }
      const listen = data.listenReport
      if (listen && listen.ok === false) {
        errors.push({
          severity: 'error',
          code: 'listen-failed',
          message: `AudioListenReport no OK: ${listen.issues?.join('; ') || listen.summary || 'issues'}`,
        })
      }
      if (r.type === 'daw.masterPass' && data.ok === false) {
        errors.push({
          severity: 'error',
          code: 'master-pass-target',
          message: r.message || `MasterPass fuera de target (Δ ${data.deltaDb?.toFixed?.(1) ?? '?'} dB)`,
        })
      }
      if (r.type === 'render.start' && !listen) {
        warnings.push({
          severity: 'warn',
          code: 'listen-missing',
          message: 'Bounce sin AudioListenReport — ejecuta analysis.fullReport',
        })
      }
    }
    if (r.type === 'analysis.compareTarget' && r.success && r.data && typeof r.data === 'object') {
      const cmp = r.data as { deltaDb?: number; target?: string }
      if (typeof cmp.deltaDb === 'number' && Math.abs(cmp.deltaDb) > 1.5) {
        errors.push({
          severity: 'error',
          code: 'compare-target',
          message: `Fuera de target ${cmp.target ?? ''}: Δ ${cmp.deltaDb.toFixed(1)} dB`,
        })
      }
    }
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

  // Plan incompleto = error duro (el agente debe seguir hasta cerrar checkboxes o declarar bloqueo).
  if (evaluation && evaluation.planned > 0 && evaluation.missing.length > 0 && (mutatedAny || builtProject)) {
    errors.push({
      severity: 'error',
      code: 'plan-incomplete',
      message: `Plan incompleto ${evaluation.done}/${evaluation.planned}: ${evaluation.missing.slice(0, 6).join('; ')}`,
    })
  } else if (evaluation?.missing.length) {
    warnings.push({
      severity: 'warn',
      code: 'plan-gap',
      message: `Plan pendiente: ${evaluation.missing.slice(0, 5).join('; ')}`,
    })
  }

  const audibility = applyAudibilityAndRuntimeChecks({
    state,
    results,
    builtProject,
    mutatedMidi,
    errors,
    warnings,
    ctx,
  })

  let lastListen = ctx?.lastListen ?? null
  for (const r of results) {
    if ((r.type === 'render.start' || r.type === 'daw.masterPass') && r.success && r.data && typeof r.data === 'object') {
      const listen = (r.data as { listenReport?: ProductionListenEvidence }).listenReport
      if (listen) lastListen = listen
    }
  }
  const gapsPreview = listSectionGaps(state)
  const hasMidiNotes = tracks.some((t) => {
    if (!isMidiLikeTrack(t.tipo)) return false
    return (t.clips ?? []).some((c) => clipNoteCount(c) > 0)
  })
  const wantListen =
    ctx?.requireListen === true ||
    (evaluation?.missing ?? []).some((t) => /bounce|lufs|comparetarget|escuchar|listen|entrega/i.test(t)) ||
    // Tras Music Build + secciones cubiertas: exigir bounce + compareTarget.
    (gapsPreview.length === 0 &&
      hasMidiNotes &&
      builtProject &&
      Boolean(state.project?.marcadores?.length))

  const production = inspectProduction(state, {
    pluginGuides: ctx?.pluginGuides,
    lastListen,
    loudnessTarget: ctx?.loudnessTarget,
    requireListen: wantListen,
    builtProject,
    mutatedMidi,
  })
  for (const e of production.errors) {
    if (!errors.some((x) => x.code === e.code && x.message === e.message)) errors.push(e)
  }
  for (const w of production.warnings) {
    if (!warnings.some((x) => x.code === w.code && x.message === w.message)) warnings.push(w)
  }

  const snapshot = {
    tracks: tracks.length,
    midiClips,
    emptyMidiTracks,
    plugins,
    silentMidiTracks: audibility.silentMidiTracks,
    hostSlotMissing: audibility.hostSlotMissing,
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    failedActions,
    snapshot,
    debugDump: formatDawDebugDump(state, production.sectionGaps),
    sectionGaps: production.sectionGaps,
  }
}

export function harnessShouldRepair(report: DawHealthReport): boolean {
  return report.errors.length > 0
}

export function healthSignature(report: DawHealthReport): string {
  const codes = [...new Set(report.errors.map((e) => e.code))].sort()
  const gaps = (report.sectionGaps ?? []).map((g) => `${g.trackId}:${g.start}-${g.end}`).sort()
  return [...codes, ...gaps].join('|')
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
  planMarkdown?: string
  evaluation: PlanEvaluation | null
}): string {
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
    opts.planMarkdown ?? '(no hay plan.md)',
    '',
    'Responde 2-4 frases en español con tu juicio (qué coincidió, qué falta, si el resultado es musicalmente coherente con la intención).',
    'Actualiza plan.md con <<<DOC plan.md ... DOC>>> o doc.write / doc.evaluate:',
    '- ## Evaluación: tu juicio (no copies solo la tabla mecánica)',
    '- ## Implementado / ## Por implementar / ## En curso',
    '- Marca `[x]` lo que el DAW ya cubre; deja `- [ ]` lo pendiente. Conserva la prosa de intención.',
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
  const errors = opts.report.errors.map((e) => `- [${e.code}] ${e.message}`).join('\n')
  const warns = opts.report.warnings.map((e) => `- [${e.code}] ${e.message}`).join('\n')
  const snap = opts.report.snapshot
  const planOnly = opts.report.errors.every((e) => e.code === 'plan-incomplete')
  return [
    `## Harness de producción — reparación ${opts.turn}/${opts.maxTurns}`,
    'Eres el agente de JasWave (DAW). El usuario no debe ver JSON. Persiste hasta que el DAW y el plan.md coincidan.',
    '',
    `Pedido original:\n${opts.userText}`,
    '',
    '### Debug REAL del proyecto (no inventes pistas/plugins que no estén aquí)',
    opts.report.debugDump || '(vacío)',
    '',
    '### Resumen',
    `Pistas: ${snap.tracks} · clips MIDI con notas: ${snap.midiClips} · plugins: ${snap.plugins}`,
    snap.emptyMidiTracks.length
      ? `MIDI vacío: ${snap.emptyMidiTracks.join(', ')}`
      : 'MIDI: sin pistas vacías detectadas.',
    '',
    '### Errores (obligatorio resolver o declarar bloqueo con CERO ACTIONS)',
    errors || '_Ninguno._',
    warns ? `### Avisos\n${warns}` : '',
    '',
    'Ya ejecutado (NO lo repitas si salió bien):',
    opts.actionsSummary || '(nada)',
    '',
    'Reglas:',
    `- Máximo ${HARNESS_MAX_ACTIONS_PER_REPAIR} acciones por turno; habrá hasta ${opts.maxTurns} turnos.`,
    formatNextGapInstruction(opts.report.sectionGaps?.[0] ?? null),
    '- PROHIBIDO midi.clip.create con notas:[]. Cada clip NACE con notas reales.',
    '- Batería: pitches GM (kick=36, snare=38, HH=42, ride=51). NUNCA pitches cromáticos.',
    '- Bajo: pitch 28–55. Piano: 36–84. Pads: 48–79. Lead: 55–84.',
    '- Velocidades variadas nota a nota (60–110). No todas iguales.',
    '- NO hagas daw.musicBuild ni daw.composeProject de nuevo si ya se aplicó.',
    '- NO crees pistas que ya existen (mira el debug). Completa clips/plugins/notas.',
    '- Si el error es midi-skeleton-drums / midi-skeleton-bass: midi.notes.set con patrón denso (no esqueleto).',
    '- Si el error es section-gap: midi.clip.create { pistaId, inicio, duracion, notas:[...] } del siguiente hueco.',
    '- Si el error es listen-missing: render.start + analysis.compareTarget.',
    '- Si un VST falló: plugin.probe + otro del catálogo / library.preset.',
    '- Tras completar clips: track.update vol/pan para mezcla (NO dejar defaults 0.8/0.0).',
    planOnly
      ? '- Este turno es cierre de plan: prioriza alinear plan.md con el DAW real.'
      : '- Si no puedes arreglarlo sin decisión del usuario, 2 frases y CERO ACTIONS.',
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
  /** Snapshot CLI / peaks / slots — refrescado cada turno si se provee. */
  getHealthContext?: () => Promise<HarnessHealthContext | undefined>
  afterTurn?: (results: ActionResult[], raw?: string) => PlanEvaluation | null
  formatResults: (results: ActionResult[]) => string
  onProgress?: (event: HarnessProgressEvent) => void
  /** Transforma el prompt de reparación (p. ej. razonamiento abreviado). */
  preChat?: (userContent: string) => Promise<string>
}): Promise<HarnessFollowupResult> {
  const maxTurns = opts.maxRepairTurns ?? HARNESS_MAX_REPAIR_TURNS
  let results = [...opts.initialResults]
  let evaluation = opts.evaluation
  let actionsSummary = opts.actionsSummary
  let text = ''
  const turns: HarnessFollowupTurn[] = []
  let lastSig = ''
  let staleCount = 0
  const attempted = seedAttemptedFingerprints(results)

  let healthCtx: HarnessHealthContext | undefined
  const inspect = async (): Promise<DawHealthReport> => {
    if (opts.getHealthContext) {
      try {
        healthCtx = await opts.getHealthContext()
      } catch {
        healthCtx = undefined
      }
    }
    return inspectDawHealth(opts.getState(), results, evaluation, healthCtx)
  }

  const done = (stoppedReason: HarnessStopReason, report?: DawHealthReport): HarnessFollowupResult => ({
    results,
    text,
    evaluation,
    actionsSummary,
    turns,
    stoppedReason,
    lastReport: report ?? inspectDawHealth(opts.getState(), results, evaluation, healthCtx),
  })

  for (let i = 1; i <= maxTurns; i++) {
    if (opts.abort?.aborted) return done('aborted')
    const report = await inspect()
    if (!harnessShouldRepair(report)) return done('healthy', report)
    const sig = healthSignature(report)
    if (sig && sig === lastSig) {
      staleCount += 1
      if (staleCount >= HARNESS_STALE_LIMIT) return done('no-progress', report)
    } else {
      staleCount = 0
    }
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
    const chatPrompt = opts.preChat ? await opts.preChat(prompt) : prompt
    const reply = await opts.chat(chatPrompt)
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
    if (actions.length === 0) return done('no-progress', await inspect())
  }

  const finalReport = await inspect()
  return done(harnessShouldRepair(finalReport) ? 'max-turns' : 'healthy', finalReport)
}
