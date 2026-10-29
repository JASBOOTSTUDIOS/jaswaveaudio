import { useCallback, useMemo, useState } from 'react'
import { Check, ExternalLink, Loader2, Trash2 } from 'lucide-react'

import { stopMidiPreviewAudition } from '../motor/midi-preview-audition'
import { MidiPreviewTransport } from './midi-preview-transport'
import { BotonVerTodo, useVerTodo } from './lista-expandible'
import { textoLegible } from './detalles-tecnicos'
import { clearMidiProposalOverlay, executeDawActions, pitchToName, requestOpenTool, setMidiProposalOverlay, useDAW } from '@jaswave/host-sdk'

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

  const auditionTrack = useMemo(
    () => tracks.find((t) => t.id === auditionTrackId),
    [auditionTrackId, tracks],
  )

  const audibleNotes = useMemo(
    () => preview.notes.filter((n) => !n.mute),
    [preview.notes],
  )

  const filas = useVerTodo(preview.notes, 12)
  const avisos = (preview.errors ?? []).map((e) => textoLegible(e)).filter(Boolean)

  const stopPreview = useCallback(() => {
    stopMidiPreviewAudition()
  }, [])

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
  }, [])

  if (localStatus === 'discarded') {
    return (
      <div className="mt-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Propuesta de notas descartada («{preview.nombre}»).
      </div>
    )
  }

  const instPlugin = auditionTrack?.plugins?.find((p) => p.tipo === 'instrumento' || !p.tipo)

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-emerald-500/30 bg-emerald-500/5">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground" title={preview.nombre}>
            Notas propuestas · {preview.nombre}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {preview.notes.length} {preview.notes.length === 1 ? 'nota' : 'notas'} · {preview.bpm} BPM · vista previa, todavía no está en el proyecto
          </div>
        </div>
        {localStatus === 'applied' ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600">
            <Check className="size-3" /> Aplicado
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <label className="text-[10px] text-muted-foreground">Escuchar con</label>
        <select
          aria-label="Pista con la que escuchar"
          className="max-w-[180px] rounded border border-border bg-background px-1.5 py-0.5 text-[10px]"
          value={auditionTrackId}
          onChange={(e) => setAuditionTrackId(e.target.value)}
        >
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
        {preview.instrumentoHint ? (
          <span className="text-[10px] text-muted-foreground">Instrumento sugerido: {preview.instrumentoHint}</span>
        ) : null}
      </div>

      <div className="border-t border-border/40 px-3 py-2">
        <MidiPreviewTransport
          notes={audibleNotes}
          bpm={preview.bpm}
          durationBeats={preview.durationBeats || Math.max(4, ...audibleNotes.map((n) => n.inicio + n.duracion))}
          trackId={auditionTrackId || preview.trackId}
          candidateTrackIds={tracks.map((t) => t.id)}
          pluginId={instPlugin?.id}
          pluginNombre={instPlugin?.nombre ?? preview.instrumentoHint}
        />
      </div>

      <div className="px-3 pb-2">
        <table className="w-full table-fixed text-left text-[10px]">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-0.5 pr-2 font-medium">Nota</th>
              <th className="py-0.5 pr-2 font-medium">Inicio (tiempo)</th>
              <th className="py-0.5 pr-2 font-medium">Duración</th>
              <th className="py-0.5 pr-2 font-medium">Fuerza</th>
            </tr>
          </thead>
          <tbody>
            {filas.visibles.map((n, i) => (
              <tr key={n.id ?? i} className={`border-t border-border/30${n.mute ? ' opacity-50' : ''}`}>
                <td className="py-0.5 pr-2">{pitchToName(n.pitch)}</td>
                <td className="py-0.5 pr-2">{(n.inicio + 1).toFixed(2).replace('.', ',')}</td>
                <td className="py-0.5 pr-2">{n.duracion.toFixed(2).replace('.', ',')}</td>
                <td className="py-0.5 pr-2">{n.velocidad}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <BotonVerTodo
          ocultos={filas.ocultos}
          todo={filas.todo}
          onClick={filas.alternar}
          className="pt-1 text-[10px] text-muted-foreground hover:text-foreground"
        />
        {avisos.length ? (
          <ul className="list-disc pl-4 pt-1 text-[10px] text-amber-600">
            {avisos.map((a, i) => (
              <li key={i} className="break-words">{a}</li>
            ))}
          </ul>
        ) : preview.errors?.length ? (
          <div className="pt-1 text-[10px] text-amber-600">Algunas notas no se pudieron leer y se omitieron.</div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-border/50 px-3 py-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-muted/40"
          onClick={publishOverlay}
          disabled={localStatus !== 'pending'}
        >
          Ver en el piano roll
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-muted/40"
          onClick={openDocs}
        >
          <ExternalLink className="size-3" /> Abrir documentos
        </button>
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
