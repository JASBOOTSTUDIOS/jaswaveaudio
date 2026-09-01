/**
 * Diálogo de vista previa de partitura — mismo diseño que el panel de edición.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { FileDown, Loader2, Pencil, X, ZoomIn, ZoomOut } from 'lucide-react'
import {
  closeScorePreview,
  getScorePreviewRequest,
  subscribeScorePreview,
} from '@/src/lib/score-preview-store'
import { ensureVexFlowFonts } from '@/src/lib/vexflow-ready'
import { buildScorePdfBytes, saveScorePdfBytes } from '@/src/lib/midi-score-export'
import { computeScoreBarCount } from '@/src/lib/midi-score-render'
import { ScoreSheetCanvas } from '@/components/score-sheet-view'
import { requestOpenTool } from '@/src/workspace/types'

export function ScorePreviewDialog() {
  const request = useSyncExternalStore(subscribeScorePreview, getScorePreviewRequest, () => null)
  const open = request !== null

  const [fontsReady, setFontsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [exporting, setExporting] = useState(false)

  const barCount = useMemo(
    () => (request ? Math.max(1, computeScoreBarCount(request.notes)) : 0),
    [request],
  )
  const noteCount = request?.notes.length ?? 0
  const drums = request?.drums ?? false

  useEffect(() => {
    if (!request) {
      setFontsReady(false)
      setError(null)
      setZoom(1)
      return
    }
    let cancelled = false
    setError(null)
    void ensureVexFlowFonts()
      .then(() => {
        if (!cancelled) setFontsReady(true)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error al cargar fuentes')
      })
    return () => {
      cancelled = true
    }
  }, [request])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeScorePreview()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const handleExport = useCallback(async () => {
    if (!request) return
    setExporting(true)
    try {
      const bytes = await buildScorePdfBytes(request.notes, {
        title: request.title,
        subtitle: request.subtitle,
        bpm: request.bpm,
        drums: request.drums,
      })
      const result = await saveScorePdfBytes(bytes, request.fileName)
      if (result.ok) closeScorePreview()
      else if (result.message !== 'Cancelado') window.alert(result.message)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Error al exportar')
    } finally {
      setExporting(false)
    }
  }, [request])

  if (!open || !request) return null

  const subtitle =
    request.subtitle ??
    `${request.bpm} BPM · ${drums ? 'Percusión' : 'Melódico'} · ${barCount} compases · ${noteCount} notas`

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 p-4"
      onClick={() => closeScorePreview()}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[12px] font-semibold text-foreground">{request.title}</span>
            <span className="text-[10px] text-muted-foreground">{subtitle}</span>
          </div>
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-panel-raised p-0.5">
            <button
              type="button"
              title="Alejar"
              className="flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="min-w-[2.5rem] text-center text-[10px] text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              title="Acercar"
              className="flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              onClick={() => setZoom((z) => Math.min(2, z + 0.15))}
            >
              <ZoomIn className="size-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              closeScorePreview()
              requestOpenTool('score-editor', { zone: 'bottom' })
            }}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-3" />
            Editar
          </button>
          <button
            type="button"
            disabled={exporting || !fontsReady}
            onClick={() => void handleExport()}
            className="flex items-center gap-1 rounded bg-accent-amber px-2 py-1 text-[11px] font-semibold text-background disabled:opacity-50"
          >
            {exporting ? <Loader2 className="size-3 animate-spin" /> : <FileDown className="size-3" />}
            PDF
          </button>
          <button
            type="button"
            title="Cerrar"
            onClick={() => closeScorePreview()}
            className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="relative min-h-0 flex-1">
          {!fontsReady && !error ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 bg-[#f4f2ee] text-muted-foreground">
              <Loader2 className="size-8 animate-spin text-accent-amber" />
              <span className="text-[12px]">Cargando partitura…</span>
            </div>
          ) : error ? (
            <div className="flex h-64 items-center justify-center bg-[#f4f2ee] text-[12px] text-destructive">
              {error}
            </div>
          ) : (
            <div
              className="h-full min-h-[280px]"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
            >
              <ScoreSheetCanvas notes={request.notes} drums={drums} barCount={barCount} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
