import { useCallback, useMemo, useState } from 'react'
import { Check, ExternalLink, Loader2, Play, Square, Trash2 } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import { executeDawActions } from '@/src/lib/ai-daw-agent'
import { pitchToName } from '@/src/lib/midi-clip-markdown'
import { requestOpenTool } from '@/src/workspace/types'
import {
  clearMidiProposalOverlay,
  setMidiProposalOverlay,
} from '@/src/lib/ai-midi-proposal-store'
import { playMidiPreviewAudition, stopMidiPreviewAudition } from '@/src/lib/midi-preview-audition'

export type MidiClipMdPreviewData = {
  kind: 'midiClipMdPreview'
  slug: string
  markdown: string
  clipId: string
  trackId: string
  nombre: string
  notes: Array<{
    id?: string
    pitch: number
    inicio: number
    duracion: number
    velocidad: number
    mute?: boolean
  }>
  bpm: number
  durationBeats: number
  instrumentoHint?: string
  applied?: boolean
  errors?: string[]
}

type Props = {
  preview: MidiClipMdPreviewData
  status?: 'pending' | 'applied' | 'discarded'
  onStatusChange?: (s: 'applied' | 'discarded') => void
}

/** Preview nota-a-nota desde clip-*.md (fuera de la timeline). */
export function MidiClipMdPreview({ preview, status = 'pending', onStatusChange }: Props) {
  const tienda = useDAW()
  const [playing, setPlaying] = useState(false)
  const [auditioningVst, setAuditioningVst] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localStatus, setLocalStatus] = useState<'pending' | 'applied' | 'discarded'>(
    preview.applied ? 'applied' : status,
  )
  const [auditionTrackId, setAuditionTrackId] = useState(preview.trackId)

  const tracks = useMemo(() => {
    const st = tienda.obtenerEstado()
    return st.project.tracks.filter(
      (t) => t.tipo === 'midi' || t.tipo === 'instrumento' || t.tipo === 'audio',
    )
  }, [tienda])

  const noteRows = useMemo(() => preview.notes.slice(0, 48), [preview.notes])

  const stopPreview = useCallback(() => {
    stopMidiPreviewAudition()
    setPlaying(false)
    setAuditioningVst(false)
  }, [])

  const playSoftSynth = useCallback(async () => {
    stopPreview()
    setPlaying(true)
    try {
      await playMidiPreviewAudition({
        notes: preview.notes.filter((n) => !n.mute),
        bpm: preview.bpm,
        candidateTrackIds: tracks.map((t) => t.id),
        preferHost: true,
        onEnded: () => setPlaying(false),
      })
    } catch {
      setPlaying(false)
    }
  }, [preview, stopPreview, tracks])

  const playVst = useCallback(async () => {
    stopPreview()
    const trackId = auditionTrackId || preview.trackId
    if (!trackId || !preview.notes.length) return
    setAuditioningVst(true)
    try {
      await playMidiPreviewAudition({
        notes: preview.notes.filter((n) => !n.mute),
        bpm: preview.bpm,
        trackId,
        candidateTrackIds: [trackId],
        preferHost: true,
        onEnded: () => setAuditioningVst(false),
      })
    } catch {
      setAuditioningVst(false)
    }
  }, [auditionTrackId, preview, stopPreview])

  const publishOverlay = useCallback(() => {
    if (!preview.trackId || !preview.notes.length) return
    setMidiProposalOverlay({
      trackId: preview.trackId,
      clipId: preview.clipId,
      notes: preview.notes.map((n) => ({
        pitch: n.pitch,
        inicio: n.inicio,
        duracion: n.duracion,
        velocidad: n.velocidad,
        kind: 'add' as const,
        noteId: n.id,
      })),
      label: preview.nombre,
      updatedAt: Date.now(),
    })
  }, [preview])

  const applyToProject = useCallback(async () => {
    setBusy(true)
    try {
      stopPreview()
      const results = await executeDawActions(
        tienda,
        [
          {
            type: 'midi.clip.md.apply',
            payload: {
              clipId: preview.clipId,
              pistaId: preview.trackId,
              markdown: preview.markdown,
              slug: preview.slug,
            },
          },
        ],
        { agentMode: 'create', forceApply: true, source: 'user_confirm', respectModeGate: false },
      )
      const ok = results.every((r) => r.success)
      if (ok) {
        setLocalStatus('applied')
        onStatusChange?.('applied')
        clearMidiProposalOverlay()
      }
    } finally {
      setBusy(false)
    }
  }, [onStatusChange, preview, stopPreview, tienda])

  const discard = useCallback(() => {
    stopPreview()
    clearMidiProposalOverlay()
    setLocalStatus('discarded')
    onStatusChange?.('discarded')
  }, [onStatusChange, stopPreview])

  const openDocs = useCallback(() => {
    requestOpenTool('docs', { zone: 'left' })
  }, [preview.slug])

  if (localStatus === 'discarded') {
    return (
      <div className="mt-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Preview .md descartado («{preview.nombre}»).
      </div>
    )
  }

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-emerald-500/30 bg-emerald-500/5">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">
            Clip .md · {preview.nombre}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {preview.slug} · {preview.notes.length} notas · {preview.bpm} BPM · preview (no timeline)
          </div>
        </div>
        {localStatus === 'applied' ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600">
            <Check className="size-3" /> Aplicado
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <label className="text-[10px] text-muted-foreground">Instrumento</label>
        <select
          className="max-w-[180px] rounded border border-border bg-background px-1.5 py-0.5 text-[10px]"
          value={auditionTrackId}
          onChange={(e) => setAuditionTrackId(e.target.value)}
          disabled={localStatus !== 'pending'}
        >
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
        {preview.instrumentoHint ? (
          <span className="text-[10px] text-muted-foreground">hint: {preview.instrumentoHint}</span>
        ) : null}
      </div>

      <div className="max-h-40 overflow-auto px-3 pb-2">
        <table className="w-full text-left text-[10px]">
          <thead className="sticky top-0 bg-emerald-500/10 text-muted-foreground">
            <tr>
              <th className="py-0.5 pr-2">id</th>
              <th className="py-0.5 pr-2">pitch</th>
              <th className="py-0.5 pr-2">t</th>
              <th className="py-0.5 pr-2">dur</th>
              <th className="py-0.5 pr-2">vel</th>
            </tr>
          </thead>
          <tbody>
            {noteRows.map((n, i) => (
              <tr key={n.id ?? i} className="border-t border-border/30">
                <td className="py-0.5 pr-2 font-mono">{n.id?.slice(0, 10) ?? '—'}</td>
                <td className="py-0.5 pr-2">
                  {n.pitch} {pitchToName(n.pitch)}
                </td>
                <td className="py-0.5 pr-2">{n.inicio.toFixed(2)}</td>
                <td className="py-0.5 pr-2">{n.duracion.toFixed(2)}</td>
                <td className="py-0.5 pr-2">{n.velocidad}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {preview.notes.length > noteRows.length ? (
          <div className="pt-1 text-[10px] text-muted-foreground">
            … y {preview.notes.length - noteRows.length} más (ver Doc)
          </div>
        ) : null}
        {preview.errors?.length ? (
          <div className="pt-1 text-[10px] text-amber-600">{preview.errors.join(' · ')}</div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-border/50 px-3 py-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-muted/40"
          disabled={playing || localStatus !== 'pending' || !preview.notes.length}
          onClick={() => void playSoftSynth()}
        >
          {playing ? <Square className="size-3" /> : <Play className="size-3" />}
          Soft-synth
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-muted/40"
          disabled={auditioningVst || localStatus !== 'pending' || !preview.notes.length}
          onClick={() => void playVst()}
        >
          {auditioningVst ? <Square className="size-3" /> : <Play className="size-3" />}
          Escuchar VST
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-muted/40"
          onClick={publishOverlay}
          disabled={localStatus !== 'pending'}
        >
          Overlay piano roll
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-muted/40"
          onClick={openDocs}
        >
          <ExternalLink className="size-3" /> Docs
        </button>
        {(playing || auditioningVst) && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px]"
            onClick={stopPreview}
          >
            <Square className="size-3" /> Stop
          </button>
        )}
        <div className="flex-1" />
        {localStatus === 'pending' ? (
          <>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/40"
              disabled={busy}
              onClick={discard}
            >
              <Trash2 className="size-3" /> Descartar
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[10px] text-white hover:bg-emerald-500 disabled:opacity-50"
              disabled={busy || !preview.notes.length}
              onClick={() => void applyToProject()}
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              Aplicar al proyecto
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
