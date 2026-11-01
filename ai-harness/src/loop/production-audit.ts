/**
 * Auditor de producción (compilador post-mutación).
 * Determinista: VST, rango MIDI, clips vs marcadores, mezcla, listen.
 */

import type { DAWState } from '@jaswave/shared'
import {
  formatSectionGapLine,
  isMidiLikeTrack,
  listSectionGaps,
  type SectionGap,
} from '../plan/section-coverage'
import { evaluateArrangementQuality } from '../quality/arrangement-quality-gate'
import { evaluateMidiQuality } from '../quality/midi-quality-gate'
import { evaluateRenderQuality } from '../quality/render-quality-gate'
import type { QualityFinding } from '../quality/types'

export type ProductionIssue = {
  severity: 'error' | 'warn'
  code: string
  message: string
}

export type ProductionPluginGuide = {
  trackId: string
  pluginName: string
  /** Rol inferido del VST (drums, bass, piano…). */
  role: string
  /** Rol de la pista (tag role: o nombre). */
  trackRole?: string
  chromatic: boolean
  range: { lo: number; hi: number }
  keyswitchPitches?: number[]
  drumMapPitches?: number[]
}

export type ProductionListenEvidence = {
  ok: boolean
  issues?: string[]
  summary?: string
  target?: string
}

export type ProductionAuditContext = {
  pluginGuides?: ProductionPluginGuide[]
  lastListen?: ProductionListenEvidence | null
  loudnessTarget?: 'streaming' | 'club' | 'cd'
  requireListen?: boolean
  builtProject?: boolean
  mutatedMidi?: boolean
  minAudiblePeak?: number
}

export type ProductionAuditReport = {
  errors: ProductionIssue[]
  warnings: ProductionIssue[]
  sectionGaps: SectionGap[]
  nextGap: SectionGap | null
}

const ROLE_COMPAT: Record<string, string[]> = {
  drums: ['drums', 'percussion'],
  percussion: ['drums', 'percussion'],
  piano: ['piano', 'keys'],
  keys: ['piano', 'keys', 'synth', 'pad'],
  pad: ['pad', 'synth', 'keys'],
  lead: ['lead', 'synth', 'synth'],
  bass: ['bass'],
  guitar: ['guitar'],
  synth: ['synth', 'lead', 'pad', 'keys'],
}

function rolesCompatible(pluginRole: string, trackRole: string): boolean {
  const a = pluginRole.toLowerCase()
  const b = trackRole.toLowerCase()
  if (!a || !b || a === 'unknown' || b === 'unknown') return true
  if (a === b) return true
  const ok = ROLE_COMPAT[a]
  return ok ? ok.includes(b) : false
}

function nearly(a: number, b: number, eps = 0.03): boolean {
  return Math.abs(a - b) <= eps
}

function findingToIssue(f: QualityFinding): ProductionIssue {
  return {
    severity: f.verdict === 'fail' ? 'error' : 'warn',
    code: f.code,
    message: f.message,
  }
}

export function inspectProduction(
  state: DAWState,
  ctx?: ProductionAuditContext,
): ProductionAuditReport {
  const errors: ProductionIssue[] = []
  const warnings: ProductionIssue[] = []
  const sectionGaps = listSectionGaps(state)
  const guides = ctx?.pluginGuides ?? []
  const guideByTrack = new Map(guides.map((g) => [g.trackId, g]))

  const arr = evaluateArrangementQuality(state)
  const midi = evaluateMidiQuality({
    state,
    mutatedMidi: ctx?.mutatedMidi,
    builtProject: ctx?.builtProject,
    pluginGuides: guides,
  })
  const midiTracks = (state.project?.tracks ?? []).filter((t) => isMidiLikeTrack(t.tipo))
  const render = evaluateRenderQuality({
    requireListen: ctx?.requireListen,
    lastListen: ctx?.lastListen,
    loudnessTarget: ctx?.loudnessTarget,
    sectionsCovered: sectionGaps.length === 0,
    hasMidiClips: midiTracks.some((t) => (t.clips ?? []).length > 0),
    builtOrMutated: Boolean(ctx?.builtProject || ctx?.mutatedMidi),
  })
  for (const f of [...arr.findings, ...midi.findings, ...render.findings]) {
    const issue = findingToIssue(f)
    if (issue.severity === 'error') errors.push(issue)
    else warnings.push(issue)
  }

  for (const t of midiTracks) {
    const label = t.nombre || t.id
    const guide = guideByTrack.get(t.id)
    const trackRole =
      guide?.trackRole ||
      (t.tags ?? [])
        .map((x) => String(x))
        .find((x) => x.startsWith('role:'))
        ?.slice(5)
    if (guide && trackRole && !rolesCompatible(guide.role, trackRole)) {
      errors.push({
        severity: 'error',
        code: 'vst-role-mismatch',
        message: `«${label}» rol pista=${trackRole} vs VST «${guide.pluginName}» (${guide.role}).`,
      })
    }
    const notes = (t.clips ?? []).reduce((n, c) => n + ((c as { notas?: unknown[] }).notas?.length ?? 0), 0)
    if (notes > 0 && t.silenciada) {
      errors.push({
        severity: 'error',
        code: 'mix-muted-with-notes',
        message: `«${label}» tiene notas pero está muteada.`,
      })
    }
  }

  const soloed = midiTracks.filter((t) => t.soloActiva)
  if (soloed.length && midiTracks.length > 1) {
    warnings.push({
      severity: 'warn',
      code: 'mute-or-solo-stuck',
      message: `Solo activo en: ${soloed.map((t) => t.nombre).join(', ')} — el resto no se oirá.`,
    })
  }

  const mixable = midiTracks.filter((t) => {
    const n = (t.clips ?? []).reduce((s, c) => s + ((c as { notas?: unknown[] }).notas?.length ?? 0), 0)
    return n > 0 && typeof t.volumen === 'number'
  })
  if (mixable.length >= 2) {
    const allDefault = mixable.every(
      (t) => nearly(Number(t.volumen), 0.8) && nearly(Number(t.paneo ?? 0), 0),
    )
    if (allDefault) {
      const issue: ProductionIssue = {
        severity: ctx?.builtProject ? 'error' : 'warn',
        code: 'mix-defaults',
        message:
          'Todas las pistas con MIDI siguen en vol≈0.8 y pan=0 — ajusta niveles/paneo por rol (no dejes el fader por defecto).',
      }
      if (issue.severity === 'error') errors.push(issue)
      else warnings.push(issue)
    }
  }
  if (mixable.length >= 3) {
    const centered = mixable.filter((t) => nearly(Number(t.paneo ?? 0), 0))
    if (centered.length >= 3) {
      warnings.push({
        severity: 'warn',
        code: 'mix-collapsed-center',
        message: `${centered.length} pistas MIDI con pan≈0 — abre la imagen estéreo (panea drums/keys/lead).`,
      })
    }
  }

  return {
    errors,
    warnings,
    sectionGaps,
    nextGap: sectionGaps[0] ?? null,
  }
}

export function formatNextGapInstruction(gap: SectionGap | null): string {
  if (!gap) return 'No hay huecos de sección. Pasa a mezcla/listen si el audit lo pide.'
  return `Siguiente hueco: pista «${gap.trackName}» (${gap.trackId}) sección ${gap.section} beats ${gap.start}–${gap.end}. midi.clip.create { pistaId: "${gap.trackId}", inicio: ${gap.start}, duracion: ${gap.end - gap.start}, notas:[...] } — OBLIGATORIO notas[].`
}
