/**
 * Aísla qué FX (o instrumento) degrada el audio en vivo.
 * Método: baseline → bypass uno a uno → medir buffer + peak → restaurar.
 * Usado por analysis.fxBlame (CLI + IA).
 */

import { analyzeBufferHealth, type BufferHealthReport } from './audio-buffer-health'
import { refreshNativeMixMeters, getNativeMasterPeak, getNativeMaxStemPeak } from './plugin/native-mix-meters'
import { syncNativeChannelMix } from './plugin/track-channel-mix'
import {
  extractHostPluginPath,
  isBuiltinInstrument,
  isVstInstrumentPlugin,
} from './plugin/track-vst-runtime'
import type { DAWState } from '../../../shared/src/types/state'
import type { PluginInfo } from '../../../shared/src/types/entidades'

export type FxBlameRole = 'instrument' | 'effect' | 'master'

export type FxBlameCandidate = {
  trackId: string
  trackName: string
  pluginInstanceId: string
  pluginName: string
  role: FxBlameRole
  wasBypassed: boolean
  path?: string
}

export type FxBlameSample = {
  label: string
  trackId?: string
  pluginInstanceId?: string
  pluginName?: string
  role?: FxBlameRole
  bufferStatus: BufferHealthReport['status']
  bufferSummary: string
  underrunDelta: number
  overflowDelta: number
  highFillDropDelta: number
  fillRatioVsTarget: number | null
  masterPeak: number
  maxStemPeak: number
  /** Mayor = peor salud de audio en ese paso. */
  badness: number
  /** Mejora vs baseline al bypass (solo en pasos de bypass). */
  improvement?: number
}

export type FxBlameSuspect = {
  trackId: string
  pluginInstanceId: string
  pluginName: string
  trackName: string
  role: FxBlameRole
  improvement: number
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export type FxBlameReport = {
  ok: boolean
  summary: string
  baselineBadness: number
  allEffectsBypassedBadness: number | null
  softPadPathSuspected: boolean
  suspects: FxBlameSuspect[]
  baseline: FxBlameSample
  steps: FxBlameSample[]
  advice: string[]
  candidatesTried: number
  sampleMs: number
  settleMs: number
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/** Puntuación de “qué tan mal suena/estabilidad” a partir del buffer + peaks. */
export function scoreAudioBadness(opts: {
  status: BufferHealthReport['status']
  underrunDelta: number
  overflowDelta: number
  highFillDropDelta: number
  fillRatioVsHigh: number | null
  masterPeak: number
  maxStemPeak: number
}): number {
  let s = 0
  if (opts.status === 'saturated') s += 100
  else if (opts.status === 'starving') s += 85
  else if (opts.status === 'disconnected') s += 60
  else if (opts.status === 'unknown') s += 15

  s += Math.min(60, opts.underrunDelta * 2)
  s += Math.min(40, opts.overflowDelta / 4)
  s += Math.min(100, opts.highFillDropDelta / 500)
  if (opts.fillRatioVsHigh != null && opts.fillRatioVsHigh >= 0.9) {
    s += 30
  }

  const peak = Math.max(opts.masterPeak, opts.maxStemPeak)
  if (peak >= 0.99) s += 45
  else if (peak >= 0.95) s += 25
  else if (peak < 0.001) s += 5 // silencio total puede indicar cadena rota

  return Math.round(s)
}

export function confidenceFromImprovement(improvement: number, baseline: number): 'high' | 'medium' | 'low' {
  if (baseline <= 5) return 'low'
  const ratio = improvement / Math.max(1, baseline)
  if (improvement >= 40 || ratio >= 0.45) return 'high'
  if (improvement >= 18 || ratio >= 0.22) return 'medium'
  return 'low'
}

function listCandidates(
  state: DAWState,
  opts: { includeInstruments: boolean; trackId?: string },
): FxBlameCandidate[] {
  const out: FxBlameCandidate[] = []
  const tracks = state.project?.tracks ?? []
  for (const t of tracks) {
    if (opts.trackId && t.id !== opts.trackId) continue
    for (const p of t.plugins ?? []) {
      if (isBuiltinInstrument(p)) continue
      const path = extractHostPluginPath(p.descripcion)
      if (!path) continue
      const instrument = isVstInstrumentPlugin(p, path)
      if (instrument && !opts.includeInstruments) continue
      out.push({
        trackId: t.id,
        trackName: t.nombre || t.id,
        pluginInstanceId: p.id,
        pluginName: p.nombre || p.id,
        role: instrument ? 'instrument' : 'effect',
        wasBypassed: Boolean(p.bypass),
        path,
      })
    }
  }
  if (!opts.trackId || opts.trackId === 'master') {
    for (const p of state.project?.master?.plugins ?? []) {
      if (isBuiltinInstrument(p)) continue
      const path = extractHostPluginPath(p.descripcion)
      if (!path) continue
      out.push({
        trackId: 'master',
        trackName: 'Master',
        pluginInstanceId: p.id,
        pluginName: p.nombre || p.id,
        role: 'master',
        wasBypassed: Boolean(p.bypass),
        path,
      })
    }
  }
  return out
}

async function sampleLabeled(
  label: string,
  sampleMs: number,
  extra?: Partial<FxBlameSample>,
): Promise<FxBlameSample> {
  await refreshNativeMixMeters()
  const buffer = await analyzeBufferHealth({ sampleMs, reset: true })
  await refreshNativeMixMeters()
  const masterPeak = getNativeMasterPeak()
  const maxStemPeak = getNativeMaxStemPeak()
  const badness = scoreAudioBadness({
    status: buffer.status,
    underrunDelta: buffer.underrunDelta,
    overflowDelta: buffer.overflowDelta,
    highFillDropDelta: buffer.highFillDropDelta,
    fillRatioVsHigh: buffer.fillRatioVsHigh,
    masterPeak,
    maxStemPeak,
  })
  return {
    label,
    bufferStatus: buffer.status,
    bufferSummary: buffer.summary,
    underrunDelta: buffer.underrunDelta,
    overflowDelta: buffer.overflowDelta,
    highFillDropDelta: buffer.highFillDropDelta,
    fillRatioVsTarget: buffer.fillRatioVsTarget,
    masterPeak,
    maxStemPeak,
    badness,
    ...extra,
  }
}

function syncGraphFromState(state: DAWState) {
  syncNativeChannelMix(state.project?.tracks ?? [], state.project?.master)
}

export async function runFxBlame(opts: {
  getState: () => DAWState
  setBypass: (trackId: string, pluginInstanceId: string, bypass: boolean) => Promise<boolean>
  sampleMs?: number
  settleMs?: number
  includeInstruments?: boolean
  trackId?: string
  /** Tope de plugins a probar (el resto se reporta sin medir). */
  maxCandidates?: number
}): Promise<FxBlameReport> {
  const sampleMs = Math.max(120, Math.min(1500, opts.sampleMs ?? 350))
  const settleMs = Math.max(40, Math.min(800, opts.settleMs ?? 120))
  const includeInstruments = opts.includeInstruments === true
  const maxCandidates = Math.max(1, Math.min(48, opts.maxCandidates ?? 24))

  const state0 = opts.getState()
  const all = listCandidates(state0, { includeInstruments, trackId: opts.trackId })
  const candidates = all.slice(0, maxCandidates)

  const baseline = await sampleLabeled('baseline', sampleMs)
  const steps: FxBlameSample[] = []
  const advice: string[] = []

  // Control: bypass de todos los efectos (no instrumentos) de una vez.
  let allEffectsBypassedBadness: number | null = null
  const effectCandidates = candidates.filter((c) => c.role !== 'instrument' && !c.wasBypassed)
  if (effectCandidates.length > 0) {
    for (const c of effectCandidates) {
      await opts.setBypass(c.trackId, c.pluginInstanceId, true)
    }
    syncGraphFromState(opts.getState())
    await sleep(settleMs)
    const allOff = await sampleLabeled('all_effects_bypassed', sampleMs)
    allOff.improvement = baseline.badness - allOff.badness
    steps.push(allOff)
    allEffectsBypassedBadness = allOff.badness
    for (const c of effectCandidates) {
      await opts.setBypass(c.trackId, c.pluginInstanceId, false)
    }
    syncGraphFromState(opts.getState())
    await sleep(settleMs)
  }

  const suspects: FxBlameSuspect[] = []

  for (const c of candidates) {
    if (c.wasBypassed) continue
    const ok = await opts.setBypass(c.trackId, c.pluginInstanceId, true)
    if (!ok) continue
    syncGraphFromState(opts.getState())
    await sleep(settleMs)
    const step = await sampleLabeled(`bypass:${c.pluginName}`, sampleMs, {
      trackId: c.trackId,
      pluginInstanceId: c.pluginInstanceId,
      pluginName: c.pluginName,
      role: c.role,
    })
    step.improvement = baseline.badness - step.badness
    steps.push(step)

    await opts.setBypass(c.trackId, c.pluginInstanceId, false)
    syncGraphFromState(opts.getState())
    await sleep(Math.min(settleMs, 80))

    const improvement = step.improvement ?? 0
    if (improvement >= 12) {
      const confidence = confidenceFromImprovement(improvement, baseline.badness)
      const peakDrop =
        Math.max(baseline.masterPeak, baseline.maxStemPeak) -
        Math.max(step.masterPeak, step.maxStemPeak)
      let reason = `Al bypass, badness ${baseline.badness}→${step.badness} (Δ${improvement})`
      if (step.highFillDropDelta + 2000 < baseline.highFillDropDelta) {
        reason += '; menos drops de ring'
      }
      if (step.underrunDelta + 4 < baseline.underrunDelta) {
        reason += '; menos underruns'
      }
      if (peakDrop > 0.2 && c.role === 'instrument') {
        reason += '; también baja el nivel (instrumento activo)'
      }
      if (step.bufferStatus === 'healthy' && baseline.bufferStatus !== 'healthy') {
        reason += '; buffer pasa a healthy'
      }
      suspects.push({
        trackId: c.trackId,
        pluginInstanceId: c.pluginInstanceId,
        pluginName: c.pluginName,
        trackName: c.trackName,
        role: c.role,
        improvement,
        confidence,
        reason,
      })
    }
  }

  // Restaurar bypass originales por si algo quedó a medias
  const stateEnd = opts.getState()
  for (const c of candidates) {
    const plugs =
      c.trackId === 'master'
        ? stateEnd.project?.master?.plugins ?? []
        : stateEnd.project?.tracks?.find((t) => t.id === c.trackId)?.plugins ?? []
    const cur = plugs.find((p: PluginInfo) => p.id === c.pluginInstanceId)
    if (cur && Boolean(cur.bypass) !== c.wasBypassed) {
      await opts.setBypass(c.trackId, c.pluginInstanceId, c.wasBypassed)
    }
  }
  syncGraphFromState(opts.getState())

  suspects.sort((a, b) => b.improvement - a.improvement)

  const softPadPathSuspected =
    baseline.badness >= 25 &&
    (allEffectsBypassedBadness == null || allEffectsBypassedBadness >= baseline.badness * 0.75) &&
    suspects.length === 0

  if (softPadPathSuspected) {
    advice.push(
      'Ningún FX individual explica el daño: sospecha mix→pipe→ASIO (analysis.buffer) o CPU global',
    )
    advice.push('Prueba audio.setDevice bufferSize:1024 y analysis.buffer { sampleMs:800 }')
  }
  if (suspects[0]) {
    const top = suspects[0]
    advice.push(
      `Bypass o sustituye: ${top.pluginName} en ${top.trackName} (${top.role}) · plugin.bypass`,
    )
    if (top.role === 'master') {
      advice.push('Si es master FX: baja gain/ceiling o cámbialo en daw.masterPass')
    }
  }
  if (allEffectsBypassedBadness != null && allEffectsBypassedBadness + 15 < baseline.badness) {
    advice.push('Con todos los efectos en bypass mejora mucho → culpa de la cadena FX, no del path mix')
  }
  if (all.length > candidates.length) {
    advice.push(`Solo se probaron ${candidates.length}/${all.length} plugins (maxCandidates)`)
  }
  if (candidates.length === 0) {
    advice.push('No hay VST en cadena (solo builtins/mix). Usa analysis.buffer')
  }

  const top = suspects[0]
  const summary =
    top != null
      ? `Sospechoso #1: ${top.pluginName} @ ${top.trackName} (Δ${top.improvement}, ${top.confidence}) · baseline badness=${baseline.badness}`
      : softPadPathSuspected
        ? `Sin FX culpable claro · baseline badness=${baseline.badness} · revisar mix/ASIO`
        : baseline.badness < 15
          ? `Cadena OK · baseline badness=${baseline.badness}`
          : `Problema presente (badness=${baseline.badness}) pero no aislado a un FX`

  return {
    ok: baseline.badness < 25 && suspects.length === 0,
    summary,
    baselineBadness: baseline.badness,
    allEffectsBypassedBadness,
    softPadPathSuspected,
    suspects,
    baseline,
    steps,
    advice,
    candidatesTried: candidates.filter((c) => !c.wasBypassed).length,
    sampleMs,
    settleMs,
  }
}
