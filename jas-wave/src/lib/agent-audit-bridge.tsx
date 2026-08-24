/**
 * Renderer: responde al agent-bridge (CLI) con snapshots, catálogo y TODAS las acciones IA.
 */

import { useEffect } from 'react'
import { useDAW } from '@/src/context/daw-context'
import { audioEngine } from '@/lib/audio-engine'
import {
  getMixMeterTrackOrder,
  getNativeMasterPeak,
  getNativeTrackPeak,
  hasFreshNativeMeters,
  refreshNativeMixMeters,
} from '@/src/lib/plugin/native-mix-meters'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { executeDawActions, type DawAction } from './ai-daw-agent'
import { mergeActionCatalog } from './agent-action-catalog'

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

  await refreshNativeMixMeters().catch(() => undefined)

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
    const status = await window.electron?.pluginHostStatus?.()
    hostOk = Boolean(status?.vst3HostProcessAvailable || status?.nativePid)
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
    plugins: (t.plugins ?? []).map((p) => ({ id: p.id, nombre: p.nombre, bypass: p.bypass })),
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
  if (action === 'play') {
    if (!playing) await tienda.executor.execute('transport.toggle', {})
    return { ok: true, playing: true, message: 'play' }
  }
  if (action === 'pause') {
    if (playing) await tienda.executor.execute('transport.toggle', {})
    return { ok: true, playing: false, message: 'pause' }
  }
  if (action === 'toggle') {
    await tienda.executor.execute('transport.toggle', {})
    const next = Boolean(tienda.obtenerEstado().transport?.reproduciendo)
    return { ok: true, playing: next, message: 'toggle' }
  }
  return { ok: false, playing, message: `acción desconocida: ${action}` }
}

/** Misma vía que el chat IA: executeDawActions. */
export async function runCliActions(tienda: TiendaDAW, actions: DawAction[]) {
  const results = await executeDawActions(tienda, actions, {
    agentMode: 'create',
    forceApply: true,
    respectModeGate: false,
    source: 'cli',
  })
  return {
    ok: results.every((r) => r.success),
    results,
  }
}

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
            api.agentBridgeReply?.(msg.id, await runCliActions(tienda, actions))
            return
          }
          api.agentBridgeReply?.(msg.id, null, `canal desconocido: ${msg.channel}`)
        } catch (e) {
          api.agentBridgeReply?.(msg.id, null, e instanceof Error ? e.message : String(e))
        }
      })()
    })
  }, [tienda])

  return null
}
