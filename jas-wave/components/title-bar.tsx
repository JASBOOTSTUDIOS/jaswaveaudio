'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FilePlus, FolderOpen, MoreHorizontal, Save, SaveAll } from 'lucide-react'
import { useDAWState, useEventBus } from '../src/context/daw-context'
import { useFileService } from '@/hooks/use-file-service'
import { JasWaveAppIcon } from '@/components/brand'
import { WindowTitleBar, noDrag } from '@/components/window-title-bar'
import { planBarraTitulo } from '@/src/lib/window-chrome'

type Accion = { id: string; titulo: string; icono: typeof Save; destacada?: boolean; ejecutar: () => void }

/** Barra de título de la ventana principal. Los botones de ventana los pone WindowTitleBar (nunca se recortan). */
export function TitleBar() {
  const projectName = useDAWState((s) => s.project?.nombre || 'Proyecto sin nombre')
  const changesCount = useDAWState((s) => s.estadisticasUso?.cambiosNoGuardados ?? 0)
  const { save, saveAs, openDialog } = useFileService()
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [anchoLibre, setAnchoLibre] = useState(0)
  const [menuAbierto, setMenuAbierto] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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
    void window.electron?.getAppVersion?.()
      .then((v: string) => {
        if (mounted && v) setAppVersion(v)
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!menuAbierto) return
    const fuera = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuAbierto(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuAbierto(false)
    }
    window.addEventListener('mousedown', fuera)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', fuera)
      window.removeEventListener('keydown', esc)
    }
  }, [menuAbierto])

  const onAnchoLibre = useCallback((px: number) => setAnchoLibre(px), [])
  const { mostrarVersion, accionesEnMenu } = planBarraTitulo(anchoLibre)
  const hasUnsavedChanges = changesCount > 0

  const acciones: Accion[] = [
    { id: 'nuevo', titulo: 'Nuevo proyecto', icono: FilePlus, ejecutar: () => window.dispatchEvent(new CustomEvent('jaswave-nuevo-proyecto')) },
    { id: 'abrir', titulo: 'Abrir proyecto', icono: FolderOpen, ejecutar: () => void openDialog() },
    { id: 'guardar', titulo: 'Guardar (Ctrl+S)', icono: Save, destacada: hasUnsavedChanges, ejecutar: () => void save() },
    { id: 'guardarComo', titulo: 'Guardar como', icono: SaveAll, ejecutar: () => void saveAs() },
  ]

  return (
    <WindowTitleBar onAnchoLibre={onAnchoLibre}>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 px-2">
        <JasWaveAppIcon className="size-[40px] shrink-0" />
        <span className="shrink-0 text-[13px] font-semibold text-foreground" title={appVersion ? `JasWave v${appVersion}` : undefined}>
          JasWave
        </span>
        {appVersion && mostrarVersion && <span className="shrink-0 text-[10px] text-muted-foreground/70">v{appVersion}</span>}
        <span className="shrink-0 text-[10px] text-muted-foreground">—</span>
        <span className="min-w-0 max-w-[220px] truncate text-[11px] text-muted-foreground" title={projectName}>
          {projectName}
        </span>
        {hasUnsavedChanges && (
          <span className="shrink-0 text-[10px] text-amber-400" title={`${changesCount} cambio(s) sin guardar`}>
            ●
          </span>
        )}
        {lastEvent && (
          <span className="ml-1 min-w-0 truncate rounded bg-panel-raised px-1.5 py-0.5 text-[9px] text-accent-cyan animate-pulse">
            {lastEvent}
          </span>
        )}
      </div>

      {accionesEnMenu ? (
        <div ref={menuRef} className="relative flex h-full shrink-0 items-center pr-1" style={noDrag}>
          <button
            type="button"
            aria-label="Más acciones"
            aria-haspopup="menu"
            aria-expanded={menuAbierto}
            title="Más acciones"
            onClick={() => setMenuAbierto((v) => !v)}
            className={`flex size-[32px] items-center justify-center transition-colors hover:bg-panel-raised ${
              hasUnsavedChanges ? 'text-amber-400' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <MoreHorizontal className="size-[14px]" />
          </button>
          {menuAbierto && (
            <div role="menu" className="absolute right-0 top-full z-[95] mt-0.5 min-w-[190px] rounded-md border border-border bg-panel py-1 shadow-xl">
              {acciones.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuAbierto(false)
                    a.ejecutar()
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-panel-raised ${a.destacada ? 'text-amber-400' : 'text-foreground'}`}
                >
                  <a.icono className="size-[14px]" />
                  {a.titulo}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-full shrink-0 items-center gap-0.5 pr-1" style={noDrag}>
          {acciones.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={a.ejecutar}
              title={a.titulo}
              aria-label={a.titulo}
              className={`flex size-[32px] items-center justify-center transition-colors hover:bg-panel-raised ${
                a.destacada ? 'text-amber-400 hover:text-amber-300' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <a.icono className="size-[14px]" />
            </button>
          ))}
        </div>
      )}
    </WindowTitleBar>
  )
}
