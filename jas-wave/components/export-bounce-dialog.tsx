/**
 * Diálogo de bounce WAV + progreso.
 */

import { useCallback, useEffect, useState } from 'react'
import { useDAW } from '@/src/context/daw-context'
import { runNativeBounce } from '@/src/lib/bounce-service'
import type { RenderJob } from '../../shared/src/types/render'

type Props = {
  open: boolean
  onClose: () => void
}

export function ExportBounceDialog({ open, onClose }: Props) {
  const tienda = useDAW()
  const [endSec, setEndSec] = useState(30)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setBusy(false)
      setProgress(0)
      setMessage('')
      setJobId(null)
    }
  }, [open])

  const start = useCallback(async () => {
    setBusy(true)
    setMessage('Iniciando bounce…')
    setProgress(0)
    let startedId: string | null = null
    try {
      const path =
        (await window.electron?.dialogSave?.(`bounce-${Date.now()}.wav`)) || undefined
      const r = await tienda.executor.execute('render.start', {
        format: 'wav',
        startSec: 0,
        endSec,
        outputPath: path || undefined,
        sampleRate: 48000,
        bitDepth: 16,
      })
      if (!r.success || !r.result) {
        throw new Error(String(r.error ?? 'render.start falló'))
      }
      const job = r.result as RenderJob
      startedId = job.id
      setJobId(job.id)
      const done = await runNativeBounce(job, (_n, payload) => {
        if (typeof payload.progress === 'number') {
          setProgress(Math.round(Number(payload.progress) * 100))
        }
      })
      if (done.status === 'cancelled') {
        setMessage('Cancelado')
      } else if (done.status === 'completed') {
        setProgress(100)
        const lufs = done.loudness?.integrated?.toFixed(1) ?? '?'
        setMessage(`Listo: ${done.outputPath} · ${lufs} LUFS`)
        try {
          await tienda.executor.execute('analysis.loudness', { source: 'render', jobId: done.id })
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
  }, [endSec, tienda])

  const cancel = useCallback(async () => {
    if (!jobId) return
    await tienda.executor.execute('render.cancel', { renderJobId: jobId })
  }, [jobId, tienda])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-panel p-4 shadow-xl">
        <h2 className="text-sm font-semibold text-foreground">Exportar bounce (WAV)</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Misma cadena nativa que Play (stems → FX → master). Solo PCM16 estéreo.
        </p>
        <label className="mt-4 flex items-center justify-between gap-3 text-xs">
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
              Bounce
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
