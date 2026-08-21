import { useEffect, useRef, useState } from 'react'
import { LayoutGrid, PanelLeft, PanelRight, PanelBottom, Monitor, RotateCcw } from 'lucide-react'
import { useWorkspace } from '@/src/workspace/workspace-context'
import { TOOL_CATALOG, type DockZone, type ToolId } from '@/src/workspace/types'

const ZONES: { id: DockZone; label: string; icon: typeof PanelLeft }[] = [
  { id: 'left', label: 'Izquierda', icon: PanelLeft },
  { id: 'center', label: 'Centro', icon: LayoutGrid },
  { id: 'right', label: 'Derecha', icon: PanelRight },
  { id: 'bottom', label: 'Inferior', icon: PanelBottom },
]

export function WorkspaceMenu() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const { layout, dockTool, moveTool, undockTool, isUndocked, toolsInZone, toggleZone, resetLayout, setActiveTab } =
    useWorkspace()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const findZone = (toolId: ToolId): DockZone | 'undocked' | null => {
    if (isUndocked(toolId)) return 'undocked'
    for (const z of ['left', 'center', 'right', 'bottom'] as DockZone[]) {
      if (toolsInZone(z).includes(toolId)) return z
    }
    return null
  }

  const showTool = (toolId: ToolId) => {
    if (isUndocked(toolId)) {
      dockTool(toolId)
      setOpen(false)
      return
    }
    const zone = findZone(toolId)
    if (zone && zone !== 'undocked') {
      if (!layout.zoneVisible[zone] && zone !== 'center') toggleZone(zone)
      setActiveTab(zone, toolId)
      setOpen(false)
      return
    }
    moveTool(toolId, TOOL_CATALOG[toolId].defaultZone)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-panel-raised hover:text-foreground"
        title="Ventanas y paneles"
      >
        <LayoutGrid className="size-3.5" />
        Ventanas
        {layout.undocked.length > 0 && (
          <span className="rounded bg-accent-amber/20 px-1 text-[9px] text-accent-amber">
            {layout.undocked.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-[80] mb-1 w-72 rounded-lg border border-border bg-panel shadow-xl">
          <div className="border-b border-border px-3 py-2">
            <p className="text-[11px] font-semibold text-foreground">Herramientas</p>
            <p className="text-[10px] text-muted-foreground">
              Clic para mostrar · elige panel para acoplar
            </p>
          </div>

          <ul className="max-h-64 overflow-y-auto py-1">
            {(Object.keys(TOOL_CATALOG) as ToolId[]).map((toolId) => {
              const meta = TOOL_CATALOG[toolId]
              const where = findZone(toolId)
              return (
                <li key={toolId} className="flex items-center gap-1 px-2 py-1 hover:bg-panel-raised">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-[12px] text-foreground"
                    onClick={() => showTool(toolId)}
                  >
                    {meta.title}
                    <span className="ml-1.5 text-[10px] text-muted-foreground">
                      {where === 'undocked'
                        ? '· otra ventana'
                        : where
                          ? `· ${ZONES.find((z) => z.id === where)?.label}`
                          : '· fuera'}
                    </span>
                  </button>
                  {where === 'undocked' ? (
                    <button
                      type="button"
                      title="Volver al panel"
                      className="rounded px-1.5 py-0.5 text-[10px] text-accent-amber hover:bg-background"
                      onClick={() => {
                        dockTool(toolId)
                        setOpen(false)
                      }}
                    >
                      Acoplar
                    </button>
                  ) : (
                    <div className="flex items-center gap-0.5">
                      {ZONES.map(({ id, label, icon: Icon }) => (
                        <button
                          key={id}
                          type="button"
                          title={`Mover a ${label}`}
                          onClick={() => {
                            if (isUndocked(toolId)) dockTool(toolId, id)
                            else moveTool(toolId, id)
                            setOpen(false)
                          }}
                          className={`rounded p-1 ${
                            where === id ? 'bg-background text-accent-amber' : 'text-muted-foreground hover:bg-background hover:text-foreground'
                          }`}
                        >
                          <Icon className="size-3" />
                        </button>
                      ))}
                      <button
                        type="button"
                        title="Abrir en otra ventana"
                        onClick={() => {
                          void undockTool(toolId)
                          setOpen(false)
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                      >
                        <Monitor className="size-3" />
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="flex items-center gap-1 border-t border-border p-2">
            {ZONES.filter((z) => z.id !== 'center').map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  if (!layout.zoneVisible[id]) toggleZone(id)
                  setOpen(false)
                }}
                className={`flex flex-1 items-center justify-center gap-1 rounded py-1 text-[10px] ${
                  layout.zoneVisible[id]
                    ? 'bg-panel-raised text-foreground'
                    : 'text-muted-foreground hover:bg-panel-raised'
                }`}
              >
                <Icon className="size-3" />
                {label}
              </button>
            ))}
            <button
              type="button"
              title="Restablecer layout"
              onClick={() => {
                resetLayout()
                setOpen(false)
              }}
              className="rounded p-1.5 text-muted-foreground hover:bg-panel-raised hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
