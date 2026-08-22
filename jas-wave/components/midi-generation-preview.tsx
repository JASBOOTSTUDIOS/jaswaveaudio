import { useCallback, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Play, Square, Trash2 } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import { audioEngine } from '@/lib/audio-engine'
import type { GeneratedNote } from '@/src/lib/midi-song-generator'
import { beatsASegundos } from '@/lib/audio-conversions'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'

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
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localStatus, setLocalStatus] = useState<'pending' | 'applied' | 'discarded'>(
    preview.applied ? 'applied' : status,
  )
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mins = useMemo(
    () => (preview.durationBeats / Math.max(1, preview.bpm)).toFixed(1),
    [preview.durationBeats, preview.bpm],
  )

  const noteDots = useMemo(() => {
    // Mini piano-roll: muestreo de notas para preview visual
    const max = 120
    const step = Math.max(1, Math.floor(preview.notes.length / max))
    return preview.notes.filter((_, i) => i % step === 0).slice(0, max)
  }, [preview.notes])

  const stopPreview = useCallback(() => {
    if (stopTimer.current) clearTimeout(stopTimer.current)
    stopTimer.current = null
    audioEngine.stopAllSources()
    setPlaying(false)
  }, [])

  const playPreview = useCallback(() => {
    stopPreview()
    audioEngine.ensureContext()
    const bpm = preview.bpm
    const midiClips = [
      {
        id: 'preview-clip',
        trackId: '__preview__',
        notes: preview.notes.map((n) => ({
          pitch: n.pitch,
          velocity: n.velocidad,
          startSec: beatsASegundos(n.inicio, bpm),
          durationSec: Math.max(0.05, beatsASegundos(n.duracion, bpm)),
        })),
      },
    ]
    audioEngine.playClips(
      0,
      [],
      [{ id: '__preview__', volumen: 0.85, paneo: 0, silenciada: false, soloActiva: false }],
      midiClips,
    )
    setPlaying(true)
    const durMs = beatsASegundos(preview.durationBeats, bpm) * 1000
    stopTimer.current = setTimeout(() => stopPreview(), Math.min(durMs + 200, 90_000))
  }, [preview, stopPreview])

  const applyToProject = useCallback(async () => {
    setBusy(true)
    try {
      stopPreview()
      const state = tienda.obtenerEstado()
      const selectedId = getSelectedTrackId(state)
      const midiTracks = state.project.tracks.filter((t) => t.tipo === 'midi' || t.tipo === 'instrumento')
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

      <div className="relative h-16 bg-panel-raised/40 px-1 py-1">
        <div className="relative h-full w-full overflow-hidden">
          {noteDots.map((n, i) => {
            const x = (n.inicio / Math.max(1, preview.durationBeats)) * 100
            const w = Math.max(0.4, (n.duracion / Math.max(1, preview.durationBeats)) * 100)
            const y = ((127 - n.pitch) / 127) * 100
            return (
              <div
                key={i}
                className="absolute rounded-[1px] bg-accent-amber/70"
                style={{
                  left: `${x}%`,
                  width: `${w}%`,
                  top: `${Math.max(2, Math.min(92, y))}%`,
                  height: 3,
                }}
              />
            )
          })}
        </div>
      </div>

      {localStatus === 'pending' && (
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <button
            type="button"
            onClick={() => (playing ? stopPreview() : playPreview())}
            className="inline-flex items-center gap-1 rounded-md bg-panel-raised px-2 py-1 text-[11px] font-medium text-foreground ring-1 ring-border hover:bg-accent"
          >
            {playing ? <Square className="size-3" fill="currentColor" /> : <Play className="size-3" fill="currentColor" />}
            {playing ? 'Detener' : 'Escuchar'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void applyToProject()}
            className="inline-flex items-center gap-1 rounded-md bg-accent-amber/90 px-2 py-1 text-[11px] font-semibold text-background hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            Aplicar al proyecto
          </button>
          <button
            type="button"
            onClick={discard}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          >
            <Trash2 className="size-3" />
            Descartar
          </button>
        </div>
      )}
    </div>
  )
}
