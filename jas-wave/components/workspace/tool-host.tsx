import { Boxes, Construction, GitBranch } from 'lucide-react'
import { DawTerminalPanel } from '@/components/daw-terminal-panel'
import { ArrangeView } from '@/components/arrange-view'
import { Mixer } from '@/components/mixer'
import { MixAnalyzerPanel } from '@/components/mix-analyzer-panel'
import { TrackDetailPanel } from '@/components/track-detail-panel'
import { PianoRollToolPanel } from '@/components/piano-roll'
import { InstrumentsPanel } from '@/components/instruments-panel'
import { LibraryPanel } from '@/components/library-panel'
import { FxChainPanel } from '@/components/fx-chain-panel'
import { AutomationLanesPanel } from '@/components/automation-lanes-panel'
import { PluginEditorPanel } from '@/components/plugin-editor-panel'
import { MidiMapPanel } from '@/components/midi-map-panel'
import { SettingsPanel } from '@/components/project-settings-dialog'
import { ProjectFileExplorer } from './project-file-explorer'
import { PanelCuenta } from '@/components/cuenta/panel-cuenta'
import { PanelAdmin } from '@/components/admin/panel-admin'
import { PanelModulos } from '@/components/modulos/panel-modulos'
import { panelDeHerramienta } from '@/src/modulos/registro-modulos'
import { useVersionModulos } from '@/src/modulos/use-modulos'
import { useDAWState } from '@/src/context/daw-context'
import type { ToolId } from '@/src/workspace/types'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'
import { AppErrorBoundary } from '@/components/app-error-boundary'

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

/** Cada panel tiene su boundary: un fallo en uno no tumba el DAW ni el audio. */
export function ToolHost({ toolId }: { toolId: ToolId }) {
  return (
    <AppErrorBoundary key={toolId} area={toolId} compact>
      <ToolContent toolId={toolId} />
    </AppErrorBoundary>
  )
}

function ToolContent({ toolId }: { toolId: ToolId }) {
  const selectedTrackId = useDAWState((s) => getSelectedTrackId(s))
  useVersionModulos()
  const PanelModulo = panelDeHerramienta(toolId)
  if (PanelModulo) return <PanelModulo />

  switch (toolId) {
    case 'arrange':
      return <ArrangeView />
    case 'mixer':
      return <Mixer />
    case 'track-detail':
      return <TrackDetailPanel trackId={selectedTrackId} />
    case 'piano-roll':
      return <PianoRollToolPanel />
    case 'terminal':
      return <DawTerminalPanel />
    case 'instruments':
      return <InstrumentsPanel />
    case 'fx-chain':
      return <FxChainPanel />
    case 'automation':
      return <AutomationLanesPanel />
    case 'plugin-editor':
      return <PluginEditorPanel />
    case 'midi-map':
      return <MidiMapPanel />
    case 'settings':
      return <SettingsPanel />
    case 'project-files':
      return <ProjectFileExplorer />
    case 'cuenta':
      return <PanelCuenta />
    case 'admin':
      return <PanelAdmin />
    case 'modulos':
      return <PanelModulos />
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
      // Herramienta de un módulo que no está instalado, activo o cargado en este equipo.
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-panel px-4 text-center" data-testid="herramienta-no-disponible">
          <Boxes className="size-8 text-muted-foreground/40" />
          <p className="max-w-[260px] text-[11px] text-muted-foreground">
            Esta herramienta es de un módulo que no está instalado o activo.
          </p>
          <button
            type="button"
            className="rounded-md bg-accent-amber/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/30"
            onClick={() => window.dispatchEvent(new CustomEvent('jaswave-open-tool', { detail: { toolId: 'modulos' } }))}
          >
            Abrir Módulos
          </button>
        </div>
      )
  }
}
