'use client'

import { useState, useEffect } from 'react'
import { Minus, Square, X, Save, FolderOpen, FilePlus, SaveAll } from 'lucide-react'
import { useDAWState, useEventBus } from '../src/context/daw-context'
import { useFileService } from '@/hooks/use-file-service'
import { JasWaveAppIcon } from '@/components/brand'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const projectName = useDAWState((s) => s.project?.nombre || 'Proyecto sin nombre')
  const changesCount = useDAWState((s) => s.estadisticasUso?.cambiosNoGuardados ?? 0)
  const { save, saveAs, openDialog, newProject } = useFileService()
  const [lastEvent, setLastEvent] = useState<string | null>(null)

  const showTemporaryEvent = (msg: string) => {
    setLastEvent(msg)
    setTimeout(() => setLastEvent(null), 2000)
  }

  // Listen to domain events via event bus — multi-event form
  useEventBus([
    { nombre: 'track.creada', manejador: () => showTemporaryEvent('Pista creada') },
    { nombre: 'proyecto.guardado', manejador: () => showTemporaryEvent('Proyecto guardado') },
    { nombre: 'transporte.iniciado', manejador: () => showTemporaryEvent('Reproduciendo') },
    { nombre: 'transporte.detenido', manejador: () => showTemporaryEvent('Detenido') },
    { nombre: 'grabacion.iniciada', manejador: () => showTemporaryEvent('Grabando') },
  ])

  useEffect(() => {
    let mounted = true

    if (window.electron?.windowIsMaximized) {
      window.electron.windowIsMaximized().then((maximized: boolean) => {
        if (mounted) setIsMaximized(maximized)
      })
    }

    if (window.electron?.onWindowMaximizedChanged) {
      const handler = (maximized: boolean) => {
        if (mounted) setIsMaximized(maximized)
      }
      window.electron.onWindowMaximizedChanged(handler)
    }

    return () => {
      mounted = false
    }
  }, [])

  const handleMinimize = () => window.electron?.windowMinimize()
  const handleMaximize = () => window.electron?.windowMaximize()
  const handleClose = () => window.electron?.windowClose()

  const hasUnsavedChanges = changesCount > 0

  return (
    <div
      className="flex h-11 w-full select-none items-center justify-between border-b border-border bg-panel"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      <div className="flex min-w-0 items-center gap-2.5 px-2">
        <JasWaveAppIcon className="h-10 w-10 shrink-0" />
        <span className="text-[13px] font-semibold text-foreground">JasWave</span>
        <span className="text-[10px] text-muted-foreground">—</span>
        <span className="max-w-[220px] truncate text-[11px] text-muted-foreground">
          {projectName}
        </span>
        {hasUnsavedChanges && (
          <span className="text-[10px] text-amber-400" title={`${changesCount} cambio(s) sin guardar`}>
            ●
          </span>
        )}
        {lastEvent && (
          <span className="ml-1 rounded bg-panel-raised px-1.5 py-0.5 text-[9px] text-accent-cyan animate-pulse">
            {lastEvent}
          </span>
        )}
      </div>

      <div
        className="flex h-full items-center gap-0.5"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        <button
          type="button"
          onClick={() => { void newProject() }}
          title="Nuevo proyecto"
          className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-panel-raised hover:text-foreground"
        >
          <FilePlus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => { void openDialog() }}
          title="Abrir proyecto"
          className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-panel-raised hover:text-foreground"
        >
          <FolderOpen className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => { void save() }}
          title="Guardar (Ctrl+S)"
          className={`flex size-8 items-center justify-center transition-colors hover:bg-panel-raised ${
            hasUnsavedChanges ? 'text-amber-400 hover:text-amber-300' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Save className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => { void saveAs() }}
          title="Guardar como"
          className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-panel-raised hover:text-foreground"
        >
          <SaveAll className="size-3.5" />
        </button>
      </div>

      <div className="flex h-full">
        <button
          type="button"
          onClick={handleMinimize}
          aria-label="Minimizar"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          className="flex size-12 items-center justify-center text-muted-foreground transition-colors hover:bg-panel-raised hover:text-foreground"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          aria-label={isMaximized ? 'Restaurar' : 'Maximizar'}
          style={{ WebkitAppRegion: 'no-drag' } as any}
          className="flex size-12 items-center justify-center text-muted-foreground transition-colors hover:bg-panel-raised hover:text-foreground"
        >
          <Square className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Cerrar"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          className="flex size-12 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-background"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
