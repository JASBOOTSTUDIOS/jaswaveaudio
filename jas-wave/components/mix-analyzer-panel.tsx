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
import { getNativeMasterPeak } from '@/src/lib/plugin/native-mix-meters'
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

function barColor(norm: number): string {
  if (norm > 0.92) return '#ef4444'
  if (norm > 0.7) return '#f59e0b'
  return '#34d399'
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
  const freqBuf = useRef<Uint8Array | null>(null)
  const timeBuf = useRef<Uint8Array | null>(null)
  const [peak, setPeak] = useState(0)
  const [rms, setRms] = useState(0)
  const [corr, setCorr] = useState(1)
  const [timing, setTiming] = useState<TimingInfo | null>(null)
  const [bufferHealth, setBufferHealth] = useState<BufferHealthReport | null>(null)
  const [listen, setListen] = useState<BounceListen | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const spec = audioEngine.getMasterSpectrum(
        (freqBuf.current as Uint8Array<ArrayBuffer> | null) ?? undefined,
      )
      freqBuf.current = spec
      const td = audioEngine.getMasterTimeDomain(
        (timeBuf.current as Uint8Array<ArrayBuffer> | null) ?? undefined,
      )
      timeBuf.current = td

      let max = 0
      let sumSq = 0
      for (let i = 0; i < td.length; i++) {
        const v = ((td[i] ?? 128) - 128) / 128
        max = Math.max(max, Math.abs(v))
        sumSq += v * v
      }
      const rmsV = Math.sqrt(sumSq / Math.max(1, td.length))
      setPeak(Math.max(getNativeMasterPeak(), max, audioEngine.getMasterMeterLevel()))
      setRms(rmsV)

      // Correlación aproximada partiendo el buffer en dos mitades (proxy L/R)
      const mid = Math.floor(td.length / 2)
      let num = 0
      let dL = 0
      let dR = 0
      for (let i = 0; i < mid; i++) {
        const a = ((td[i] ?? 128) - 128) / 128
        const b = ((td[i + mid] ?? 128) - 128) / 128
        num += a * b
        dL += a * a
        dR += b * b
      }
      const den = Math.sqrt(dL * dR)
      setCorr(den > 1e-9 ? Math.max(-1, Math.min(1, num / den)) : 1)

      setTiming(audioEngine.getTimingDiagnostics())

      const canvas = spectrumRef.current
      if (canvas && spec.length) {
        const dpr = window.devicePixelRatio || 1
        const w = canvas.clientWidth
        const h = canvas.clientHeight
        if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
          canvas.width = Math.floor(w * dpr)
          canvas.height = Math.floor(h * dpr)
        }
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.fillStyle = '#0c0e12'
          ctx.fillRect(0, 0, w, h)
          const n = Math.min(spec.length, 256)
          const barW = w / n
          for (let i = 0; i < n; i++) {
            const v = (spec[i] ?? 0) / 255
            const bh = v * (h - 4)
            ctx.fillStyle = barColor(v)
            ctx.fillRect(i * barW, h - bh, Math.max(1, barW - 0.5), bh)
          }
        }
      }
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
      ])
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
        <div className="grid grid-cols-2 gap-2">
          <MeterChip label="Peak" value={`${(peak * 100).toFixed(0)}%`} hot={peak > 0.95} />
          <MeterChip label="RMS" value={`${(rms * 100).toFixed(0)}%`} />
        </div>
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
          <Disc3 className="size-3.5" /> Loudness (último bounce)
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
          <button
            type="button"
            disabled={busy}
            onClick={() => void refreshBufferHealth()}
            className="ml-auto rounded border border-border/70 px-2 py-0.5 text-[10px] font-sans hover:bg-muted/40 disabled:opacity-50"
          >
            Analizar buffer
          </button>
        </div>
        {bufferHealth ? (
          <div
            className={cn(
              'rounded border p-2 text-[11px] leading-relaxed',
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
              {bufferHealth.status}
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
