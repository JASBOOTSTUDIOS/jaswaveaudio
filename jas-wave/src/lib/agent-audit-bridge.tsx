/**
 * Renderer: responde al agent-bridge (CLI) con snapshots, catálogo y TODAS las acciones IA.
 * (reload bump: plugin.snapshotState)
 */

import { useEffect, useState } from 'react'
import { useDAW } from '@/src/context/daw-context'
import { audioEngine } from '@/lib/audio-engine'
import {
  getMixMeterTrackOrder,
  getNativeMasterPeak,
  getNativeTrackPeak,
  hasFreshNativeMeters,
  refreshNativeMixMeters,
  snapshotNativeSidechainPeaks,
} from '@/src/lib/plugin/native-mix-meters'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { executeDawActions, type DawAction } from './ai-daw-agent'
import { mergeActionCatalog } from './agent-action-catalog'
import {
  actionRequiresProjectReady,
  waitUntilProjectReady,
} from './project-ready'
import { getLoadedInstrumentForTrack } from './plugin/track-vst-runtime'
import type { HarnessHealthContext } from './agent-harness'

export type AuditTrackLine = {
  id: string
  name: string
  tipo: string
  peak: number
  volumen: number
  paneo: number
  muted: boolean
  solo: boolean
  frozen: boolean
  plugins: string[]
  clips: number
  notes: number
  /** Slot host confirmado; vacío = MIDI no llega al VST. */
  vstSlot?: string
}

export type AuditSnapshot = {
  ok: true
  ts: number
  wallClock: string
  playing: boolean
  enginePlaying: boolean
  playheadSec: number
  playheadBars: string
  bpm: number
  masterPeak: number
  metersFresh: boolean
  hostOk: boolean | null
  tracks: AuditTrackLine[]
  issues: string[]
  hangSuspect: boolean
  hangDetail?: string
}

type FreezeWatch = {
  lastPlayhead: number
  lastMoveAt: number
  lastPeakSum: number
  lastPeakChangeAt: number
}

const watch: FreezeWatch = {
  lastPlayhead: -1,
  lastMoveAt: 0,
  lastPeakSum: -1,
  lastPeakChangeAt: 0,
}

function noteCount(clip: unknown): number {
  const c = clip as { notas?: unknown[]; notes?: unknown[] }
  const n = c.notas ?? c.notes
  return Array.isArray(n) ? n.length : 0
}

function formatBars(sec: number, bpm: number): string {
  const beats = (sec * bpm) / 60
  const bar = Math.floor(beats / 4) + 1
  const beat = Math.floor(beats % 4) + 1
  const tick = Math.floor((beats % 1) * 100)
  return `${bar}.${beat}.${tick}`
}

function projectBpm(st: ReturnType<TiendaDAW['obtenerEstado']>): number {
  const bpmRaw = st.project?.bpm
  if (typeof bpmRaw === 'number') return bpmRaw
  if (typeof bpmRaw === 'object' && bpmRaw && 'valor' in bpmRaw) {
    return Number((bpmRaw as { valor?: number }).valor) || 120
  }
  return 120
}

export async function buildAuditSnapshot(tienda: TiendaDAW): Promise<AuditSnapshot> {
  const st = tienda.obtenerEstado()
  const tracks = st.project?.tracks ?? []
  const playing = Boolean(st.transport?.reproduciendo)
  const bpm = projectBpm(st)

  // Nunca bloquear el renderer: meters con timeout corto (host saturado ≠ hang UI).
  await Promise.race([
    refreshNativeMixMeters().catch(() => undefined),
    new Promise<void>((r) => setTimeout(r, 200)),
  ])

  const playheadSec = audioEngine.getAudibleTimelineSeconds()
  const enginePlaying = playheadSec >= 0 && playing
  const order = getMixMeterTrackOrder()
  const issues: string[] = []

  const lines: AuditTrackLine[] = tracks.map((t) => {
    const clips = t.clips ?? []
    let notes = 0
    for (const c of clips) notes += noteCount(c)
    const webPeak = audioEngine.getMeterLevel(t.id)
    const nativePeak = getNativeTrackPeak(t.id)
    const peak = Math.max(nativePeak ?? 0, webPeak)
    const plugs = (t.plugins ?? []).map((p) => p.nombre)
    const vstSlot = getLoadedInstrumentForTrack(t.id)?.slotId
    return {
      id: t.id,
      name: t.nombre || t.id,
      tipo: t.tipo,
      peak: Number(peak.toFixed(4)),
      volumen: typeof t.volumen === 'number' ? t.volumen : 0.8,
      paneo: typeof t.paneo === 'number' ? t.paneo : 0,
      muted: Boolean(t.silenciada),
      solo: Boolean(t.soloActiva),
      frozen: Boolean(t.frozen),
      plugins: plugs,
      clips: clips.length,
      notes,
      vstSlot,
    }
  })

  const masterPeak = Math.max(getNativeMasterPeak(), audioEngine.getMasterMeterLevel())
  const peakSum = lines.reduce((s, t) => s + t.peak, 0) + masterPeak
  const now = Date.now()

  if (Math.abs(playheadSec - watch.lastPlayhead) > 0.02) {
    watch.lastPlayhead = playheadSec
    watch.lastMoveAt = now
  }
  if (Math.abs(peakSum - watch.lastPeakSum) > 0.002) {
    watch.lastPeakSum = peakSum
    watch.lastPeakChangeAt = now
  }

  let hangSuspect = false
  let hangDetail: string | undefined
  if (playing) {
    if (watch.lastMoveAt && now - watch.lastMoveAt > 800) {
      hangSuspect = true
      hangDetail = `Playhead congelado ~${((now - watch.lastMoveAt) / 1000).toFixed(1)}s en ${playheadSec.toFixed(2)}s`
      issues.push(hangDetail)
    }
    if (watch.lastPeakChangeAt && now - watch.lastPeakChangeAt > 2500 && peakSum < 0.01) {
      issues.push('Meters en silencio prolongado durante Play')
    }
  }

  for (const t of lines) {
    if (t.frozen) issues.push(`Frozen: «${t.name}»`)
  }

  let hostOk: boolean | null = null
  try {
    const status = (await Promise.race([
      window.electron?.pluginHostStatus?.() ?? Promise.resolve(null),
      new Promise<null>((r) => setTimeout(() => r(null), 200)),
    ])) as { vst3HostProcessAvailable?: boolean; nativePid?: number } | null | undefined
    if (status) {
      hostOk = Boolean(status.vst3HostProcessAvailable || status.nativePid)
    } else {
      hostOk = null
    }
  } catch {
    hostOk = false
    issues.push('plugin-host status falló')
  }

  return {
    ok: true,
    ts: now,
    wallClock: new Date(now).toISOString(),
    playing,
    enginePlaying,
    playheadSec: Number(playheadSec.toFixed(3)),
    playheadBars: formatBars(playheadSec, bpm),
    bpm,
    masterPeak: Number(masterPeak.toFixed(4)),
    metersFresh: hasFreshNativeMeters(1500),
    hostOk,
    tracks: lines,
    issues,
    hangSuspect,
    hangDetail,
  }
}

/** Contexto para inspectDawHealth: peaks, slots host, hang. */
export async function buildHarnessHealthContext(
  tienda: TiendaDAW,
  opts?: { sidechainApplied?: boolean },
): Promise<HarnessHealthContext> {
  const snap = await buildAuditSnapshot(tienda)
  const st = tienda.obtenerEstado()
  const sidechains = st.project?.routing?.sidechains?.filter((s) => s.activo !== false) ?? []
  const sidechainHostRouted = sidechains.length > 0
  const destIds = [...new Set(sidechains.map((s) => s.destinoTrackId).filter(Boolean))]
  const sidechainPeaks = snapshotNativeSidechainPeaks(destIds.length ? destIds : getMixMeterTrackOrder())
  return {
    auditTracks: snap.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      notes: t.notes,
      clips: t.clips,
      peak: t.peak,
      vstSlot: t.vstSlot,
      plugins: t.plugins,
    })),
    masterPeak: snap.masterPeak,
    hostOk: snap.hostOk,
    auditIssues: snap.issues,
    hangSuspect: snap.hangSuspect,
    sidechainApplied: opts?.sidechainApplied ?? sidechains.length > 0,
    sidechainHostRouted,
    sidechainPeaks,
  }
}

export function buildStateSummary(tienda: TiendaDAW) {
  const st = tienda.obtenerEstado()
  const tracks = (st.project?.tracks ?? []).map((t) => ({
    id: t.id,
    nombre: t.nombre,
    tipo: t.tipo,
    volumen: t.volumen,
    paneo: t.paneo,
    muted: t.silenciada,
    solo: t.soloActiva,
    frozen: t.frozen,
    plugins: (t.plugins ?? []).map((p) => ({
      id: p.id,
      nombre: p.nombre,
      bypass: p.bypass,
      hasChunk: Boolean(p.estadoPluginBase64),
      chunkBytes: p.estadoPluginBase64 ? Math.floor((p.estadoPluginBase64.length * 3) / 4) : 0,
      params: p.parametros?.length ?? 0,
    })),
    clips: (t.clips ?? []).map((c) => ({
      id: c.id,
      nombre: (c as { nombre?: string }).nombre,
      tipo: (c as { tipo?: string }).tipo,
      inicio: c.inicio,
      duracion: c.duracion,
      notas: noteCount(c),
    })),
  }))
  return {
    ok: true,
    projectId: st.project?.id,
    nombre: st.project?.nombre,
    bpm: projectBpm(st),
    playing: Boolean(st.transport?.reproduciendo),
    positionSec: st.transport?.posicion?.segundos ?? 0,
    master: {
      volumen: st.project?.master?.volumen,
      muted: st.project?.master?.muted,
      plugins: (st.project?.master?.plugins ?? []).map((p) => p.nombre),
    },
    routing: {
      buses: st.project?.routing?.buses?.map((b) => ({ id: b.id, nombre: b.nombre })) ?? [],
      sends: st.project?.routing?.sends?.length ?? 0,
    },
    tracks,
  }
}

export function listAllActions(tienda: TiendaDAW) {
  const registry = tienda.registroComandos.list().map((c) => ({
    type: c.type,
    description: c.description,
    risk: c.risk,
  }))
  const actions = mergeActionCatalog(registry).map((a) => {
    const reg = registry.find((r) => r.type === a.type)
    return {
      ...a,
      risk: reg?.risk,
      description: a.description || reg?.description || a.type,
    }
  })
  return { ok: true as const, count: actions.length, actions }
}

export async function controlTransport(
  tienda: TiendaDAW,
  action: string,
  seekSec?: number,
): Promise<{ ok: boolean; playing: boolean; message: string }> {
  const st = tienda.obtenerEstado()
  const playing = Boolean(st.transport?.reproduciendo)

  if (action === 'seek' && typeof seekSec === 'number') {
    await tienda.executor.execute('transport.seek', { segundos: seekSec })
    return { ok: true, playing, message: `seek ${seekSec}s` }
  }
  if (action === 'stop') {
    await tienda.executor.execute('transport.stop', {})
    return { ok: true, playing: false, message: 'stop' }
  }
  if (action === 'play' || action === 'toggle') {
    if (action === 'play' && playing) {
      return { ok: true, playing: true, message: 'play' }
    }
    if (action === 'play' || !playing) {
      await waitUntilProjectReady({ timeoutMs: 18_000, allowDegraded: true })
    }
    if (action === 'play') {
      if (!tienda.obtenerEstado().transport?.reproduciendo) {
        await tienda.executor.execute('transport.toggle', {})
      }
      return { ok: true, playing: true, message: 'play' }
    }
    await tienda.executor.execute('transport.toggle', {})
    const next = Boolean(tienda.obtenerEstado().transport?.reproduciendo)
    return { ok: true, playing: next, message: 'toggle' }
  }
  if (action === 'pause') {
    if (playing) await tienda.executor.execute('transport.toggle', {})
    return { ok: true, playing: false, message: 'pause' }
  }
  return { ok: false, playing, message: `acción desconocida: ${action}` }
}

/** Misma vía que el chat IA: executeDawActions. */
export async function runCliActions(tienda: TiendaDAW, actions: DawAction[]) {
  if (actions.some((a) => actionRequiresProjectReady(a.type))) {
    await waitUntilProjectReady({ timeoutMs: 18_000, allowDegraded: true })
  }
  // Fast-path timing (no depende de HMR del switch grande)
  const expanded: DawAction[] = []
  const early: Array<{ type: string; success: boolean; message: string; data?: unknown }> = []
  for (const a of actions) {
    if (a.type === 'analysis.timing') {
      const d = audioEngine.getTimingDiagnostics()
      const skewVsAhead = Math.abs(d.skewMs - d.pathAheadMs)
      const ok = !d.playing || skewVsAhead < 40
      early.push({
        type: a.type,
        success: true,
        message: ok
          ? `Timing OK · ahead ${d.pathAheadMs.toFixed(0)} ms · buf ${d.bufferSize} · ${d.sampleRate} Hz`
          : `Timing sospechoso · skew ${d.skewMs.toFixed(0)} ms vs ahead ${d.pathAheadMs.toFixed(0)} ms · buf ${d.bufferSize}`,
        data: { ...d, ok, skewVsAheadMs: skewVsAhead },
      })
    } else if (a.type === 'analysis.buffer') {
      const { analyzeBufferHealth } = await import('./audio-buffer-health')
      const p = (a.payload ?? {}) as { sampleMs?: number; reset?: boolean }
      const sampleMs = typeof p.sampleMs === 'number' ? p.sampleMs : 400
      const report = await Promise.race([
        analyzeBufferHealth({
          sampleMs,
          reset: p.reset !== false,
        }),
        new Promise<null>((r) => setTimeout(() => r(null), Math.min(8000, sampleMs + 2500))),
      ])
      if (!report) {
        early.push({
          type: a.type,
          success: false,
          message: 'analysis.buffer timeout (host IPC lento)',
          data: { status: 'unknown', ok: false },
        })
      } else {
        early.push({
          type: a.type,
          success: true,
          message: `[${report.status}] ${report.summary}`,
          data: report,
        })
      }
    } else if (a.type === 'analysis.fxBlame') {
      const { runFxBlame } = await import('./audio-fx-blame')
      const p = (a.payload ?? {}) as {
        sampleMs?: number
        settleMs?: number
        includeInstruments?: boolean
        trackId?: string
        maxCandidates?: number
      }
      const report = await runFxBlame({
        getState: () => tienda.obtenerEstado(),
        setBypass: async (trackId, pluginInstanceId, bypass) => {
          const r = await tienda.executor.execute('plugin.bypass', {
            trackId,
            pluginInstanceId,
            bypass,
          })
          return Boolean(r.success)
        },
        sampleMs: typeof p.sampleMs === 'number' ? p.sampleMs : 350,
        settleMs: typeof p.settleMs === 'number' ? p.settleMs : 120,
        includeInstruments: p.includeInstruments === true,
        trackId: typeof p.trackId === 'string' ? p.trackId : undefined,
        maxCandidates: typeof p.maxCandidates === 'number' ? p.maxCandidates : 24,
      })
      early.push({
        type: a.type,
        success: true,
        message: report.summary,
        data: report,
      })
    } else if (a.type === 'plugin.snapshotState') {
      // Fast-path: no depender del HMR del switch enorme en ai-daw-agent.
      const { snapshotLoadedPluginsIntoProject, snapshotTrackPluginIntoProject } = await import(
        './plugin/track-vst-runtime'
      )
      const p = (a.payload ?? {}) as {
        trackId?: string
        pluginId?: string
        pluginInstanceId?: string
      }
      const trackId = p.trackId != null ? String(p.trackId) : ''
      const pluginId =
        p.pluginId != null
          ? String(p.pluginId)
          : p.pluginInstanceId != null
            ? String(p.pluginInstanceId)
            : ''
      if (trackId && pluginId) {
        const one = await snapshotTrackPluginIntoProject(tienda, trackId, pluginId)
        early.push({
          type: a.type,
          success: one.ok,
          message: one.ok
            ? `Snapshot VST${one.hasChunk ? ' + chunk' : ' (solo params)'}`
            : 'Slot no cargado o sin path',
          data: one,
        })
      } else {
        const all = await snapshotLoadedPluginsIntoProject(tienda)
        early.push({
          type: a.type,
          success: all.slots > 0,
          message: `Snapshot ${all.withChunk}/${all.slots} slots con chunk VST`,
          data: all,
        })
      }
    } else {
      expanded.push(a)
    }
  }
  const results = expanded.length
    ? await executeDawActions(tienda, expanded, {
        agentMode: 'create',
        forceApply: true,
        respectModeGate: false,
        source: 'cli',
      })
    : []
  const all = [...early, ...results]
  return {
    ok: all.every((r) => r.success),
    results: all,
  }
}

/** Bump en cada cambio del bridge para forzar remount tras HMR. */
export const AGENT_BRIDGE_REV = 15

/** Montar en App: escucha agent-bridge-request del main. */
export function AgentAuditHost() {
  const tienda = useDAW()

  useEffect(() => {
    const api = window.electron as
      | {
          onAgentBridgeRequest?: (
            cb: (msg: { id: string; channel: string; payload: Record<string, unknown> }) => void,
          ) => () => void
          agentBridgeReply?: (id: string, result: unknown, error?: string) => void
        }
      | undefined
    if (!api?.onAgentBridgeRequest || !api.agentBridgeReply) return

    return api.onAgentBridgeRequest((msg) => {
      void (async () => {
        try {
          if (msg.channel === 'audit.snapshot') {
            api.agentBridgeReply?.(msg.id, await buildAuditSnapshot(tienda))
            return
          }
          if (msg.channel === 'state.summary') {
            api.agentBridgeReply?.(msg.id, buildStateSummary(tienda))
            return
          }
          if (msg.channel === 'actions.list') {
            api.agentBridgeReply?.(msg.id, listAllActions(tienda))
            return
          }
          if (msg.channel === 'transport.control') {
            const action = String(msg.payload?.action ?? '')
            const seekSec =
              typeof msg.payload?.seekSec === 'number' ? msg.payload.seekSec : undefined
            api.agentBridgeReply?.(msg.id, await controlTransport(tienda, action, seekSec))
            return
          }
          if (msg.channel === 'actions.execute' || msg.channel === 'command.execute') {
            let actions: DawAction[] = []
            if (Array.isArray(msg.payload?.actions)) {
              actions = msg.payload.actions as DawAction[]
            } else if (msg.payload?.type) {
              actions = [
                {
                  type: String(msg.payload.type),
                  payload: (msg.payload.payload ?? {}) as Record<string, unknown>,
                },
              ]
            }
            if (!actions.length) {
              api.agentBridgeReply?.(msg.id, null, 'Falta type o actions[]')
              return
            }
            // Separar analysis.* / audio.armNative / plugin.snapshotState (inline) del resto
            const special = actions.filter(
              (a) =>
                a.type === 'analysis.timing' ||
                a.type === 'analysis.buffer' ||
                a.type === 'audio.armNative' ||
                a.type === 'plugin.snapshotState',
            )
            const otherActions = actions.filter(
              (a) =>
                a.type !== 'analysis.timing' &&
                a.type !== 'analysis.buffer' &&
                a.type !== 'audio.armNative' &&
                a.type !== 'plugin.snapshotState',
            )
            const specialResults: Array<{
              type: string
              success: boolean
              message: string
              data?: unknown
            }> = []
            for (const a of special) {
              if (a.type === 'analysis.timing') {
                const d = audioEngine.getTimingDiagnostics()
                const skewVsAhead = Math.abs(d.skewMs - d.pathAheadMs)
                const ok =
                  !d.playing ||
                  (d.nativeOutput ? skewVsAhead < 40 : Math.abs(d.skewMs) < 80)
                specialResults.push({
                  type: 'analysis.timing',
                  success: true,
                  message: ok
                    ? `Timing OK · ahead ${d.pathAheadMs.toFixed(0)} ms · buf ${d.bufferSize} · native=${d.nativeOutput}${d.lastArmError ? ` · armErr=${d.lastArmError}` : ''}`
                    : `Timing sospechoso · skew ${d.skewMs.toFixed(0)} ms · ahead ${d.pathAheadMs.toFixed(0)} · native=${d.nativeOutput} · ${d.lastArmError || ''}`,
                  data: { ...d, ok, skewVsAheadMs: skewVsAhead },
                })
              } else if (a.type === 'analysis.buffer') {
                const { analyzeBufferHealth } = await import('./audio-buffer-health')
                const p = (a.payload ?? {}) as { sampleMs?: number; reset?: boolean }
                const sampleMs = typeof p.sampleMs === 'number' ? p.sampleMs : 400
                const report = await Promise.race([
                  analyzeBufferHealth({
                    sampleMs,
                    reset: p.reset !== false,
                  }),
                  new Promise<null>((r) => setTimeout(() => r(null), Math.min(8000, sampleMs + 2500))),
                ])
                if (!report) {
                  specialResults.push({
                    type: 'analysis.buffer',
                    success: false,
                    message: 'analysis.buffer timeout (host IPC lento)',
                    data: { status: 'unknown', ok: false },
                  })
                } else {
                  specialResults.push({
                    type: 'analysis.buffer',
                    success: true,
                    message: `[${report.status}] ${report.summary}`,
                    data: report,
                  })
                }
              } else if (a.type === 'audio.armNative') {
                const ok = await audioEngine.armNativeMixOutput()
                const d = audioEngine.getTimingDiagnostics()
                specialResults.push({
                  type: 'audio.armNative',
                  success: ok,
                  message: ok
                    ? `Native mix armado · ahead ${d.pathAheadMs.toFixed(0)} ms · buf ${d.bufferSize}`
                    : `Native mix NO armado: ${d.lastArmError || 'desconocido'}`,
                  data: d,
                })
              } else if (a.type === 'plugin.snapshotState') {
                const { snapshotLoadedPluginsIntoProject, snapshotTrackPluginIntoProject } =
                  await import('./plugin/track-vst-runtime')
                const p = (a.payload ?? {}) as {
                  trackId?: string
                  pluginId?: string
                  pluginInstanceId?: string
                }
                const trackId = p.trackId != null ? String(p.trackId) : ''
                const pluginId =
                  p.pluginId != null
                    ? String(p.pluginId)
                    : p.pluginInstanceId != null
                      ? String(p.pluginInstanceId)
                      : ''
                if (trackId && pluginId) {
                  const one = await snapshotTrackPluginIntoProject(tienda, trackId, pluginId)
                  specialResults.push({
                    type: a.type,
                    success: one.ok,
                    message: one.ok
                      ? `Snapshot VST${one.hasChunk ? ' + chunk' : ' (solo params)'}`
                      : 'Slot no cargado o sin path',
                    data: one,
                  })
                } else {
                  const all = await snapshotLoadedPluginsIntoProject(tienda)
                  specialResults.push({
                    type: a.type,
                    success: all.slots > 0,
                    message: `Snapshot ${all.withChunk}/${all.slots} slots con chunk VST`,
                    data: all,
                  })
                }
              }
            }
            const other = otherActions.length
              ? await runCliActions(tienda, otherActions)
              : { ok: true, results: [] }
            const results = [...(other.results || []), ...specialResults]
            api.agentBridgeReply?.(msg.id, {
              ok: results.every((r: { success?: boolean }) => r.success !== false),
              results,
            })
            return
          }
          api.agentBridgeReply?.(msg.id, null, `canal desconocido: ${msg.channel}`)
        } catch (e) {
          api.agentBridgeReply?.(msg.id, null, e instanceof Error ? e.message : String(e))
        }
      })()
    })
  }, [tienda])

  // Re-suscribir el bridge tras HMR para no quedar con closures viejos
  useEffect(() => {
    const hot = (import.meta as ImportMeta & { hot?: { accept: (cb?: () => void) => void } }).hot
    hot?.accept?.()
  }, [])

  return null
}
