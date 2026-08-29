/**
 * Diagnóstico de saturación / underrun del path Soft Pad → pipe → ring → ASIO.
 * Usado por analysis.buffer (CLI + IA + Medidores).
 */

import { audioEngine } from '@/lib/audio-engine'

export type MixRingStats = {
  running: boolean
  capacity: number
  targetFill: number
  highFill: number
  dawFill: number
  minLiveFill: number
  maxLiveFill: number
  liveTracks: number
  pullBudget: number
  inRate: number
  outRate: number
  underrunBlocks: number
  overflowPushes: number
  highFillDropFrames: number
}

export type BufferHealthReport = {
  ok: boolean
  status: 'healthy' | 'starving' | 'saturated' | 'disconnected' | 'unknown'
  summary: string
  issues: string[]
  advice: string[]
  sampleRate: number
  bufferSize: number
  nativeOutput: boolean
  mixPipeConnected: boolean
  mixQueueDepth: number
  mixBackpressure: boolean
  chromeBaseLatencyMs: number | null
  chromeOutputLatencyMs: number | null
  pathAheadMs: number
  ring: MixRingStats | null
  /** Fill del anillo vivo vs target (0 = vacío, 1 = target, >1 = por encima). */
  fillRatioVsTarget: number | null
  /** Fill vs highFill (1 = saturación). */
  fillRatioVsHigh: number | null
  underrunDelta: number
  overflowDelta: number
  highFillDropDelta: number
  sampledMs: number
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

async function readHostPipeStatus(): Promise<{
  mixPipeConnected: boolean
  mixQueueDepth: number
  mixBackpressure: boolean
  backend?: string
}> {
  const empty = {
    mixPipeConnected: false,
    mixQueueDepth: 0,
    mixBackpressure: false,
    backend: undefined as string | undefined,
  }
  const fn = window.electron?.pluginHostStatus
  if (!fn) return empty
  try {
    const st = (await Promise.race([
      fn(),
      new Promise<null>((r) => setTimeout(() => r(null), 500)),
    ])) as
      | {
          mixPipeConnected?: boolean
          mixQueueDepth?: number
          mixBackpressure?: boolean
          backend?: string
        }
      | null
      | undefined
    if (!st) return empty
    return {
      mixPipeConnected: Boolean(st.mixPipeConnected),
      mixQueueDepth: Number(st.mixQueueDepth ?? 0),
      mixBackpressure: Boolean(st.mixBackpressure),
      backend: st.backend,
    }
  } catch {
    return empty
  }
}

async function readRingStats(reset?: boolean, timeoutMs = 1200): Promise<MixRingStats | null> {
  const send = window.electron?.pluginHostSend
  if (!send) return null
  try {
    const raw = (await Promise.race([
      send({ type: 'getMixBufferStats', reset: Boolean(reset) }),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ])) as { ok?: boolean; mix?: MixRingStats } | null
    if (!raw?.ok || !raw.mix) return null
    return raw.mix
  } catch {
    return null
  }
}

/** Fill representativo del ring (mismo criterio que analyzeBufferHealth). */
export function mixRingFillLevel(ring: MixRingStats): {
  fill: number
  levelVsHigh: number
  levelVsTarget: number
} {
  const dawFill = Number(ring.dawFill ?? 0)
  const maxLive = Number(ring.maxLiveFill ?? 0)
  const fill = Math.max(dawFill, maxLive)
  const high = Math.max(1, ring.highFill)
  const target = Math.max(1, ring.targetFill)
  return {
    fill,
    levelVsHigh: Math.max(0, Math.min(1.2, fill / high)),
    levelVsTarget: Math.max(0, Math.min(1.5, fill / target)),
  }
}

export type MixBufferLiveSnapshot = {
  fill: number
  dawFill: number
  minLiveFill: number
  maxLiveFill: number
  capacity: number
  targetFill: number
  highFill: number
  liveTracks: number
  /** 0..1 respecto a highFill (barra principal). */
  level: number
  levelVsTarget: number
  connected: boolean
  running: boolean
  mixQueueDepth: number
  mixBackpressure: boolean
  nativeOutput: boolean
  underrunBlocks: number
  overflowPushes: number
  highFillDropFrames: number
  inRate: number
  outRate: number
  pullBudget: number
  /** Clasificación rápida sin muestreo largo. */
  status: BufferHealthReport['status']
  hint: string
}

function liveStatusFromSnapshot(s: Omit<MixBufferLiveSnapshot, 'status' | 'hint'>): Pick<MixBufferLiveSnapshot, 'status' | 'hint'> {
  if (!s.connected || !s.nativeOutput) {
    return {
      status: 'disconnected',
      hint: 'Mix pipe desconectado — posible doble salida Chromium+ASIO',
    }
  }
  if (!s.running) {
    return {
      status: 'unknown',
      hint: s.mixQueueDepth > 0 ? `Ring parado · cola IPC ${s.mixQueueDepth}` : 'Ring nativo no arrancado',
    }
  }
  if (s.mixQueueDepth > 16 || (s.mixBackpressure && s.mixQueueDepth > 8) || s.level > 0.95 || s.overflowPushes > 0) {
    return { status: 'saturated', hint: `Saturado · fill ${Math.round(s.level * 100)}% · queue ${s.mixQueueDepth}` }
  }
  if (s.levelVsTarget < 0.25 && s.liveTracks > 0) {
    return { status: 'starving', hint: `Fill bajo ${Math.round(s.levelVsTarget * 100)}% target · underrun ${s.underrunBlocks}` }
  }
  return {
    status: 'healthy',
    hint: `OK · fill ${s.fill}/${s.highFill} · live ${s.liveTracks} · queue ${s.mixQueueDepth}`,
  }
}

/** Snapshot en vivo (~1 IPC) para medidores UI — sin sleep de muestreo. */
export async function readMixBufferLive(): Promise<MixBufferLiveSnapshot | null> {
  const timing = audioEngine.getTimingDiagnostics()
  const [pipe, ring] = await Promise.all([readHostPipeStatus(), readRingStats(false, 1200)])

  const base = {
    fill: 0,
    dawFill: ring?.dawFill ?? 0,
    minLiveFill: ring?.minLiveFill ?? 0,
    maxLiveFill: ring?.maxLiveFill ?? 0,
    capacity: ring?.capacity ?? 8192,
    targetFill: ring?.targetFill ?? 1024,
    highFill: ring?.highFill ?? 3072,
    liveTracks: ring?.liveTracks ?? 0,
    level: 0,
    levelVsTarget: 0,
    connected: pipe.mixPipeConnected,
    running: Boolean(ring?.running),
    mixQueueDepth: pipe.mixQueueDepth,
    mixBackpressure: pipe.mixBackpressure,
    nativeOutput: timing.nativeOutput,
    underrunBlocks: ring?.underrunBlocks ?? 0,
    overflowPushes: ring?.overflowPushes ?? 0,
    highFillDropFrames: ring?.highFillDropFrames ?? 0,
    inRate: ring?.inRate ?? 0,
    outRate: ring?.outRate ?? 0,
    pullBudget: ring?.pullBudget ?? 0,
    status: 'unknown' as BufferHealthReport['status'],
    hint: '',
  }

  if (ring?.running) {
    const levels = mixRingFillLevel(ring)
    base.fill = levels.fill
    base.level = levels.levelVsHigh
    base.levelVsTarget = levels.levelVsTarget
  } else if (pipe.mixQueueDepth > 0) {
    // Fallback visual cuando el ring no reporta pero la cola IPC crece.
    base.level = Math.min(1, pipe.mixQueueDepth / 64)
    base.fill = Math.round(base.level * base.highFill)
  }

  const judged = liveStatusFromSnapshot(base)
  return { ...base, ...judged }
}

/** Snapshot rápido del ring (para medidor del transporte; sin muestreo largo). */
export async function readMixRingFill(): Promise<{
  fill: number
  capacity: number
  targetFill: number
  highFill: number
  liveTracks: number
  /** 0 = vacío, ~0.5 = medio, 1 = lleno (respecto a highFill). */
  level: number
  connected: boolean
  status: BufferHealthReport['status']
  mixQueueDepth: number
  underrunBlocks: number
  overflowPushes: number
} | null> {
  const live = await readMixBufferLive()
  if (!live) return null
  return {
    fill: live.fill,
    capacity: live.capacity,
    targetFill: live.targetFill,
    highFill: live.highFill,
    liveTracks: live.liveTracks,
    level: live.level,
    connected: live.connected,
    status: live.status,
    mixQueueDepth: live.mixQueueDepth,
    underrunBlocks: live.underrunBlocks,
    overflowPushes: live.overflowPushes,
  }
}

function chromeLatencies(): { base: number | null; output: number | null } {
  try {
    const ctx = audioEngine.getContext()
    if (!ctx) return { base: null, output: null }
    const base = typeof ctx.baseLatency === 'number' ? ctx.baseLatency * 1000 : null
    const output =
      typeof (ctx as AudioContext & { outputLatency?: number }).outputLatency === 'number'
        ? ((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0) * 1000
        : null
    return { base, output }
  } catch {
    return { base: null, output: null }
  }
}

function judge(args: {
  nativeOutput: boolean
  mixPipeConnected: boolean
  mixQueueDepth: number
  mixBackpressure: boolean
  ring: MixRingStats | null
  underrunDelta: number
  overflowDelta: number
  highFillDropDelta: number
  fillRatioVsTarget: number | null
  fillRatioVsHigh: number | null
  minRatioVsTarget?: number | null
}): Pick<BufferHealthReport, 'ok' | 'status' | 'summary' | 'issues' | 'advice'> {
  const issues: string[] = []
  const advice: string[] = []

  if (!args.nativeOutput || !args.mixPipeConnected) {
    return {
      ok: false,
      status: 'disconnected',
      summary: 'Mix nativo desconectado — el mix puede ir por Chromium (doble open / crackle)',
      issues: [
        !args.mixPipeConnected ? 'mix pipe desconectado' : '',
        !args.nativeOutput ? 'nativeOutput=false' : '',
      ].filter(Boolean),
      advice: ['Ejecuta audio.armNative', 'audio.ensureBest { preferName: "UMC" }', 'Reinicia JasWave si el pipe no vuelve'],
    }
  }

  if (args.mixQueueDepth > 48 || (args.mixBackpressure && args.mixQueueDepth > 8)) {
    issues.push(
      `Cola IPC saturada: depth=${args.mixQueueDepth}${args.mixBackpressure ? ' · backpressure' : ''}`,
    )
  }
  if (args.overflowDelta > 0) {
    issues.push(`Ring overflow: +${args.overflowDelta} pushes perdidos (productor más rápido que ASIO)`)
  }
  if (args.highFillDropDelta > 20000) {
    issues.push(`High-fill drop: +${args.highFillDropDelta} frames descartados (emergencia ring lleno)`)
  }
  if (args.underrunDelta > 8) {
    issues.push(`Underrun: +${args.underrunDelta} bloques con ring por debajo del buffer ASIO`)
  }
  if (args.fillRatioVsHigh != null && args.fillRatioVsHigh >= 0.92) {
    issues.push(
      `Ring cerca del techo (${(args.fillRatioVsHigh * 100).toFixed(0)}% de highFill) — saturación`,
    )
  }
  const starveRatio = args.minRatioVsTarget ?? args.fillRatioVsTarget
  if (starveRatio != null && starveRatio < 0.35 && (args.ring?.liveTracks ?? 0) > 0) {
    issues.push(
      `Ring bajo (${(starveRatio * 100).toFixed(0)}% del target) — riesgo de huecos/crackle`,
    )
  }

  const saturated =
    args.overflowDelta > 64 ||
    args.mixQueueDepth > 16 ||
    (args.mixBackpressure && args.mixQueueDepth > 8) ||
    (args.fillRatioVsHigh != null && args.fillRatioVsHigh >= 0.95) ||
    args.highFillDropDelta > 20000

  const starving =
    args.underrunDelta > 20 ||
    (starveRatio != null &&
      starveRatio < 0.2 &&
      (args.ring?.liveTracks ?? 0) > 0 &&
      args.underrunDelta > 8)

  if (saturated) {
    advice.push('Sube buffer ASIO a 1024 (audio.setDevice bufferSize:1024)')
    advice.push('Baja pistas MIDI simultáneas o cierra editores VST pesados')
    advice.push('Evita dual Chromium+ASIO: confirma nativeOutput=true')
    return {
      ok: false,
      status: 'saturated',
      summary: `Buffer saturado — ${issues[0] || 'relleno/cola altos'}`,
      issues,
      advice,
    }
  }

  if (starving) {
    advice.push('Confirma play + mix armado (audio.armNative)')
    advice.push('Si underruns siguen: buffer 1024 y menos CPU (menos VSTs vacíos)')
    return {
      ok: false,
      status: 'starving',
      summary: `Buffer hambriento — ${issues[0] || 'underruns / fill bajo'}`,
      issues,
      advice,
    }
  }

  if (!args.ring) {
    return {
      ok: true,
      status: 'unknown',
      summary: 'Host sin getMixBufferStats (binario viejo) — pipe OK; recompila plugin-host para fill real',
      issues: [],
      advice: ['Compila native/plugin-host build-vst3 Release y reinicia Electron'],
    }
  }

  const fillPct =
    args.fillRatioVsTarget != null ? `${(args.fillRatioVsTarget * 100).toFixed(0)}% del target` : 'n/a'
  return {
    ok: true,
    status: 'healthy',
    summary: `Buffer OK · fill ${fillPct} · live=${args.ring.liveTracks} · queue=${args.mixQueueDepth}`,
    issues: [],
    advice: [],
  }
}

/**
 * Muestrea el path de audio ~sampleMs y clasifica healthy/saturated/starving.
 * reset:true pone a cero contadores nativos antes de medir el delta.
 */
export async function analyzeBufferHealth(opts?: {
  sampleMs?: number
  reset?: boolean
}): Promise<BufferHealthReport> {
  const sampleMs = Math.max(80, Math.min(2000, opts?.sampleMs ?? 400))
  const reset = opts?.reset !== false

  const timing = audioEngine.getTimingDiagnostics()
  const chrome = chromeLatencies()

  // Una sola pasada ligera: reset+sample en paralelo con pipe (antes 3×1.5s timeouts congelaban UI).
  const [pipe0, a] = await Promise.all([readHostPipeStatus(), readRingStats(reset)])
  await sleep(sampleMs)
  const [pipe1, b] = await Promise.all([readHostPipeStatus(), readRingStats(false)])

  const ring = b ?? a
  const underrunDelta =
    a && b ? Math.max(0, Number(b.underrunBlocks) - Number(a.underrunBlocks)) : 0
  const overflowDelta =
    a && b ? Math.max(0, Number(b.overflowPushes) - Number(a.overflowPushes)) : 0
  const highFillDropDelta =
    a && b ? Math.max(0, Number(b.highFillDropFrames) - Number(a.highFillDropFrames)) : 0

  // Soft Pad (master-mix) llena dawFill; stems VST llenan maxLiveFill.
  // Si liveTracks>0 pero stems vacíos, no ocultar dawFill (falso fill=0 / starving).
  const dawFill = Number(ring?.dawFill ?? 0)
  const maxLive = Number(ring?.maxLiveFill ?? 0)
  const minLive = Number(ring?.minLiveFill ?? 0)
  const fillSrc = Math.max(dawFill, maxLive)
  const fillRatioVsTarget =
    ring && ring.targetFill > 0 ? fillSrc / ring.targetFill : null
  const fillRatioVsHigh = ring && ring.highFill > 0 ? fillSrc / ring.highFill : null

  // Starving: el canal activo más bajo (si solo hay DAW, usa dawFill).
  const minFill =
    ring?.liveTracks && maxLive > 0 ? Math.min(minLive, dawFill || minLive) : dawFill
  const minRatioVsTarget = ring && ring.targetFill > 0 ? minFill / ring.targetFill : null

  const judged = judge({
    nativeOutput: timing.nativeOutput,
    mixPipeConnected: pipe1.mixPipeConnected,
    mixQueueDepth: Math.max(pipe0.mixQueueDepth, pipe1.mixQueueDepth),
    mixBackpressure: pipe0.mixBackpressure || pipe1.mixBackpressure,
    ring,
    underrunDelta,
    overflowDelta,
    highFillDropDelta,
    fillRatioVsTarget,
    fillRatioVsHigh,
    minRatioVsTarget,
  })

  return {
    ...judged,
    sampleRate: timing.sampleRate,
    bufferSize: timing.bufferSize,
    nativeOutput: timing.nativeOutput,
    mixPipeConnected: pipe1.mixPipeConnected,
    mixQueueDepth: Math.max(pipe0.mixQueueDepth, pipe1.mixQueueDepth),
    mixBackpressure: pipe0.mixBackpressure || pipe1.mixBackpressure,
    chromeBaseLatencyMs: chrome.base,
    chromeOutputLatencyMs: chrome.output,
    pathAheadMs: timing.pathAheadMs,
    ring,
    fillRatioVsTarget,
    fillRatioVsHigh,
    underrunDelta,
    overflowDelta,
    highFillDropDelta,
    sampledMs: sampleMs,
  }
}
