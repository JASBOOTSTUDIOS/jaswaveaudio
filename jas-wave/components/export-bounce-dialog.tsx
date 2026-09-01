/**
 * Diálogo de bounce/export WAV/FLAC/MP3 + stems + normalize + informe.
 */

import { useCallback, useEffect, useState } from 'react'
import { useDAW } from '@/src/context/daw-context'
import { runNativeBounce, buildRuntimeBounceContent } from '@/src/lib/bounce-service'
import type { RenderJob } from '../../shared/src/types/render'

type Props = {
  open: boolean
  onClose: () => void
}

export function ExportBounceDialog({ open, onClose }: Props) {
  const tienda = useDAW()
  const [endSec, setEndSec] = useState(30)
  const [bitDepth, setBitDepth] = useState(24)
  const [format, setFormat] = useState<'wav' | 'flac' | 'mp3'>('wav')
  const [stems, setStems] = useState(false)
  const [normalize, setNormalize] = useState<'off' | 'peak' | 'lufs'>('off')
  const [listenTarget, setListenTarget] = useState<'streaming' | 'club' | 'cd' | 'off'>('streaming')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [ffmpegOk, setFfmpegOk] = useState<boolean | null>(null)

  useEffect(() => {
    if (!open) {
      setBusy(false)
      setProgress(0)
      setMessage('')
      setJobId(null)
      return
    }
    void (async () => {
      try {
        const api = window.electron as { ffmpegAvailable?: () => Promise<{ ok?: boolean }> }
        const r = await api.ffmpegAvailable?.()
        const ok = Boolean(r?.ok)
        setFfmpegOk(ok)
        if (!ok && format !== 'wav') setFormat('wav')
      } catch {
        setFfmpegOk(false)
        if (format !== 'wav') setFormat('wav')
      }
    })()
  }, [open])

  // si ffmpeg no está, forzar WAV
  useEffect(() => {
    if (ffmpegOk === false && format !== 'wav') setFormat('wav')
  }, [ffmpegOk, format])

  const start = useCallback(async () => {
    setBusy(true)
    setMessage('Iniciando bounce…')
    setProgress(0)
    let startedId: string | null = null
    try {
      const ext = format === 'wav' ? 'wav' : format
      const path =
        (await window.electron?.dialogSave?.(`bounce-${Date.now()}.${ext}`)) || undefined
      const r = await tienda.executor.execute('render.start', {
        format,
        startSec: 0,
        endSec,
        outputPath: path || undefined,
        sampleRate: 48000,
        bitDepth,
        stems,
        normalize: normalize === 'off' ? false : normalize,
        listenTarget: listenTarget === 'off' ? undefined : listenTarget,
        bitrate: format === 'mp3' ? 192 : undefined,
      })
      if (!r.success || !r.result) {
        throw new Error(String(r.error ?? 'render.start falló'))
      }
      const job = r.result as RenderJob
      startedId = job.id
      setJobId(job.id)
      const st = tienda.obtenerEstado()
      const content = buildRuntimeBounceContent(st, {
        startSec: 0,
        endSec,
      })
      const done = await runNativeBounce(job, content, (_n, payload) => {
        if (typeof payload.progress === 'number') {
          setProgress(Math.round(Number(payload.progress) * 100))
        }
      }, st)
      if (done.status === 'cancelled') {
        setMessage('Cancelado')
      } else if (done.status === 'completed') {
        setProgress(100)
        const lufs = done.loudness?.integrated?.toFixed(1) ?? '?'
        const listen = done.listenReport?.summary ?? ''
        const stemN = done.stemsPaths?.length ?? 0
        setMessage(
          `Listo: ${done.outputPath} · ${lufs} LUFS${stemN ? ` · ${stemN} stems` : ''}${listen ? ` · ${listen}` : ''}`,
        )
        try {
          await tienda.executor.execute('analysis.fullReport', { jobId: done.id })
        } catch {
          /* ok */
        }
      } else {
        setMessage(done.error ?? 'Error')
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
      if (startedId) {
        await tienda.executor.execute('render.cancel', { renderJobId: startedId }).catch(() => undefined)
      }
    } finally {
      setBusy(false)
    }
  }, [endSec, bitDepth, format, stems, normalize, listenTarget, tienda])

  const cancel = useCallback(async () => {
    if (!jobId) return
    await tienda.executor.execute('render.cancel', { renderJobId: jobId })
  }, [jobId, tienda])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-panel p-4 shadow-xl">
        <h2 className="text-sm font-semibold text-foreground">Exportar / bounce</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Misma cadena nativa que Play. WAV siempre.
          {ffmpegOk === false
            ? ' FLAC/MP3 deshabilitados: instala ffmpeg en PATH.'
            : ffmpegOk === true
              ? ' FLAC/MP3 disponibles vía ffmpeg.'
              : ' Comprobando ffmpeg…'}
        </p>
        <label className="mt-4 flex items-center justify-between gap-3 text-xs">
          <span>Formato</span>
          <select
            value={format}
            disabled={busy}
            onChange={(e) => setFormat(e.target.value as 'wav' | 'flac' | 'mp3')}
            className="w-28 rounded border border-border bg-panel-raised px-2 py-1"
          >
            <option value="wav">WAV</option>
            <option value="flac" disabled={ffmpegOk === false}>
              FLAC{ffmpegOk === false ? ' (sin ffmpeg)' : ''}
            </option>
            <option value="mp3" disabled={ffmpegOk === false}>
              MP3{ffmpegOk === false ? ' (sin ffmpeg)' : ''}
            </option>
          </select>
        </label>
        <label className="mt-2 flex items-center justify-between gap-3 text-xs">
          <span>Duración (s)</span>
          <input
            type="number"
            min={1}
            max={600}
            value={endSec}
            disabled={busy}
            onChange={(e) => setEndSec(Math.max(1, Number(e.target.value) || 1))}
            className="w-24 rounded border border-border bg-panel-raised px-2 py-1"
          />
        </label>
        <label className="mt-2 flex items-center justify-between gap-3 text-xs">
          <span>Profundidad</span>
          <select
            value={bitDepth}
            disabled={busy || format !== 'wav'}
            onChange={(e) => setBitDepth(Number(e.target.value) === 24 ? 24 : 16)}
            className="w-24 rounded border border-border bg-panel-raised px-2 py-1"
          >
            <option value={16}>PCM 16-bit</option>
            <option value={24}>PCM 24-bit</option>
          </select>
        </label>
        <label className="mt-2 flex items-center justify-between gap-3 text-xs">
          <span>Normalizar</span>
          <select
            value={normalize}
            disabled={busy}
            onChange={(e) => setNormalize(e.target.value as 'off' | 'peak' | 'lufs')}
            className="w-28 rounded border border-border bg-panel-raised px-2 py-1"
          >
            <option value="off">Off</option>
            <option value="peak">Peak −1 dB</option>
            <option value="lufs">LUFS −14</option>
          </select>
        </label>
        <label className="mt-2 flex items-center justify-between gap-3 text-xs">
          <span>Listen target</span>
          <select
            value={listenTarget}
            disabled={busy}
            onChange={(e) =>
              setListenTarget(e.target.value as 'streaming' | 'club' | 'cd' | 'off')
            }
            className="w-28 rounded border border-border bg-panel-raised px-2 py-1"
          >
            <option value="streaming">Streaming</option>
            <option value="club">Club</option>
            <option value="cd">CD</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={stems}
            disabled={busy}
            onChange={(e) => setStems(e.target.checked)}
          />
          Exportar stems por pista
        </label>
        <div className="mt-3 h-2 overflow-hidden rounded bg-panel-raised">
          <div className="h-full bg-accent-amber transition-all" style={{ width: `${progress}%` }} />
        </div>
        {message && <p className="mt-2 break-all text-xs text-muted-foreground">{message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-panel-raised"
            onClick={onClose}
            disabled={busy}
          >
            Cerrar
          </button>
          {busy ? (
            <button
              type="button"
              className="rounded bg-panel-raised px-3 py-1.5 text-xs"
              onClick={() => void cancel()}
            >
              Cancelar
            </button>
          ) : (
            <button
              type="button"
              className="rounded bg-accent-amber/90 px-3 py-1.5 text-xs font-medium text-black"
              onClick={() => void start()}
            >
              Exportar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
