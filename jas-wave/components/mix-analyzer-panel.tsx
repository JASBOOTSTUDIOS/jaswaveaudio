/**
 * Panel Medidores — espectro, estereo, LUFS (último bounce) y sync de timing.
 * Misma info que analysis.* / CLI, usable desde la UI.
 */

import { useEffect, useRef, useState } from 'react'
import { Activity, AudioLines, Disc3, Gauge, Timer } from 'lucide-react'
import { audioEngine } from '@/lib/audio-engine'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { executeDawActions } from '@/src/lib/ai-daw-agent'
import type { BufferHealthReport } from '@/src/lib/audio-buffer-health'
import { useLiveBufferMeter } from '@/hooks/use-live-buffer-meter'
import {
  getNativeMasterMetering,
  getNativeMasterSpectrum,
  refreshNativeMasterSpectrum,
  refreshNativeMixMeters,
  resetNativeMasterLoudness,
} from '@/src/lib/plugin/native-mix-meters'
import { cn } from '@/lib/utils'

type TimingInfo = ReturnType<typeof audioEngine.getTimingDiagnostics>

type BounceListen = {
  summary?: string
  ok?: boolean
  loudness?: { integrated?: number; shortTerm?: number; truePeak?: number }
  truePeakDb?: number
  stereoCorrelation?: number
  spectrumBands?: Array<{ label: string; db: number; hzCenter: number }>
  issues?: string[]
}

const toDb = (v: number) => (v > 1e-6 ? 20 * Math.log10(v) : -120)
const fmtDb = (db: number) => (db <= -100 ? '−∞' : db.toFixed(1))
const fmtLufs = (v: number) => (v <= -100 ? '—' : v.toFixed(1))

/** Espectro del master en dBFS (−96…0) con rejilla de dB y de frecuencia. */
function drawMasterSpectrum(canvas: HTMLCanvasElement, cols: Float32Array) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#0c0e12'
  ctx.fillRect(0, 0, w, h)
  const dbMin = -96
  const yFor = (db: number) => h - Math.max(0, Math.min(1, (db - dbMin) / -dbMin)) * (h - 4)
  ctx.font = '9px sans-serif'
  ctx.lineWidth = 1
  for (const db of [-12, -24, -48, -72]) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.beginPath()
    ctx.moveTo(0, yFor(db))
    ctx.lineTo(w, yFor(db))
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.fillText(`${db}`, 2, yFor(db) - 2)
  }
  for (const [f, label] of [[100, '100'], [1000, '1k'], [10000, '10k']] as const) {
    const x = (Math.log(f / 20) / Math.log(1000)) * w
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.fillText(label, x + 2, h - 3)
  }
  const n = cols.length
  ctx.beginPath()
  ctx.moveTo(0, h)
  for (let i = 0; i < n; i++) ctx.lineTo(((i + 0.5) / n) * w, yFor(cols[i] ?? -140))
  ctx.lineTo(w, h)
  ctx.closePath()
  ctx.fillStyle = 'rgba(52,211,153,0.18)'
  ctx.fill()
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * w
    if (i === 0) ctx.moveTo(x, yFor(cols[i] ?? -140))
    else ctx.lineTo(x, yFor(cols[i] ?? -140))
  }
  ctx.strokeStyle = '#34d399'
  ctx.lineWidth = 1.4
  ctx.stroke()
}

/** Barra de nivel en dBFS (−60…0) con RMS, pico y retención. */
function LevelRow({ label, peak, hold, rms }: { label: string; peak: number; hold: number; rms: number }) {
  const pos = (v: number) => `${Math.max(0, Math.min(1, (toDb(v) + 60) / 60)) * 100}%`
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 text-[10px] text-muted-foreground">{label}</span>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded bg-muted/40">
        <div className="absolute inset-y-0 left-0 bg-emerald-500/35" style={{ width: pos(peak) }} />
        <div className="absolute inset-y-0 left-0 bg-emerald-400" style={{ width: pos(rms) }} />
        <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: pos(hold) }} />
        <div className="absolute inset-y-0 w-px bg-red-500/70" style={{ left: pos(0.89) }} title="−1 dBFS" />
      </div>
      <span className={cn('w-12 text-right font-mono text-[10px]', toDb(peak) > -1 ? 'text-red-400' : 'text-foreground')}>
        {fmtDb(toDb(peak))}
      </span>
    </div>
  )
}

function correlationLabel(c: number): string {
  if (c > 0.85) return 'Mono / centrado'
  if (c > 0.35) return 'Estéreo equilibrado'
  if (c > -0.2) return 'Ancho'
  return 'Fuera de fase'
}

export function MixAnalyzerPanel() {
  const tienda = useDAW()
  const playing = useDAWState((s) => Boolean(s.transport?.reproduciendo))
  const spectrumRef = useRef<HTMLCanvasElement>(null)
  const [levels, setLevels] = useState({ peakL: 0, peakR: 0, holdL: 0, holdR: 0, rmsL: 0, rmsR: 0 })
  const [live, setLive] = useState({ m: -120, s: -120, i: -120 })
  const [clipped, setClipped] = useState(false)
  const [corr, setCorr] = useState(1)
  const [timing, setTiming] = useState<TimingInfo | null>(null)
  const [bufferHealth, setBufferHealth] = useState<BufferHealthReport | null>(null)
  const liveBuffer = useLiveBufferMeter(playing)
  const [listen, setListen] = useState<BounceListen | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let raf = 0
    let lastPoll = 0
    let holdL = 0
    let holdR = 0
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      // El host nativo mezcla y mide el master: se sondea a ~20 Hz (una petición en vuelo a la vez).
      if (t - lastPoll > 50) {
        lastPoll = t
        void refreshNativeMixMeters()
        void refreshNativeMasterSpectrum()
      }
      const m = getNativeMasterMetering()
      const pkL = Math.max(m.peakL, 0)
      const pkR = Math.max(m.peakR, 0)
      holdL = Math.max(holdL * 0.985, pkL)
      holdR = Math.max(holdR * 0.985, pkR)
      setLevels({ peakL: pkL, peakR: pkR, holdL, holdR, rmsL: m.rmsL, rmsR: m.rmsR })
      setCorr(m.correlation)
      setLive({ m: m.lufsMomentary, s: m.lufsShort, i: m.lufsIntegrated })
      if (pkL >= 0.999 || pkR >= 0.999) setClipped(true)

      setTiming(audioEngine.getTimingDiagnostics())

      const canvas = spectrumRef.current
      if (canvas) drawMasterSpectrum(canvas, getNativeMasterSpectrum())
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const refreshBounceAnalysis = async () => {
    setBusy(true)
    setMsg('')
    try {
      const results = await executeDawActions(tienda, [
        { type: 'analysis.fullReport', payload: {} },
      ])
      const r = results[0]
      if (!r?.success) {
        setMsg(r?.message || 'Sin bounce: exporta primero (render.start)')
        setListen(null)
      } else {
        const data = r.data as BounceListen
        setListen(data)
        setMsg(data?.summary || r.message)
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const stabilizeAudio = async () => {
    setBusy(true)
    setMsg('')
    try {
      const results = await executeDawActions(tienda, [
        { type: 'audio.ensureBest', payload: { preferName: 'UMC' } },
      ], { source: 'user_build' })
      setMsg(results[0]?.message || 'Audio actualizado')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const refreshBufferHealth = async () => {
    setBusy(true)
    setMsg('')
    try {
      const results = await executeDawActions(tienda, [
        { type: 'analysis.buffer', payload: { sampleMs: 450, reset: true } },
      ])
      const r = results[0]
      const data = r?.data as BufferHealthReport | undefined
      if (data) setBufferHealth(data)
      setMsg(r?.message || 'Buffer analizado')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const skewOk = timing ? Math.abs(timing.skewMs - timing.pathAheadMs) < 25 || !timing.playing : true
  const lufs = listen?.loudness?.integrated
  const truePeak =
    listen?.truePeakDb ??
    (listen?.loudness?.truePeak != null && listen.loudness.truePeak > 0
      ? 20 * Math.log10(listen.loudness.truePeak)
      : undefined)

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto bg-panel p-3 text-[12px] text-foreground">
      <header className="flex items-center gap-2 border-b border-border/60 pb-2">
        <Gauge className="size-4 text-emerald-400" />
        <div>
          <div className="text-[13px] font-semibold">Medidores / Análisis</div>
          <div className="text-[10px] text-muted-foreground">
            Espectro · estéreo · LUFS · sync de timing
          </div>
        </div>
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void stabilizeAudio()}
            className="rounded border border-border/70 px-2 py-1 text-[10px] hover:bg-muted/40 disabled:opacity-50"
          >
            Estabilizar audio
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void refreshBounceAnalysis()}
            className="rounded border border-emerald-700/50 bg-emerald-950/40 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-900/50 disabled:opacity-50"
          >
            Analizar bounce
          </button>
        </div>
      </header>

      {msg ? <p className="rounded bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">{msg}</p> : null}

      <section className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <AudioLines className="size-3.5" /> Espectro en vivo
          <span className={cn('ml-auto', playing ? 'text-emerald-400' : 'text-muted-foreground')}>
            {playing ? 'PLAY' : 'STOP'}
          </span>
        </div>
        <canvas ref={spectrumRef} className="h-28 w-full rounded border border-border/50" />
        <div className="space-y-1 rounded border border-border/50 bg-black/20 p-2">
          <LevelRow label="L" peak={levels.peakL} hold={levels.holdL} rms={levels.rmsL} />
          <LevelRow label="R" peak={levels.peakR} hold={levels.holdR} rms={levels.rmsR} />
          <div className="flex items-center justify-between pt-0.5 text-[10px] text-muted-foreground">
            <span>
              Pico máx{' '}
              <span className={cn('font-mono', clipped ? 'text-red-400' : 'text-foreground')}>
                {fmtDb(toDb(Math.max(levels.holdL, levels.holdR)))} dBFS
              </span>
            </span>
            <button
              type="button"
              onClick={() => setClipped(false)}
              title="Reiniciar indicador de clip"
              className={cn(
                'rounded px-1.5 py-0.5 font-semibold uppercase',
                clipped ? 'bg-red-600 text-white' : 'bg-muted/40 text-muted-foreground',
              )}
            >
              Clip
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MeterChip label="LUFS-M" value={fmtLufs(live.m)} />
          <MeterChip label="LUFS-S" value={fmtLufs(live.s)} />
          <MeterChip label="LUFS-I" value={fmtLufs(live.i)} hint="streaming ≈ −14" />
        </div>
        <button
          type="button"
          onClick={() => resetNativeMasterLoudness()}
          className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
        >
          Reiniciar LUFS integrado
        </button>
      </section>

      <section className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Activity className="size-3.5" /> Campo estéreo
        </div>
        <div className="rounded border border-border/50 bg-black/20 p-2">
          <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
            <span>L</span>
            <span>{correlationLabel(corr)}</span>
            <span>R</span>
          </div>
          <div className="relative h-2 rounded bg-muted/40">
            <div
              className="absolute top-0 h-2 w-1 rounded bg-sky-400"
              style={{ left: `${((corr + 1) / 2) * 100}%`, transform: 'translateX(-50%)' }}
            />
          </div>
          <div className="mt-1 text-[11px]">
            Correlación: <span className="font-mono">{corr.toFixed(2)}</span>
            {listen?.stereoCorrelation != null ? (
              <span className="text-muted-foreground">
                {' '}
                · bounce {listen.stereoCorrelation.toFixed(2)}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Disc3 className="size-3.5" /> Análisis del último bounce
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MeterChip
            label="LUFS-I"
            value={lufs != null ? `${lufs.toFixed(1)}` : '—'}
            hint="streaming ≈ −14"
          />
          <MeterChip
            label="True Peak"
            value={truePeak != null ? `${truePeak.toFixed(1)} dB` : '—'}
            hot={truePeak != null && truePeak > -1}
          />
          <MeterChip label="Listen" value={listen?.ok === false ? 'FAIL' : listen?.ok ? 'OK' : '—'} hot={listen?.ok === false} />
        </div>
        {listen?.spectrumBands?.length ? (
          <div className="flex h-14 items-end gap-0.5 rounded border border-border/40 bg-black/20 p-1">
            {listen.spectrumBands.map((b) => {
              const h = Math.max(2, Math.min(100, ((b.db + 60) / 60) * 100))
              return (
                <div key={b.label} className="flex flex-1 flex-col items-center gap-0.5" title={`${b.label} ${b.db.toFixed(1)} dB`}>
                  <div className="w-full rounded-sm bg-violet-500/80" style={{ height: `${h}%` }} />
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground">Exporta un bounce para ver bandas LUFS/espectro offline.</p>
        )}
      </section>

      <section className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Timer className="size-3.5" /> Timing / buffer
          <span className={cn(
            'ml-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase',
            liveBuffer?.status === 'healthy' && 'bg-emerald-950/50 text-emerald-300',
            liveBuffer?.status === 'saturated' && 'bg-red-950/50 text-red-300',
            liveBuffer?.status === 'starving' && 'bg-amber-950/50 text-amber-300',
            liveBuffer?.status === 'disconnected' && 'bg-zinc-800 text-zinc-400',
            (!liveBuffer || liveBuffer.status === 'unknown') && 'bg-muted/40 text-muted-foreground',
          )}>
            {liveBuffer?.status ?? '…'}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void refreshBufferHealth()}
            className="ml-auto rounded border border-border/70 px-2 py-0.5 text-[10px] font-sans hover:bg-muted/40 disabled:opacity-50"
          >
            Diagnóstico
          </button>
        </div>
        {liveBuffer ? (
          <div
            className={cn(
              'rounded border p-2 text-[11px] leading-relaxed',
              liveBuffer.status === 'healthy'
                ? 'border-emerald-800/50 bg-emerald-950/20'
                : liveBuffer.status === 'saturated'
                  ? 'border-red-700/60 bg-red-950/30'
                  : liveBuffer.status === 'starving'
                    ? 'border-amber-700/60 bg-amber-950/30'
                    : 'border-border/50 bg-black/20',
            )}
          >
            <div className="font-semibold uppercase tracking-wide">
              {liveBuffer.status}
              <span className="ml-2 font-normal normal-case text-muted-foreground">{liveBuffer.hint}</span>
            </div>
            <div className="mt-1.5 h-3 overflow-hidden rounded bg-muted/40">
              <div
                className={cn(
                  'h-3 rounded transition-[width] duration-75',
                  liveBuffer.level > 0.9
                    ? 'bg-red-500'
                    : liveBuffer.levelVsTarget < 0.35
                      ? 'bg-amber-400'
                      : 'bg-emerald-500',
                )}
                style={{
                  width: `${Math.min(100, Math.max(2, liveBuffer.level * 100))}%`,
                }}
              />
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
              <span>fill {liveBuffer.fill}/{liveBuffer.highFill}</span>
              <span>target {liveBuffer.targetFill}</span>
              <span>daw {liveBuffer.dawFill} · max {liveBuffer.maxLiveFill}</span>
              <span>min {liveBuffer.minLiveFill} · live {liveBuffer.liveTracks}</span>
              <span>queue {liveBuffer.mixQueueDepth}{liveBuffer.mixBackpressure ? ' BP' : ''}</span>
              <span>in/out {liveBuffer.inRate}/{liveBuffer.outRate} Hz</span>
              <span>underrun {liveBuffer.underrunBlocks}{(liveBuffer.underrunDelta ?? 0) > 0 ? ` (+${liveBuffer.underrunDelta})` : ''}</span>
              <span>overflow {liveBuffer.overflowPushes}{(liveBuffer.overflowDelta ?? 0) > 0 ? ` (+${liveBuffer.overflowDelta})` : ''}</span>
              {(liveBuffer.dropDelta ?? 0) > 0 || liveBuffer.highFillDropFrames > 0 ? (
                <span className="col-span-2 text-red-300">
                  drop frames {liveBuffer.highFillDropFrames}{(liveBuffer.dropDelta ?? 0) > 0 ? ` (+${liveBuffer.dropDelta})` : ''}
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground">Conectando medidor de buffer…</p>
        )}
        {bufferHealth ? (
          <div
            className={cn(
              'rounded border p-2 text-[11px] leading-relaxed opacity-90',
              bufferHealth.status === 'healthy'
                ? 'border-emerald-800/50 bg-emerald-950/20'
                : bufferHealth.status === 'saturated'
                  ? 'border-red-700/60 bg-red-950/30'
                  : bufferHealth.status === 'starving'
                    ? 'border-amber-700/60 bg-amber-950/30'
                    : 'border-border/50 bg-black/20',
            )}
          >
            <div className="font-semibold uppercase tracking-wide">
              Diagnóstico · {bufferHealth.status}
              <span className="ml-2 font-normal normal-case text-muted-foreground">{bufferHealth.summary}</span>
            </div>
            {bufferHealth.ring ? (
              <>
                <div className="mt-1.5 h-2 overflow-hidden rounded bg-muted/40">
                  <div
                    className={cn(
                      'h-2 rounded transition-all',
                      (bufferHealth.fillRatioVsHigh ?? 0) > 0.9
                        ? 'bg-red-500'
                        : (bufferHealth.fillRatioVsTarget ?? 0) < 0.35
                          ? 'bg-amber-400'
                          : 'bg-emerald-500',
                    )}
                    style={{
                      width: `${Math.min(100, Math.max(2, (bufferHealth.fillRatioVsHigh ?? 0) * 100))}%`,
                    }}
                  />
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  fill {bufferHealth.ring.minLiveFill}/{bufferHealth.ring.targetFill} target · high{' '}
                  {bufferHealth.ring.highFill} · live {bufferHealth.ring.liveTracks} · queue{' '}
                  {bufferHealth.mixQueueDepth}
                  {bufferHealth.underrunDelta > 0 ? ` · +underrun ${bufferHealth.underrunDelta}` : ''}
                  {bufferHealth.overflowDelta > 0 ? ` · +overflow ${bufferHealth.overflowDelta}` : ''}
                  {bufferHealth.highFillDropDelta > 0
                    ? ` · +drop ${bufferHealth.highFillDropDelta}`
                    : ''}
                </div>
              </>
            ) : (
              <div className="mt-1 text-[10px] text-muted-foreground">
                Ring nativo no disponible (recompila plugin-host). Cola IPC: {bufferHealth.mixQueueDepth}
                {bufferHealth.mixBackpressure ? ' · backpressure' : ''}
              </div>
            )}
            {bufferHealth.issues.length ? (
              <ul className="mt-1 list-inside list-disc text-[10px] text-amber-200/90">
                {bufferHealth.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div
          className={cn(
            'rounded border p-2 font-mono text-[11px] leading-relaxed',
            skewOk ? 'border-border/50 bg-black/20' : 'border-amber-700/60 bg-amber-950/30',
          )}
        >
          {timing ? (
            <>
              <div>
                Device {timing.sampleRate} Hz / buf {timing.bufferSize}
                {timing.nativeOutput ? ' · nativo' : ' · Chromium'}
              </div>
              <div>
                Ahead mix→ASIO: {timing.pathAheadMs.toFixed(1)} ms
              </div>
              <div>
                Timeline {timing.timelineSec.toFixed(3)}s · audible {timing.audibleSec.toFixed(3)}s
              </div>
              <div className={skewOk ? 'text-emerald-400/90' : 'text-amber-300'}>
                Skew playhead {timing.skewMs.toFixed(1)} ms {skewOk ? 'OK' : 'revisar buffer'}
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">Sin motor de audio</span>
          )}
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          CLI/IA: <code className="text-[9px]">analysis.buffer</code> — saturado = ring/cola altos;
          starving = underruns. Estabilizar = 48 kHz / 1024 + mix nativo.
        </p>
      </section>
    </div>
  )
}

function MeterChip({
  label,
  value,
  hint,
  hot,
}: {
  label: string
  value: string
  hint?: string
  hot?: boolean
}) {
  return (
    <div className={cn('rounded border border-border/50 bg-black/20 px-2 py-1.5', hot && 'border-red-700/50')}>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('font-mono text-[13px]', hot && 'text-red-400')}>{value}</div>
      {hint ? <div className="text-[9px] text-muted-foreground">{hint}</div> : null}
    </div>
  )
}
