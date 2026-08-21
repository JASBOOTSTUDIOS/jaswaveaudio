import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_WORKSPACE,
  loadWorkspace,
  saveWorkspace,
  TOOL_CATALOG,
  type DockZone,
  type ToolId,
  type WorkspaceLayout,
} from './types'

type WorkspaceContextValue = {
  layout: WorkspaceLayout
  moveTool: (toolId: ToolId, toZone: DockZone, index?: number) => void
  setActiveTab: (zone: DockZone, toolId: ToolId) => void
  toggleZone: (zone: DockZone) => void
  undockTool: (toolId: ToolId) => Promise<void>
  dockTool: (toolId: ToolId, zone?: DockZone) => void
  isUndocked: (toolId: ToolId) => boolean
  toolsInZone: (zone: DockZone) => ToolId[]
  resetLayout: () => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

function stripTool(layout: WorkspaceLayout, toolId: ToolId): WorkspaceLayout {
  const zones = { ...layout.zones }
  for (const zone of Object.keys(zones) as DockZone[]) {
    zones[zone] = zones[zone].filter((id) => id !== toolId)
  }
  const activeTab = { ...layout.activeTab }
  for (const zone of Object.keys(activeTab) as DockZone[]) {
    if (activeTab[zone] === toolId) {
      activeTab[zone] = zones[zone][0] ?? null
    }
  }
  return {
    ...layout,
    zones,
    activeTab,
    undocked: layout.undocked.filter((id) => id !== toolId),
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<WorkspaceLayout>(() => loadWorkspace())

  useEffect(() => {
    saveWorkspace(layout)
  }, [layout])

  useEffect(() => {
    const api = window.electron as typeof window.electron & {
      onToolWindowClosed?: (cb: (toolId: string) => void) => () => void
    }
    if (!api?.onToolWindowClosed) return
    return api.onToolWindowClosed((toolId) => {
      setLayout((prev) => {
        if (!prev.undocked.includes(toolId as ToolId)) return prev
        const tool = TOOL_CATALOG[toolId as ToolId]
        if (!tool) return { ...prev, undocked: prev.undocked.filter((id) => id !== toolId) }
        const cleaned = stripTool(prev, tool.id)
        const zone = tool.defaultZone
        return {
          ...cleaned,
          zones: {
            ...cleaned.zones,
            [zone]: [...cleaned.zones[zone], tool.id],
          },
          activeTab: { ...cleaned.activeTab, [zone]: tool.id },
          zoneVisible: { ...cleaned.zoneVisible, [zone]: true },
          undocked: cleaned.undocked,
        }
      })
    })
  }, [])

  useEffect(() => {
    let ch: BroadcastChannel
    try {
      ch = new BroadcastChannel('jaswave-workspace-v1')
    } catch {
      return
    }
    ch.onmessage = (ev) => {
      const data = ev.data as { type?: string; toolId?: string }
      if (data.type === 'dock-tool' && data.toolId && data.toolId in TOOL_CATALOG) {
        const toolId = data.toolId as ToolId
        setLayout((prev) => {
          const cleaned = stripTool(prev, toolId)
          const zone = TOOL_CATALOG[toolId].defaultZone
          return {
            ...cleaned,
            zones: {
              ...cleaned.zones,
              [zone]: [...cleaned.zones[zone], toolId],
            },
            activeTab: { ...cleaned.activeTab, [zone]: toolId },
            zoneVisible: { ...cleaned.zoneVisible, [zone]: true },
            undocked: cleaned.undocked.filter((id) => id !== toolId),
          }
        })
        const api = window.electron as typeof window.electron & {
          closeToolWindow?: (id: string) => Promise<void>
        }
        void api?.closeToolWindow?.(toolId)
      }
    }
    return () => ch.close()
  }, [])

  const moveTool = useCallback((toolId: ToolId, toZone: DockZone, index?: number) => {
    setLayout((prev) => {
      if (prev.undocked.includes(toolId)) return prev
      let next = stripTool(prev, toolId)
      const list = [...next.zones[toZone]]
      const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length))
      list.splice(at, 0, toolId)
      next = {
        ...next,
        zones: { ...next.zones, [toZone]: list },
        activeTab: { ...next.activeTab, [toZone]: toolId },
        zoneVisible: { ...next.zoneVisible, [toZone]: true },
      }
      return next
    })
  }, [])

  const setActiveTab = useCallback((zone: DockZone, toolId: ToolId) => {
    setLayout((prev) => ({
      ...prev,
      activeTab: { ...prev.activeTab, [zone]: toolId },
      zoneVisible: { ...prev.zoneVisible, [zone]: true },
    }))
  }, [])

  const toggleZone = useCallback((zone: DockZone) => {
    if (zone === 'center') return
    setLayout((prev) => ({
      ...prev,
      zoneVisible: { ...prev.zoneVisible, [zone]: !prev.zoneVisible[zone] },
    }))
  }, [])

  const undockTool = useCallback(async (toolId: ToolId) => {
    const api = window.electron as typeof window.electron & {
      openToolWindow?: (toolId: string, title: string) => Promise<{ success: boolean }>
    }
    if (!api?.openToolWindow) {
      // Fallback web: marca undocked y abre popup
      const url = `${window.location.origin}${window.location.pathname}?undock=${toolId}`
      window.open(url, `jaswave-${toolId}`, 'width=900,height=700')
    } else {
      await api.openToolWindow(toolId, TOOL_CATALOG[toolId].title)
    }
    setLayout((prev) => {
      const cleaned = stripTool(prev, toolId)
      return {
        ...cleaned,
        undocked: cleaned.undocked.includes(toolId)
          ? cleaned.undocked
          : [...cleaned.undocked, toolId],
      }
    })
  }, [])

  const dockTool = useCallback((toolId: ToolId, zone?: DockZone) => {
    const target = zone ?? TOOL_CATALOG[toolId].defaultZone
    setLayout((prev) => {
      const cleaned = stripTool(prev, toolId)
      return {
        ...cleaned,
        zones: {
          ...cleaned.zones,
          [target]: [...cleaned.zones[target], toolId],
        },
        activeTab: { ...cleaned.activeTab, [target]: toolId },
        zoneVisible: { ...cleaned.zoneVisible, [target]: true },
        undocked: cleaned.undocked.filter((id) => id !== toolId),
      }
    })
    const api = window.electron as typeof window.electron & {
      closeToolWindow?: (toolId: string) => Promise<void>
    }
    void api?.closeToolWindow?.(toolId)
  }, [])

  const isUndocked = useCallback(
    (toolId: ToolId) => layout.undocked.includes(toolId),
    [layout.undocked],
  )

  const toolsInZone = useCallback(
    (zone: DockZone) => layout.zones[zone].filter((id) => !layout.undocked.includes(id)),
    [layout],
  )

  const resetLayout = useCallback(() => {
    setLayout(structuredClone(DEFAULT_WORKSPACE))
  }, [])

  const value = useMemo(
    () => ({
      layout,
      moveTool,
      setActiveTab,
      toggleZone,
      undockTool,
      dockTool,
      isUndocked,
      toolsInZone,
      resetLayout,
    }),
    [layout, moveTool, setActiveTab, toggleZone, undockTool, dockTool, isUndocked, toolsInZone, resetLayout],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}

export function getUndockToolIdFromUrl(): ToolId | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const hash = window.location.hash.replace(/^#/, '')
    const fromQuery = params.get('undock')
    const fromHash = hash.startsWith('undock/') ? hash.slice('undock/'.length) : null
    const id = (fromQuery || fromHash) as ToolId | null
    if (id && id in TOOL_CATALOG) return id
  } catch {
    /* ignore */
  }
  return null
}
