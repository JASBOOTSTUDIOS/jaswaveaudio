import { useState, useEffect } from 'react'
import { DAWProvider } from './context/daw-context'
import { PlaybackProvider } from '@/components/playback-provider'
import { CommandPalette } from '@/components/command-palette'
import { useShortcutDispatcher } from '@/hooks/use-shortcut-dispatcher'
import { ShortcutsDialog } from '@/components/shortcuts-dialog'
import { ExportBounceDialog } from '@/components/export-bounce-dialog'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import { TitleBar } from '@/components/title-bar'
import { AppMenuBar } from '@/components/app-menu-bar'
import { IconRail } from '@/components/icon-rail'
import { TransportBar } from '@/components/transport-bar'
import { EditToolbar } from '@/components/edit-toolbar'
import { EventToasts } from '@/components/event-toasts'
import { ProjectCloseDialog } from '@/components/project-close-dialog'
import { DockZonePanel } from '@/components/workspace/ide-shell'
import { ToolHost } from '@/components/workspace/tool-host'
import {
  WorkspaceProvider,
  useWorkspace,
  getUndockToolIdFromUrl,
} from '@/src/workspace/workspace-context'
import { TOOL_CATALOG, type ToolId } from '@/src/workspace/types'
import { MultiWindowSync } from '@/src/workspace/multi-window-sync'
import { WorkspaceMenu } from '@/components/workspace/workspace-menu'
import { ImportProgressProvider } from '@/src/context/import-progress-context'
import { PluginHostBootstrap } from '@/components/plugin-host-bootstrap'
import { PluginHostLifecycle } from '@/components/plugin-host-lifecycle'
import { MidiControllerHost } from '@/components/midi-controller-host'
import { PanelLeft, PanelRight, PanelBottom } from 'lucide-react'
import { JasWaveAppIcon, JasWaveLogo } from '@/components/brand'

function UndockedToolApp({ toolId }: { toolId: ToolId }) {
  const title = TOOL_CATALOG[toolId]?.title ?? toolId
  useEffect(() => {
    document.title = `JasWave — ${title}`
  }, [title])

  const handleDockBack = () => {
    try {
      const ch = new BroadcastChannel('jaswave-workspace-v1')
      ch.postMessage({ type: 'dock-tool', toolId })
      ch.close()
    } catch {
      /* ignore */
    }
    window.close()
  }

  return (
    <main className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-10 items-center gap-2 border-b border-border bg-panel px-3 text-[12px] font-semibold">
        {toolId === 'coproducer' ? (
          <JasWaveLogo className="h-8 w-auto max-w-[120px] shrink-0" alt="" />
        ) : (
          <JasWaveAppIcon className="size-8 shrink-0" />
        )}
        <span className="flex-1 truncate">{title}</span>
        <span className="text-[10px] font-normal text-muted-foreground">ventana flotante</span>
        <button
          type="button"
          onClick={handleDockBack}
          className="rounded bg-panel-raised px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-background"
        >
          Volver al panel
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ToolHost toolId={toolId} />
      </div>
    </main>
  )
}

function AppShell() {
  const dispatcher = useShortcutDispatcher()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const { layout, setActiveTab, toggleZone, moveTool, toolsInZone, dockTool } = useWorkspace()

  useEffect(() => {
    const handler = () => setShortcutsOpen(true)
    window.addEventListener('open-shortcuts-dialog', handler)
    return () => window.removeEventListener('open-shortcuts-dialog', handler)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id
      if (id === 'archivo.exportarBounce') setExportOpen(true)
    }
    window.addEventListener('jaswave-menu-action', handler)
    return () => window.removeEventListener('jaswave-menu-action', handler)
  }, [])

  useEffect(() => {
    const handler = () => {
      window.dispatchEvent(new CustomEvent('jaswave-open-tool', { detail: { toolId: 'settings' } }))
    }
    window.addEventListener('open-project-settings', handler)
    return () => window.removeEventListener('open-project-settings', handler)
  }, [])

  useEffect(() => {
    const handler = (ev: Event) => {
      const zone = (ev as CustomEvent<{ zone: 'left' | 'right' | 'bottom' }>).detail?.zone
      if (zone) toggleZone(zone)
    }
    window.addEventListener('jaswave-toggle-zone', handler)
    return () => window.removeEventListener('jaswave-toggle-zone', handler)
  }, [toggleZone])

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ toolId: ToolId; zone?: 'left' | 'right' | 'bottom' | 'center' }>)
        .detail
      const toolId = detail?.toolId
      if (!toolId || !(toolId in TOOL_CATALOG)) return
      if (layout.undocked.includes(toolId)) {
        // Ya está en otra ventana: enfocarla (no volver a acoplar)
        const api = window.electron as typeof window.electron & {
          openToolWindow?: (id: string, title: string) => Promise<unknown>
        }
        void api?.openToolWindow?.(toolId, TOOL_CATALOG[toolId].title)
        return
      }
      for (const zone of ['left', 'right', 'bottom', 'center'] as const) {
        if (toolsInZone(zone).includes(toolId)) {
          setActiveTab(zone, toolId)
          if (!layout.zoneVisible[zone] && zone !== 'center') toggleZone(zone)
          return
        }
      }
      moveTool(toolId, detail.zone ?? TOOL_CATALOG[toolId].defaultZone)
    }
    window.addEventListener('jaswave-open-tool', handler)
    return () => window.removeEventListener('jaswave-open-tool', handler)
  }, [layout.undocked, layout.zoneVisible, toolsInZone, setActiveTab, toggleZone, moveTool])

  const handleRailSelect = (toolId: ToolId) => {
    if (layout.undocked.includes(toolId)) {
      dockTool(toolId)
      return
    }
    for (const zone of ['left', 'right', 'bottom', 'center'] as const) {
      if (toolsInZone(zone).includes(toolId)) {
        setActiveTab(zone, toolId)
        if (!layout.zoneVisible[zone] && zone !== 'center') toggleZone(zone)
        return
      }
    }
    moveTool(toolId, TOOL_CATALOG[toolId].defaultZone)
  }

  // Mostrar zona aunque esté vacía (para poder + / soltar herramientas)
  const leftVisible = layout.zoneVisible.left
  const rightVisible = layout.zoneVisible.right
  const bottomVisible = layout.zoneVisible.bottom

  return (
    <>
      <CommandPalette />
      <EventToasts />
      <ProjectCloseDialog />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} dispatcher={dispatcher} />
      <ExportBounceDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <main className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
        <TitleBar />
        <AppMenuBar />

        <div className="flex flex-1 min-h-0">
          <IconRail
            activeTool={
              layout.activeTab.left ??
              layout.activeTab.right ??
              layout.activeTab.bottom ??
              layout.activeTab.center
            }
            undockedTools={layout.undocked}
            onToolSelect={handleRailSelect}
            onToggleZone={toggleZone}
            zoneVisible={layout.zoneVisible}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <TransportBar />
            <EditToolbar />

            <ResizablePanelGroup direction="horizontal" autoSaveId="jaswave-ide-h" className="min-h-0 flex-1">
              {leftVisible && (
                <>
                  <ResizablePanel id="jas-left" order={1} defaultSize={22} minSize={12} maxSize={40} className="min-w-0 border-r border-border">
                    <DockZonePanel zone="left" />
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                </>
              )}

              <ResizablePanel id="jas-center" order={2} defaultSize={leftVisible && rightVisible ? 56 : 78} minSize={30} className="min-w-0">
                <ResizablePanelGroup direction="vertical" autoSaveId="jaswave-ide-v" className="h-full">
                  <ResizablePanel id="jas-arrange" order={1} defaultSize={bottomVisible ? 62 : 100} minSize={20}>
                    <DockZonePanel zone="center" />
                  </ResizablePanel>
                  {bottomVisible && (
                    <>
                      <ResizableHandle withHandle />
                      <ResizablePanel id="jas-bottom" order={2} defaultSize={38} minSize={12} maxSize={70} className="border-t border-border">
                        <DockZonePanel zone="bottom" />
                      </ResizablePanel>
                    </>
                  )}
                </ResizablePanelGroup>
              </ResizablePanel>

              {rightVisible && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel id="jas-right" order={3} defaultSize={22} minSize={12} maxSize={40} className="min-w-0 border-l border-border">
                    <DockZonePanel zone="right" />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
        </div>

        {/* Barra de workspace: reabrir paneles + menú Ventanas */}
        <div className="flex h-7 items-center gap-1 border-t border-border bg-panel px-2">
          <WorkspaceMenu />
          <div className="mx-1 h-3 w-px bg-border" />
          {!leftVisible && (
            <button type="button" className="flex items-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground hover:bg-panel-raised hover:text-foreground" onClick={() => toggleZone('left')}>
              <PanelLeft className="size-3" /> Izquierda
            </button>
          )}
          {!rightVisible && (
            <button type="button" className="flex items-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground hover:bg-panel-raised hover:text-foreground" onClick={() => toggleZone('right')}>
              <PanelRight className="size-3" /> Derecha
            </button>
          )}
          {!bottomVisible && (
            <button type="button" className="flex items-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground hover:bg-panel-raised hover:text-foreground" onClick={() => toggleZone('bottom')}>
              <PanelBottom className="size-3" /> Inferior
            </button>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground/70">
            Ventanas · + en pestañas · clic en el rail para recuperar
          </span>
        </div>
      </main>
    </>
  )
}

export default function App() {
  const undockId = getUndockToolIdFromUrl()

  return (
    <DAWProvider>
      <ImportProgressProvider>
        <PlaybackProvider>
          {undockId ? (
            <WorkspaceProvider>
              <MultiWindowSync role="satellite" />
              <PluginHostBootstrap />
              <UndockedToolApp toolId={undockId} />
            </WorkspaceProvider>
          ) : (
            <WorkspaceProvider>
              <MultiWindowSync role="primary" />
              <PluginHostBootstrap />
              <PluginHostLifecycle />
              <MidiControllerHost />
              <AppShell />
            </WorkspaceProvider>
          )}
        </PlaybackProvider>
      </ImportProgressProvider>
    </DAWProvider>
  )
}
