import { Construction, Library, Gauge, GitBranch, Piano, SlidersHorizontal } from 'lucide-react'
import { ArrangeView } from '@/components/arrange-view'
import { Mixer } from '@/components/mixer'
import { MixAnalyzerPanel } from '@/components/mix-analyzer-panel'
import { CoProducerPanel } from '@/components/coproducer-panel'
import { AgentDocsPanel } from '@/components/agent-docs-panel'
import { DocsExplorerPanel } from '@/components/docs-explorer-panel'
import { TrackDetailPanel } from '@/components/track-detail-panel'
import { PianoRollToolPanel } from '@/components/piano-roll'
import { ScoreEditorToolPanel } from '@/components/score-editor-panel'
import { InstrumentsPanel } from '@/components/instruments-panel'
import { LibraryPanel } from '@/components/library-panel'
import { FxChainPanel } from '@/components/fx-chain-panel'
import { PluginEditorPanel } from '@/components/plugin-editor-panel'
import { MidiMapPanel } from '@/components/midi-map-panel'
import { SettingsPanel } from '@/components/project-settings-dialog'
import { useDAWState } from '@/src/context/daw-context'
import type { ToolId } from '@/src/workspace/types'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'

function _PlaceholderTool({ title }: { title: string }) {
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
  const selectedTrackId = useDAWState((s) => getSelectedTrackId(s))

  switch (toolId) {
    case 'coproducer':
      return <CoProducerPanel />
    case 'docs':
      return <AgentDocsPanel />
    case 'docs-explorer':
      return <DocsExplorerPanel />
    case 'arrange':
      return <ArrangeView />
    case 'mixer':
      return <Mixer />
    case 'track-detail':
      return <TrackDetailPanel trackId={selectedTrackId} />
    case 'piano-roll':
      return <PianoRollToolPanel />
    case 'score-editor':
      return <ScoreEditorToolPanel />
    case 'instruments':
      return <InstrumentsPanel />
    case 'fx-chain':
      return <FxChainPanel />
    case 'plugin-editor':
      return <PluginEditorPanel />
    case 'midi-map':
      return <MidiMapPanel />
    case 'settings':
      return <SettingsPanel />
    case 'library':
      return <LibraryPanel />
    case 'meters':
      return <MixAnalyzerPanel />
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
