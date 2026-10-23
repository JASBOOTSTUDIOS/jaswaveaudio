import { useEffect, useState, type ComponentType } from 'react'
import { Boxes, Construction, Library, GitBranch, Loader2, Piano, SlidersHorizontal } from 'lucide-react'
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
import { cargarModulo, estadoCarga, fijarModuloActivo, moduloActivo, moduloDeHerramienta, type ModuloDAW } from '@/src/modulos/registro-modulos'
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

/** Herramienta de un módulo: se descarga su código (chunk aparte) la primera vez que se abre. */
function PanelDeModulo({ modulo, toolId }: { modulo: ModuloDAW; toolId: ToolId }) {
  useVersionModulos()
  const [Panel, setPanel] = useState<ComponentType | null>(null)
  const activo = moduloActivo(modulo.id)
  const carga = estadoCarga(modulo.id)

  useEffect(() => {
    if (!activo) return
    let vivo = true
    cargarModulo(modulo.id).then(
      (paneles) => {
        const p = paneles[toolId]
        if (vivo && p) setPanel(() => p)
      },
      () => {},
    )
    return () => {
      vivo = false
    }
  }, [activo, modulo.id, toolId])

  if (!activo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-panel px-4 text-center" data-testid="modulo-inactivo">
        <Boxes className="size-8 text-muted-foreground/40" />
        <span className="text-[13px] font-semibold text-foreground">{modulo.nombre}</span>
        <p className="max-w-[260px] text-[11px] text-muted-foreground">Este módulo está desactivado.</p>
        <button
          type="button"
          className="rounded-md bg-accent-amber/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/30"
          onClick={() => fijarModuloActivo(modulo.id, true)}
        >
          Activar módulo
        </button>
      </div>
    )
  }
  if (Panel) return <Panel />
  if (carga.estado === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-panel px-4 text-center">
        <p role="alert" className="text-[11px] text-red-400">
          No se pudo descargar {modulo.nombre}: {carga.error}
        </p>
        <button
          type="button"
          className="rounded-md border border-border px-2.5 py-1.5 text-[11px]"
          onClick={() => void cargarModulo(modulo.id).catch(() => {})}
        >
          Reintentar
        </button>
      </div>
    )
  }
  return (
    <div className="flex h-full items-center justify-center gap-2 bg-panel text-[11px] text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Cargando {modulo.nombre}…
    </div>
  )
}

function ToolContent({ toolId }: { toolId: ToolId }) {
  const selectedTrackId = useDAWState((s) => getSelectedTrackId(s))
  const modulo = moduloDeHerramienta(toolId)
  if (modulo) return <PanelDeModulo modulo={modulo} toolId={toolId} />

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
      return (
        <div className="flex h-full items-center justify-center gap-2 bg-panel text-muted-foreground">
          <Library className="size-5" />
          <SlidersHorizontal className="size-5" />
          <Piano className="size-5" />
        </div>
      )
  }
}
