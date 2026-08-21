import { Construction, Library, Gauge, GitBranch, Piano, SlidersHorizontal } from 'lucide-react'
import { ArrangeView } from '@/components/arrange-view'
import { Mixer } from '@/components/mixer'
import { CoProducerPanel } from '@/components/coproducer-panel'
import { TrackDetailPanel } from '@/components/track-detail-panel'
import { PianoRollToolPanel } from '@/components/piano-roll'
import { InstrumentsPanel } from '@/components/instruments-panel'
import { useDAWState } from '@/src/context/daw-context'
import type { ToolId } from '@/src/workspace/types'

function PlaceholderTool({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-panel px-4 text-center">
      <Construction className="size-8 text-muted-foreground/40" />
      <span className="text-[13px] font-semibold text-foreground">{title}</span>
      <p className="max-w-[220px] text-[11px] text-muted-foreground">
        Panel disponible para acoplar; contenido en desarrollo.
      </p>
    </div>
  )
}

export function ToolHost({ toolId }: { toolId: ToolId }) {
  const selectedTrackId = useDAWState((s) => {
    const fromSel = s.selection?.idPrincipal ?? s.selection?.idsPistas?.[0] ?? null
    if (fromSel) return fromSel
    const clipId = s.selection?.idsClips?.[0]
    if (!clipId) return null
    for (const t of s.project?.tracks ?? []) {
      if ((t.clips ?? []).some((c) => c.id === clipId)) return t.id
    }
    return null
  })

  switch (toolId) {
    case 'coproducer':
      return <CoProducerPanel />
    case 'arrange':
      return <ArrangeView />
    case 'mixer':
      return <Mixer />
    case 'track-detail':
      return <TrackDetailPanel trackId={selectedTrackId} />
    case 'piano-roll':
      return <PianoRollToolPanel />
    case 'instruments':
      return <InstrumentsPanel />
    case 'library':
      return <PlaceholderTool title="Biblioteca de Audio" />
    case 'meters':
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-panel text-muted-foreground">
          <Gauge className="size-8 opacity-40" />
          <span className="text-[12px]">Medidores — próximamente</span>
        </div>
      )
    case 'routing':
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-panel text-muted-foreground">
          <GitBranch className="size-8 opacity-40" />
          <span className="text-[12px]">Ruteo — próximamente</span>
        </div>
      )
    default:
      return (
        <div className="flex h-full items-center justify-center gap-2 bg-panel text-muted-foreground">
          <Library className="size-5" />
          <SlidersHorizontal className="size-5" />
          <Piano className="size-5" />
        </div>
      )
  }
}
