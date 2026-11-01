/**
 * Barra de plugins abiertos: una pestaña por ventana de editor (varios a la vez). Clic = traer al frente,
 * × = cerrar esa ventana. Aparece en la barra inferior del workspace solo si hay alguna abierta.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { AppWindow, X } from 'lucide-react'
import { useDAW, useDAWStateOptional } from '@/src/context/daw-context'
import {
  closeAllPluginWindows,
  closePluginWindow,
  getPluginWindows,
  subscribePluginWindows,
} from '@/src/lib/plugin/plugin-windows'
import { openPluginEditor, registrarLectorProyecto, registrarNotificadorEditor } from '@/src/lib/plugin/plugin-editor-store'
import { establecerProyectoPins } from '@/src/lib/pins/pins-cliente'
import { PinEditorButton } from '@/components/pin-button'
import { PinsJerarquia } from '@/components/pins-jerarquia'

export function PluginWindowsBar() {
  const tienda = useDAW()
  const windows = useSyncExternalStore(subscribePluginWindows, getPluginWindows, getPluginWindows)
  // Siempre montada: permite resolver plugin y pista cuando cualquier panel pide abrir un editor
  useEffect(() => {
    registrarLectorProyecto(() => tienda.obtenerEstado() as never)
    // Que «no abre» nunca sea mudo: el motivo llega como aviso (toast) al usuario.
    registrarNotificadorEditor((mensaje) => tienda.busEventos.emit('comando.fallido', { type: 'plugin.abrirEditor', error: mensaje, code: 'PLUGIN_EDITOR' }))
    // Gancho de pruebas (solo desarrollo): permite abrir editores desde un script sin pasar por los paneles
    if (import.meta.env.DEV) (window as unknown as { __jwOpenPluginEditor?: typeof openPluginEditor }).__jwOpenPluginEditor = openPluginEditor
    return () => {
      registrarLectorProyecto(null)
      registrarNotificadorEditor(null)
    }
  }, [tienda])
  // Pin: cada proyecto conserva su propia jerarquía de anclados
  const proyectoId = useDAWStateOptional((st) => st.project?.id ?? '', '')
  useEffect(() => {
    void establecerProyectoPins(proyectoId)
  }, [proyectoId])
  if (windows.length === 0) return <PinsJerarquia />
  return (
    <div className="flex min-w-0 items-center gap-1" data-testid="plugin-windows-bar">
      <AppWindow className="size-3 shrink-0 text-accent-amber" />
      <div className="jw-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
        {windows.map((w) => (
          <span
            key={w.slotId}
            className="group flex shrink-0 items-center gap-1 rounded bg-panel-raised px-1.5 py-0.5 text-[10px] text-foreground ring-1 ring-border"
          >
            <button
              type="button"
              className="max-w-[160px] truncate hover:text-accent-amber"
              title={`Traer al frente: ${w.name}${w.trackName ? ' · ' + w.trackName : ''}`}
              onClick={() => {
                const track = tienda.obtenerEstado().project?.tracks?.find((t) => t.id === w.trackId)
                const plugin = track?.plugins?.find((p) => p.id === w.pluginId)
                if (plugin) openPluginEditor({ trackId: w.trackId, pluginId: w.pluginId, pluginName: w.name, pluginSnapshot: plugin })
              }}
            >
              {w.name}
              {w.trackName ? <span className="text-muted-foreground"> · {w.trackName}</span> : null}
            </button>
            <PinEditorButton trackId={w.trackId} pluginId={w.pluginId} nombre={w.name} size="size-2.5" />
            <button
              type="button"
              aria-label={`Cerrar ${w.name}`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => void closePluginWindow(w.slotId, tienda)}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      {windows.length > 1 && (
        <button
          type="button"
          className="shrink-0 rounded px-1.5 text-[10px] text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          onClick={() => void closeAllPluginWindows(tienda)}
        >
          Cerrar todas
        </button>
      )}
      <PinsJerarquia />
    </div>
  )
}
