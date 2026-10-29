/**
 * Aviso de espacio reducido de un panel acoplado: si el visor de la herramienta queda por debajo de su
 * tamaño operativo (tras un breve margen, para no parpadear mientras se arrastra el divisor), muestra un
 * banner superpuesto con Flotar / Ocultar / Mantener y «Recordar preferencia». Se superpone (no ocupa
 * alto), así el aviso no reduce aún más el panel ni provoca cambios de modo en bucle.
 */
import { useEffect, useState, type RefObject } from 'react'
import { ExternalLink, EyeOff, X } from 'lucide-react'
import { useElementSize } from '@/hooks/use-element-size'
import { useWorkspaceOptional } from '@/src/workspace/workspace-context'
import { TOOL_CATALOG, type ToolId } from '@/src/workspace/types'
import {
  avisoSilenciado,
  espacioReducido,
  mensajeEspacio,
  silenciarAviso,
  umbralOperativo,
} from '@/src/workspace/space-guard'

/** Tiempo (ms) que el espacio debe seguir reducido antes de avisar. */
const ESPERA_MS = 700

export function PanelSpaceGuard({ toolId, viewportRef }: { toolId: ToolId; viewportRef: RefObject<HTMLElement | null> }) {
  const ws = useWorkspaceOptional()
  const size = useElementSize(viewportRef)
  const umbral = umbralOperativo(toolId)
  const reducido = espacioReducido(size, umbral)
  const [visible, setVisible] = useState(false)
  // «Mantener» vale hasta que el panel vuelva a tener espacio suficiente.
  const [mantenido, setMantenido] = useState(false)
  const [recordar, setRecordar] = useState(false)
  const [silenciado, setSilenciado] = useState(() => avisoSilenciado(toolId))

  useEffect(() => {
    if (!reducido) {
      setVisible(false)
      setMantenido(false)
      return
    }
    const t = setTimeout(() => setVisible(true), ESPERA_MS)
    return () => clearTimeout(t)
  }, [reducido])

  if (!ws || !umbral || silenciado || mantenido || !visible || !reducido || ws.isUndocked(toolId)) return null

  const titulo = TOOL_CATALOG[toolId]?.title ?? toolId
  const elegir = (accion: () => void) => {
    if (recordar) {
      silenciarAviso(toolId)
      setSilenciado(true)
    }
    accion()
  }

  return (
    <div
      role="status"
      data-testid={`aviso-espacio-${toolId}`}
      className="absolute inset-x-1 top-1 z-30 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-accent-amber/40 bg-panel/95 px-2 py-1 text-[10px] text-foreground shadow-lg backdrop-blur-sm"
    >
      <span className="min-w-0 flex-1 truncate" title={mensajeEspacio(titulo, size, umbral)}>
        {mensajeEspacio(titulo, size, umbral)}
      </span>
      <button
        type="button"
        onClick={() => elegir(() => void ws.undockTool(toolId))}
        className="flex items-center gap-1 rounded bg-accent-amber/20 px-1.5 py-0.5 font-semibold text-accent-amber hover:bg-accent-amber/30"
        title="Abrir en una ventana independiente"
      >
        <ExternalLink className="size-3" />
        Flotar
      </button>
      <button
        type="button"
        onClick={() => elegir(() => ws.closeTool(toolId))}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-panel-raised hover:text-foreground"
        title="Ocultar el panel (se vuelve a abrir desde Ventana)"
      >
        <EyeOff className="size-3" />
        Ocultar
      </button>
      <button
        type="button"
        onClick={() => elegir(() => setMantenido(true))}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-panel-raised hover:text-foreground"
        title="Seguir con el panel compacto"
      >
        <X className="size-3" />
        Mantener
      </button>
      <label className="flex items-center gap-1 text-muted-foreground" title="No volver a avisar en este panel (se reactiva con «Restablecer layout»)">
        <input
          type="checkbox"
          checked={recordar}
          onChange={(e) => setRecordar(e.target.checked)}
          className="size-3 accent-accent-amber"
        />
        Recordar preferencia
      </label>
    </div>
  )
}
