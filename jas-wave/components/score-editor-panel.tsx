/**
 * Editor de partitura — panel acoplable sincronizado con clip MIDI.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Eraser,
  FileDown,
  MousePointer2,
  Music2,
  Pencil,
  Piano,
  Save,
} from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import type { MidiNote } from '../../shared/src/types/clips'
import { getUndockUrlFocus } from '@/lib/undock-window'
import { listMidiClips, resolvePianoRollClip } from '@/src/lib/selection-helpers'
import { requestOpenTool } from '@/src/workspace/types'
import {
  BEATS_PER_BAR,
  computeScoreBarCount,
  SCORE_BAR_WIDTH,
  SCORE_LINE_SPACING,
  SCORE_STAVE_TOP,
  pitchToStaffY,
  xToBeatInBar,
  yToPitch,
} from '@/src/lib/midi-score-render'
import { isDrumishNotes } from '@/src/lib/midi-score-export'
import { buildScorePdfBytes, saveScorePdfBytes, scoreFileName } from '@/src/lib/midi-score-export'
import { openScorePreview } from '@/src/lib/score-preview-store'
import {
  SCORE_NOTE_DURATIONS,
  durationById,
} from '@/src/lib/score-note-durations'
import { getProjectKey, getProjectKeyRegions } from '../../shared/src/music/project-key'
import { ScoreBarView, ScoreSheetCanvas, SCORE_BAR_HEIGHT } from '@/components/score-sheet-view'
import { SHEET_BAR_SLOT_WIDTH } from '@/src/lib/midi-score-render'

type LocalNote = {
  id: string
  pitch: number
  inicio: number
  duracion: number
  velocidad: number
  canal?: number
}

type ScoreTool = 'select' | 'pencil' | 'eraser'

function snapBeat(beat: number, grid: number): number {
  return Math.max(0, Math.round(beat / grid) * grid)
}

function notesInBar(notes: LocalNote[], barIndex: number): LocalNote[] {
  return notes.filter((n) => Math.floor(n.inicio / BEATS_PER_BAR) === barIndex)
}

function hitTestNote(
  notes: LocalNote[],
  barIndex: number,
  localX: number,
  localY: number,
  drums: boolean,
): LocalNote | null {
  const barNotes = notesInBar(notes, barIndex)
  for (const n of barNotes) {
    const inBar = n.inicio - barIndex * BEATS_PER_BAR
    const x0 = (inBar / BEATS_PER_BAR) * SCORE_BAR_WIDTH
    const x1 = x0 + (n.duracion / BEATS_PER_BAR) * SCORE_BAR_WIDTH
    const ny = pitchToStaffY(n.pitch, drums, SCORE_STAVE_TOP, SCORE_LINE_SPACING)
    if (localX >= x0 - 4 && localX <= x1 + 6 && Math.abs(localY - ny) <= SCORE_LINE_SPACING * 1.4) {
      return n
    }
  }
  return null
}

function EditableScoreBar({
  barIndex,
  notes,
  drums,
  selectedIds,
  tool,
  noteDuration,
  snapGrid,
  onNotesChange,
  onSelect,
}: {
  barIndex: number
  notes: LocalNote[]
  drums: boolean
  selectedIds: Set<string>
  tool: ScoreTool
  noteDuration: number
  snapGrid: number
  onNotesChange: (next: LocalNote[]) => void
  onSelect: (ids: Set<string>) => void
}) {
  const notesRef = useRef(notes)
  notesRef.current = notes

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const host = e.currentTarget as HTMLElement
    const rect = host.getBoundingClientRect()
    const localX = e.clientX - rect.left - 8
    const localY = e.clientY - rect.top
    const current = notesRef.current
    const hit = hitTestNote(current, barIndex, localX, localY, drums)

    if (tool === 'eraser' || (tool === 'select' && e.detail === 2)) {
      if (hit) {
        onNotesChange(current.filter((n) => n.id !== hit.id))
        onSelect(new Set())
      }
      return
    }

    if (tool === 'select') {
      if (hit) onSelect(e.shiftKey ? new Set([...selectedIds, hit.id]) : new Set([hit.id]))
      else onSelect(new Set())
      return
    }

    if (hit) {
      onSelect(new Set([hit.id]))
      return
    }
    const beatInBar = snapBeat(xToBeatInBar(localX), snapGrid)
    const pitch = yToPitch(localY, drums)
    const inicio = barIndex * BEATS_PER_BAR + beatInBar
    const note: LocalNote = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      pitch,
      inicio,
      duracion: noteDuration,
      velocidad: 90,
    }
    onNotesChange([...current, note])
    onSelect(new Set([note.id]))
  }

  return (
    <div
      className={`relative shrink-0 cursor-crosshair rounded-sm transition-shadow ${
        selectedIds.size && notesInBar(notes, barIndex).some((n) => selectedIds.has(n.id))
          ? 'ring-1 ring-accent-amber/50'
          : ''
      }`}
      style={{ width: SHEET_BAR_SLOT_WIDTH, height: SCORE_BAR_HEIGHT }}
      onPointerDown={handlePointerDown}
    >
      <ScoreBarView
        barIndex={barIndex}
        notes={notes as MidiNote[]}
        drums={drums}
        selectedIds={selectedIds}
      />
    </div>
  )
}

function ScoreEditor({ trackId, clipId }: { trackId: string; clipId: string }) {
  const tienda = useDAW()
  const clip = useDAWState((s: DAWState) => {
    const tr = s.project.tracks.find((t) => t.id === trackId)
    return tr?.clips?.find((x: { id: string }) => x.id === clipId) as
      | { tipo?: string; nombre?: string; duracion?: number; notas?: MidiNote[] }
      | undefined
  })
  const trackName = useDAWState(
    (s: DAWState) => s.project.tracks.find((t) => t.id === trackId)?.nombre ?? trackId,
  )
  const bpm = useDAWState((s: DAWState) => s.project?.bpm?.valor ?? 120)
  const projectKey = useDAWState((s: DAWState) => getProjectKey(s.project?.metadata))
  const keyRegions = useDAWState((s: DAWState) => getProjectKeyRegions(s.project?.metadata))

  const [notes, setNotes] = useState<LocalNote[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [dirty, setDirty] = useState(false)
  const [tool, setTool] = useState<ScoreTool>('pencil')
  const [durationId, setDurationId] = useState('q')
  const noteDuration = durationById(durationId).beats
  const snapGrid = durationById(durationId).snap
  const [extraBars, setExtraBars] = useState(0)
  const draggingRef = useRef(false)

  const drums = useMemo(
    () => /bater|drum/i.test(trackName) || isDrumishNotes(notes as MidiNote[]),
    [trackName, notes],
  )

  useEffect(() => {
    if (!clip || clip.tipo !== 'midi') return
    if (dirty || draggingRef.current) return
    const seen = new Set<string>()
    const out: LocalNote[] = []
    for (const n of clip.notas ?? []) {
      if (!n?.id || seen.has(n.id)) continue
      seen.add(n.id)
      out.push({
        id: n.id,
        pitch: n.pitch,
        inicio: n.inicio,
        duracion: n.duracion,
        velocidad: n.velocidad,
        canal: n.canal,
      })
    }
    setNotes(out)
    setSelectedIds(new Set())
  }, [clip, dirty])

  const barCount = Math.max(computeScoreBarCount(notes as MidiNote[]), extraBars + 1)

  const persist = useCallback(
    async (next: LocalNote[]) => {
      await tienda.executor.execute('midi.notes.set', {
        pistaId: trackId,
        clipId,
        notas: next.map((n) => ({
          id: n.id,
          pitch: n.pitch,
          inicio: n.inicio,
          duracion: n.duracion,
          velocidad: n.velocidad,
          canal: n.canal ?? 0,
        })),
        duracion: Math.max(
          clip?.duracion ?? 4,
          next.reduce((m, n) => Math.max(m, n.inicio + n.duracion), 4),
        ),
      })
      setDirty(false)
    },
    [tienda, trackId, clipId, clip?.duracion],
  )

  const handleNotesChange = useCallback(
    (next: LocalNote[]) => {
      setNotes(next)
      setDirty(true)
      void persist(next)
    },
    [persist],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size === 0) return
        e.preventDefault()
        const next = notes.filter((n) => !selectedIds.has(n.id))
        setNotes(next)
        setSelectedIds(new Set())
        setDirty(true)
        void persist(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [notes, selectedIds, persist])

  const handleExport = () => {
    void buildScorePdfBytes(notes as MidiNote[], {
      title: `${trackName} · ${clip?.nombre ?? 'Clip'}`,
      bpm,
      drums,
    }).then((bytes) =>
      saveScorePdfBytes(bytes, scoreFileName(trackName, clip?.nombre ?? 'clip')),
    )
  }

  const handlePreview = () => {
    openScorePreview({
      title: `${trackName} · ${clip?.nombre ?? 'Clip'}`,
      subtitle: `${bpm} BPM · ${drums ? 'Percusión' : 'Melódico'}`,
      fileName: scoreFileName(trackName, clip?.nombre ?? 'clip'),
      notes: notes as MidiNote[],
      bpm,
      drums,
    })
  }

  if (!clip || clip.tipo !== 'midi') {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
        Clip MIDI no encontrado
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[12px] font-semibold text-foreground">
            {trackName} · {clip.nombre ?? 'Clip'}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {bpm} BPM
            {projectKey ? ` · ${projectKey.label}` : ''}
            {keyRegions.length ? ` · ${keyRegions.length} cambios de tono` : ''}
            {' · '}
            {barCount} compases · {notes.length} notas
            {dirty ? ' · guardando…' : ''}
          </span>
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-panel-raised p-0.5">
          {(
            [
              ['select', MousePointer2, 'Seleccionar'],
              ['pencil', Pencil, 'Añadir nota'],
              ['eraser', Eraser, 'Borrar'],
            ] as const
          ).map(([id, Icon, title]) => (
            <button
              key={id}
              type="button"
              title={title}
              onClick={() => setTool(id)}
              className={`flex size-7 items-center justify-center rounded ${
                tool === id ? 'bg-accent-amber text-background' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-panel-raised p-1">
          {SCORE_NOTE_DURATIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              title={d.label}
              onClick={() => setDurationId(d.id)}
              className={`min-w-[2rem] rounded px-1.5 py-0.5 font-mono text-[13px] ${
                durationId === d.id
                  ? 'bg-accent-amber text-background'
                  : 'text-muted-foreground hover:bg-panel hover:text-foreground'
              }`}
            >
              {d.symbol}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setExtraBars((b) => b + 1)}
          className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          + Compás
        </button>
        <button
          type="button"
          onClick={() => requestOpenTool('piano-roll', { zone: 'bottom' })}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Piano className="size-3" />
          Piano roll
        </button>
        <button
          type="button"
          onClick={handlePreview}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Music2 className="size-3" />
          Vista previa
        </button>
        <button
          type="button"
          onClick={handleExport}
          className="flex items-center gap-1 rounded bg-accent-amber px-2 py-1 text-[11px] font-semibold text-background"
        >
          <FileDown className="size-3" />
          PDF
        </button>
        {dirty ? <Save className="size-3.5 animate-pulse text-accent-amber" /> : null}
      </div>

      <ScoreSheetCanvas
        notes={notes as MidiNote[]}
        drums={drums}
        barCount={barCount}
        selectedIds={selectedIds}
        renderBar={(barIndex) => (
          <EditableScoreBar
            barIndex={barIndex}
            notes={notes}
            drums={drums}
            selectedIds={selectedIds}
            tool={tool}
            noteDuration={noteDuration}
            snapGrid={snapGrid}
            onNotesChange={handleNotesChange}
            onSelect={setSelectedIds}
          />
        )}
      />
    </div>
  )
}

function ScoreEditorEmptyShell({
  message,
  clips,
  onPick,
}: {
  message: string
  clips?: { trackId: string; clipId: string; label: string }[]
  onPick?: (trackId: string, clipId: string) => void
}) {
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="border-b border-border px-3 py-2 text-[12px] font-semibold">Partitura</div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <Music2 className="size-8 text-muted-foreground/40" />
        <p className="max-w-[300px] text-[11px] text-muted-foreground">{message}</p>
        {clips && clips.length > 0 && onPick && (
          <select
            className="max-w-[280px] rounded-md border border-border bg-panel-raised px-2 py-1.5 text-[11px]"
            defaultValue=""
            onChange={(e) => {
              const [trackId, clipId] = e.target.value.split('\t')
              if (trackId && clipId) onPick(trackId, clipId)
            }}
          >
            <option value="" disabled>
              Elegir clip MIDI…
            </option>
            {clips.map((c) => (
              <option key={`${c.trackId}:${c.clipId}`} value={`${c.trackId}\t${c.clipId}`}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

export function ScoreEditorToolPanel() {
  const urlFocus = getUndockUrlFocus()
  const [override, setOverride] = useState<{ trackId: string; clipId: string } | null>(null)
  const hintTrack = override?.trackId || urlFocus.trackId
  const hintClip = override?.clipId || urlFocus.clipId

  const resolvedKey = useDAWState((s: DAWState) => {
    const hit = resolvePianoRollClip(s, { trackId: hintTrack, clipId: hintClip })
    return hit ? `${hit.trackId}\t${hit.clipId}` : ''
  })
  const midiClipOptions = useDAWState((s: DAWState) => {
    const list = listMidiClips(s)
    return list.map((c) => `${c.trackId}\t${c.clipId}\t${c.label}`).join('\n')
  })

  const trackId = override?.trackId || (resolvedKey ? resolvedKey.split('\t')[0] : null) || urlFocus.trackId
  const clipId = override?.clipId || (resolvedKey ? resolvedKey.split('\t')[1] : null) || urlFocus.clipId
  const midiClips = useMemo(() => {
    if (!midiClipOptions) return []
    return midiClipOptions.split('\n').map((line) => {
      const [t, c, ...rest] = line.split('\t')
      return { trackId: t!, clipId: c!, label: rest.join('\t') || c! }
    })
  }, [midiClipOptions])

  if (!trackId || !clipId) {
    return (
      <ScoreEditorEmptyShell
        message="Selecciona un clip MIDI (doble clic en el arrange o menú contextual) para editar la partitura aquí."
        clips={midiClips}
        onPick={(t, c) => setOverride({ trackId: t, clipId: c })}
      />
    )
  }

  return <ScoreEditor trackId={trackId} clipId={clipId} />
}
