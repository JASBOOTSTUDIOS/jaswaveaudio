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
import { ProjectReadyProvider } from '@/src/context/project-ready-context'
import { PluginHostBootstrap } from '@/components/plugin-host-bootstrap'
import { PluginHostLifecycle } from '@/components/plugin-host-lifecycle'
import { MidiControllerHost } from '@/components/midi-controller-host'
import { AgentAuditHost, AGENT_BRIDGE_REV } from '@/src/lib/agent-audit-bridge'
// bridge rev consumed as <AgentAuditHost key={AGENT_BRIDGE_REV} />
import { PanelLeft, PanelRight, PanelBottom, Plus, X } from 'lucide-react'
import { JasWaveAppIcon } from '@/components/brand'
import { ScoreExportMenuListener } from '@/components/score-export-menu-listener'
import { ScorePreviewDialog } from '@/components/score-preview-dialog'

function FloatingDockApp({ initialToolId }: { initialToolId: ToolId }) {
  useShortcutDispatcher()
  const [tabs, setTabs] = useState<ToolId[]>(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const raw = params.get('tabs')
      if (raw) {
        const parsed = raw
          .split(',')
          .map((s) => s.trim())
          .filter((id): id is ToolId => id in TOOL_CATALOG)
        if (parsed.length) return [...new Set(parsed)]
      }
    } catch {
      /* ignore */
    }
    return [initialToolId]
  })
  const [active, setActive] = useState<ToolId>(initialToolId)
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    const t = TOOL_CATALOG[active]?.title ?? active
    document.title = `JasWave — ${t}`
  }, [active])

  useEffect(() => {
    try {
      const ch = new BroadcastChannel('jaswave-workspace-v1')
      ch.onmessage = (ev: MessageEvent) => {
        const data = ev.data as { type?: string; toolId?: string; floatHost?: string }
        if (data?.type === 'float-accept-tab' && data.toolId && data.floatHost === initialToolId) {
          const id = data.toolId as ToolId
          if (!(id in TOOL_CATALOG)) return
          setTabs((prev) => (prev.includes(id) ? prev : [...prev, id]))
          setActive(id)
        }
      }
      return () => ch.close()
    } catch {
      return undefined
    }
  }, [initialToolId])

  const handleDockBack = (toolId?: ToolId) => {
    const ids = toolId ? [toolId] : [...tabs]
    try {
      const ch = new BroadcastChannel('jaswave-workspace-v1')
      for (const id of ids) ch.postMessage({ type: 'dock-tool', toolId: id })
      ch.close()
    } catch {
      /* ignore */
    }
    if (!toolId || tabs.length <= 1) {
      window.close()
      return
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t !== toolId)
      setActive(next[0] ?? initialToolId)
      return next
    })
  }

  const stealTool = (toolId: ToolId) => {
    if (tabs.includes(toolId)) {
      setActive(toolId)
      setAddOpen(false)
      return
    }
    try {
      const ch = new BroadcastChannel('jaswave-workspace-v1')
      ch.postMessage({ type: 'steal-tool-to-float', toolId, floatHost: initialToolId })
      ch.close()
    } catch {
      /* ignore */
    }
    setTabs((prev) => [...prev, toolId])
    setActive(toolId)
    setAddOpen(false)
  }

  const visible = tabs.includes(active) ? active : tabs[0]!

  return (
    <main className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-10 items-center gap-2 border-b border-border bg-panel px-2 text-[12px] font-semibold">
        <JasWaveAppIcon className="size-7 shrink-0" />
        <span className="text-[10px] font-normal text-muted-foreground">flotante</span>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setActive(id)}
              className={`flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] ${
                id === visible ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-panel-raised'
              }`}
            >
              {TOOL_CATALOG[id].title}
              <span
                role="button"
                tabIndex={0}
                title="Acoplar de nuevo"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDockBack(id)
                }}
                className="rounded p-0.5 hover:bg-panel-raised"
              >
                <X className="size-3" />
              </span>
            </button>
          ))}
        </div>
        <div className="relative">
          <button
            type="button"
            title="Añadir panel a esta ventana"
            onClick={() => setAddOpen((v) => !v)}
            className="rounded p-1 text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
          {addOpen ? (
            <div className="absolute right-0 top-full z-[80] mt-1 max-h-64 w-48 overflow-y-auto rounded-md border border-border bg-panel py-1 shadow-xl">
              {(Object.keys(TOOL_CATALOG) as ToolId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={tabs.includes(id)}
                  onClick={() => stealTool(id)}
                  className="flex w-full px-3 py-1.5 text-left text-[11px] hover:bg-panel-raised disabled:opacity-40"
                >
                  {TOOL_CATALOG[id].title}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => handleDockBack()}
          className="rounded bg-panel-raised px-2 py-0.5 text-[10px] font-medium hover:bg-background"
        >
          Volver todo
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="h-full min-h-0">
          <ToolHost toolId={visible} />
        </div>
      </div>
    </main>
  )
}

function AppShell() {
  const dispatcher = useShortcutDispatcher()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [railActive, setRailActive] = useState<ToolId | null>(null)
  const { layout, setActiveTab, toggleZone, toolsInZone, dockTool, closeTool, openTool, toggleTool, isToolOpen } =
    useWorkspace()

  useEffect(() => {
    const handler = () => setShortcutsOpen(true)
    window.addEventListener('open-shortcuts-dialog', handler)
    return () => window.removeEventListener('open-shortcuts-dialog', handler)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id
      if (id === 'archivo.exportarBounce') setExportOpen(true)
      if (id?.startsWith('ventana.tool.')) {
        const toolId = id.slice('ventana.tool.'.length) as ToolId
        if (toolId in TOOL_CATALOG) {
          window.dispatchEvent(new CustomEvent('jaswave-toggle-tool', { detail: { toolId } }))
        }
      }
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
        const api = window.electron as typeof window.electron & {
          openToolWindow?: (id: string, title: string) => Promise<unknown>
        }
        void api?.openToolWindow?.(toolId, TOOL_CATALOG[toolId].title)
        return
      }
      for (const zone of ['left', 'right', 'bottom', 'center'] as const) {
        if (toolsInZone(zone).includes(toolId)) {
          setActiveTab(zone, toolId)
          return
        }
      }
      openTool(toolId, detail.zone ?? TOOL_CATALOG[toolId].defaultZone)
    }
    window.addEventListener('jaswave-open-tool', handler)
    return () => window.removeEventListener('jaswave-open-tool', handler)
  }, [layout.undocked, toolsInZone, setActiveTab, openTool])

  useEffect(() => {
    const handler = (ev: Event) => {
      const toolId = (ev as CustomEvent<{ toolId: ToolId }>).detail?.toolId
      if (!toolId || !(toolId in TOOL_CATALOG)) return
      toggleTool(toolId)
    }
    window.addEventListener('jaswave-toggle-tool', handler)
    return () => window.removeEventListener('jaswave-toggle-tool', handler)
  }, [toggleTool])

  const handleRailSelect = (toolId: ToolId) => {
    setRailActive(toolId)
    if (layout.undocked.includes(toolId)) {
      dockTool(toolId)
      return
    }
    // Si ya está abierta y activa → cerrar tab (toggle).
    for (const zone of ['left', 'right', 'bottom', 'center'] as const) {
      if (toolsInZone(zone).includes(toolId)) {
        const zoneShown = zone === 'center' || layout.zoneVisible[zone]
        if (zoneShown && layout.activeTab[zone] === toolId) {
          closeTool(toolId)
          return
        }
        setActiveTab(zone, toolId)
        return
      }
    }
    openTool(toolId, TOOL_CATALOG[toolId].defaultZone)
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
      <ScoreExportMenuListener />
      <ScorePreviewDialog />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} dispatcher={dispatcher} />
      <ExportBounceDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <main className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
        <TitleBar />
        <AppMenuBar />

        <div className="flex flex-1 min-h-0">
          <IconRail
            activeTool={
              railActive && isToolOpen(railActive)
                ? railActive
                : layout.activeTab.left ??
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

            <ResizablePanelGroup direction="horizontal" autoSaveId="jaswave-ide-h" className="min-h-0 flex-1 bg-panel">
              {leftVisible && (
                <>
                  <ResizablePanel id="jas-left" order={1} defaultSize={22} minSize={12} maxSize={40} className="min-h-0 min-w-0 border-r border-border bg-panel">
                    <div className="h-full min-h-0">
                      <DockZonePanel zone="left" />
                    </div>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                </>
              )}

              <ResizablePanel id="jas-center" order={2} defaultSize={leftVisible && rightVisible ? 56 : 78} minSize={30} className="min-h-0 min-w-0 bg-panel">
                <ResizablePanelGroup direction="vertical" autoSaveId="jaswave-ide-v" className="h-full min-h-0 bg-panel">
                  <ResizablePanel id="jas-arrange" order={1} defaultSize={bottomVisible ? 62 : 100} minSize={20} className="min-h-0 bg-panel">
                    <div className="h-full min-h-0">
                      <DockZonePanel zone="center" />
                    </div>
                  </ResizablePanel>
                  {bottomVisible && (
                    <>
                      <ResizableHandle withHandle />
                      <ResizablePanel id="jas-bottom" order={2} defaultSize={38} minSize={12} maxSize={70} className="min-h-0 border-t border-border bg-panel">
                        <div className="h-full min-h-0">
                          <DockZonePanel zone="bottom" />
                        </div>
                      </ResizablePanel>
                    </>
                  )}
                </ResizablePanelGroup>
              </ResizablePanel>

              {rightVisible && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel id="jas-right" order={3} defaultSize={22} minSize={12} maxSize={40} className="min-h-0 min-w-0 border-l border-border bg-panel">
                    <div className="h-full min-h-0">
                      <DockZonePanel zone="right" />
                    </div>
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
        <ProjectReadyProvider>
          <PlaybackProvider>
            {undockId ? (
              <WorkspaceProvider>
                <MultiWindowSync role="satellite" />
                <PluginHostBootstrap />
                <FloatingDockApp initialToolId={undockId} />
              </WorkspaceProvider>
            ) : (
              <WorkspaceProvider>
                <MultiWindowSync role="primary" />
                <PluginHostBootstrap />
                <PluginHostLifecycle />
                <MidiControllerHost />
                <AgentAuditHost key={AGENT_BRIDGE_REV} />
                <AppShell />
              </WorkspaceProvider>
            )}
          </PlaybackProvider>
        </ProjectReadyProvider>
      </ImportProgressProvider>
    </DAWProvider>
  )
}
