import { PanelRightOpen, X, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '@/src/workspace/workspace-context'
import { TOOL_CATALOG, type DockZone, type ToolId } from '@/src/workspace/types'
import { ToolHost } from './tool-host'
import { JasWaveLogo } from '@/components/brand'

const ZONE_DROP = 'application/x-jaswave-tool'

function AddToolButton({ zone }: { zone: DockZone }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { moveTool, dockTool, isUndocked, toolsInZone } = useWorkspace()
  const present = new Set([
    ...toolsInZone('left'),
    ...toolsInZone('center'),
    ...toolsInZone('right'),
    ...toolsInZone('bottom'),
  ])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Añadir herramienta a este panel"
        onClick={() => setOpen((v) => !v)}
        className="rounded p-1 text-muted-foreground hover:bg-panel hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-[70] mt-1 w-48 rounded-md border border-border bg-panel py-1 shadow-xl">
          {(Object.keys(TOOL_CATALOG) as ToolId[]).map((toolId) => {
            const alreadyHere = toolsInZone(zone).includes(toolId)
            const elsewhere = present.has(toolId)
            const floating = isUndocked(toolId)
            return (
              <button
                key={toolId}
                type="button"
                disabled={alreadyHere}
                onClick={() => {
                  if (floating) dockTool(toolId, zone)
                  else moveTool(toolId, zone)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground hover:bg-panel-raised disabled:opacity-40"
              >
                {toolId === 'coproducer' && <JasWaveLogo className="size-4 shrink-0" alt="" />}
                <span className="min-w-0 flex-1 truncate">{TOOL_CATALOG[toolId].title}</span>
                <span className="text-[9px] text-muted-foreground">
                  {alreadyHere ? 'aquí' : floating ? 'ventana' : elsewhere ? 'mover' : 'añadir'}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function DockZonePanel({
  zone,
  className = '',
}: {
  zone: DockZone
  className?: string
}) {
  const { layout, toolsInZone, setActiveTab, moveTool, undockTool, toggleZone } = useWorkspace()
  const tools = toolsInZone(zone)
  const active = layout.activeTab[zone]
  const visibleTool = active && tools.includes(active) ? active : tools[0] ?? null

  if (!layout.zoneVisible[zone] && zone !== 'center') {
    return null
  }

  if (tools.length === 0) {
    return (
      <div
        className={`flex h-full min-h-[48px] flex-col bg-panel ${className}`}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          e.preventDefault()
          const id = e.dataTransfer.getData(ZONE_DROP) as ToolId
          if (id && id in TOOL_CATALOG) moveTool(id, zone)
        }}
      >
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-panel-raised/40 px-1">
          <span className="px-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            Panel {zone === 'left' ? 'izquierdo' : zone === 'right' ? 'derecho' : zone === 'bottom' ? 'inferior' : 'central'}
          </span>
          <div className="flex items-center">
            <AddToolButton zone={zone} />
            {zone !== 'center' && (
              <button
                type="button"
                title="Ocultar panel"
                onClick={() => toggleZone(zone)}
                className="rounded p-1 text-muted-foreground hover:bg-panel hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="m-2 flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/50 text-center">
          <p className="text-[11px] text-muted-foreground">Panel vacío</p>
          <p className="px-3 text-[10px] text-muted-foreground/80">
            Usa + o el menú Ventanas (barra inferior) para añadir herramientas
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`flex h-full min-h-0 flex-col bg-panel ${className}`}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        e.preventDefault()
        const id = e.dataTransfer.getData(ZONE_DROP) as ToolId
        if (id && id in TOOL_CATALOG) moveTool(id, zone)
      }}
    >
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border bg-panel-raised/40 px-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {tools.map((toolId) => {
            const meta = TOOL_CATALOG[toolId]
            const isActive = visibleTool === toolId
            return (
              <button
                key={toolId}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(ZONE_DROP, toolId)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onClick={() => setActiveTab(zone, toolId)}
                className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'bg-background text-foreground'
                    : 'text-muted-foreground hover:bg-panel hover:text-foreground'
                }`}
                title={`Arrastra para mover · ${meta.description}`}
              >
                {toolId === 'coproducer' && <JasWaveLogo className="size-4 shrink-0" alt="" />}
                {meta.title}
              </button>
            )
          })}
        </div>
        <AddToolButton zone={zone} />
        {visibleTool && (
          <button
            type="button"
            title="Abrir en otra ventana / monitor"
            onClick={() => void undockTool(visibleTool)}
            className="rounded p-1 text-muted-foreground hover:bg-panel hover:text-foreground"
          >
            <PanelRightOpen className="size-3.5" />
          </button>
        )}
        {zone !== 'center' && (
          <button
            type="button"
            title="Ocultar panel"
            onClick={() => toggleZone(zone)}
            className="rounded p-1 text-muted-foreground hover:bg-panel hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {visibleTool ? <ToolHost toolId={visibleTool} /> : null}
      </div>
    </div>
  )
}
