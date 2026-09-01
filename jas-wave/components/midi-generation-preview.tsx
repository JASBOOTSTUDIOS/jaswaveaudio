import { useCallback, useMemo, useState } from 'react'
import { Check, Loader2, Trash2 } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import type { GeneratedNote } from '@/src/lib/midi-song-generator'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'
import { stopMidiPreviewAudition } from '@/src/lib/midi-preview-audition'
import { MidiPreviewTransport } from '@/components/midi-preview-transport'

export type MidiPreviewData = {
  kind: 'midiPreview'
  nombre: string
  keyLabel: string
  bpm: number
  durationBeats: number
  notes: GeneratedNote[]
  structureLabel: string
  mood?: string
  style?: string
  pistaId?: string
  applied?: boolean
}

type Props = {
  preview: MidiPreviewData
  status?: 'pending' | 'applied' | 'discarded'
  onStatusChange?: (s: 'applied' | 'discarded') => void
}

/** Vista previa de generación MIDI en el chat (escuchar → aplicar). */
export function MidiGenerationPreview({ preview, status = 'pending', onStatusChange }: Props) {
  const tienda = useDAW()
  const [busy, setBusy] = useState(false)
  const [localStatus, setLocalStatus] = useState<'pending' | 'applied' | 'discarded'>(
    preview.applied ? 'applied' : status,
  )

  const mins = useMemo(
    () => (preview.durationBeats / Math.max(1, preview.bpm)).toFixed(1),
    [preview.durationBeats, preview.bpm],
  )

  const stopPreview = useCallback(() => {
    stopMidiPreviewAudition()
  }, [])

  const applyToProject = useCallback(async () => {
    setBusy(true)
    try {
      stopPreview()
      const state = tienda.obtenerEstado()
      const selectedId = getSelectedTrackId(state)
      const midiTracks = state.project.tracks.filter(
        (t) => t.tipo === 'midi' || t.tipo === 'instrumento' || t.tipo === 'audio',
      )
      const preferred =
        (preview.pistaId && midiTracks.find((t) => t.id === preview.pistaId)) ||
        (selectedId && midiTracks.find((t) => t.id === selectedId)) ||
        midiTracks[0]
      let pistaId = preferred?.id ?? ''
      if (!pistaId) {
        const create = await tienda.executor.execute('track.create', {
          nombre: preview.nombre,
          tipo: 'midi',
        })
        if (create.success) {
          const tracks = tienda.obtenerEstado().project.tracks
          pistaId = tracks[tracks.length - 1]?.id ?? ''
        }
      }
      if (!pistaId) {
        setBusy(false)
        return
      }
      const clipRes = await tienda.executor.execute('midi.clip.create', {
        pistaId,
        nombre: preview.nombre,
        inicio: 0,
        duracion: preview.durationBeats,
        color: '#a78bfa',
        notas: preview.notes,
      })
      if (clipRes.success) {
        setLocalStatus('applied')
        onStatusChange?.('applied')
      }
    } finally {
      setBusy(false)
    }
  }, [preview, tienda, stopPreview, onStatusChange])

  const discard = useCallback(() => {
    stopPreview()
    setLocalStatus('discarded')
    onStatusChange?.('discarded')
  }, [stopPreview, onStatusChange])

  if (localStatus === 'discarded') {
    return (
      <div className="mt-2 rounded-md border border-border/60 bg-background/40 px-2.5 py-2 text-[11px] text-muted-foreground">
        Vista previa descartada.
      </div>
    )
  }

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-background/50 ring-1 ring-accent-amber/20">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-foreground">{preview.nombre}</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {preview.keyLabel}
            {preview.mood ? ` · ${preview.mood}` : ''}
            {preview.style ? `/${preview.style}` : ''} · {preview.notes.length} notas · {mins} min ·{' '}
            {preview.structureLabel}
          </div>
        </div>
        {localStatus === 'applied' ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">
            <Check className="size-3" /> Aplicado
          </span>
        ) : (
          <span className="text-[9px] uppercase tracking-wide text-accent-amber">Vista previa</span>
        )}
      </div>

      <div className="px-2.5 py-2">
        <MidiPreviewTransport
          notes={preview.notes}
          bpm={preview.bpm}
          durationBeats={preview.durationBeats}
          trackId={preview.pistaId}
          candidateTrackIds={tienda.obtenerEstado().project.tracks.map((t) => t.id)}
        />
      </div>

      {localStatus === 'pending' && (
        <div className="flex items-center gap-1.5 border-t border-border/50 px-2 py-1.5">
          <div className="flex-1" />
          <button
            type="button"
            disabled={busy}
            onClick={discard}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40"
          >
            <Trash2 className="size-3" />
            Descartar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void applyToProject()}
            className="inline-flex items-center gap-1 rounded-md bg-accent-amber px-2 py-1 text-[11px] font-semibold text-background hover:bg-accent-amber/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            Aplicar
          </button>
        </div>
      )}
    </div>
  )
}
