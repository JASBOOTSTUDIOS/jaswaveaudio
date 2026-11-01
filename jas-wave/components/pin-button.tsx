/**
 * Chincheta (pin): ancla un editor de plugin o un panel flotante para que quede SIEMPRE visible por encima de
 * la ventana principal y de lo no anclado. Entre anclados manda la jerarquía: nivel 1 (índice 0) = el de más arriba.
 */
import { useSyncExternalStore } from 'react'
import { Pin } from 'lucide-react'
import {
  alternarPin,
  clavePinEditor,
  clavePinPanel,
  getEstadoPins,
  indicePin,
  subscribePins,
} from '@/src/lib/pins/pins-cliente'
import { slotIdForTrackPlugin } from '@/src/lib/plugin/track-vst-runtime'
import { openPluginEditor } from '@/src/lib/plugin/plugin-editor-store'

function usePins() {
  return useSyncExternalStore(subscribePins, getEstadoPins, getEstadoPins)
}

function Chincheta({
  nivel,
  tituloBase,
  onClick,
  className = '',
  size = 'size-3',
}: {
  nivel: number
  tituloBase: string
  onClick: () => void
  className?: string
  size?: string
}) {
  const activo = nivel >= 0
  return (
    <button
      type="button"
      aria-pressed={activo}
      data-testid="pin-button"
      title={
        activo
          ? `Anclado (nivel ${nivel + 1}; 1 = el de más arriba): ${tituloBase}. Clic para soltar.`
          : `Anclar: ${tituloBase} queda siempre visible sobre la ventana principal`
      }
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`relative inline-flex shrink-0 items-center justify-center rounded p-0.5 ${
        activo ? 'text-accent-amber' : 'text-muted-foreground hover:text-foreground'
      } ${className}`}
    >
      <Pin className={`${size} ${activo ? 'fill-current' : ''}`} />
      {activo ? <span className="ml-0.5 text-[8px] font-bold leading-none tabular-nums">{nivel + 1}</span> : null}
    </button>
  )
}

/** Pin del editor nativo de un plugin de pista (cadena FX, instrumentos, detalle de pista). */
export function PinEditorButton({
  trackId,
  pluginId,
  nombre,
  className,
  size,
}: {
  trackId: string
  pluginId: string
  nombre: string
  className?: string
  size?: string
}) {
  const { lista } = usePins()
  const slotId = slotIdForTrackPlugin(trackId, pluginId)
  const nivel = indicePin(lista, clavePinEditor(slotId))
  return (
    <Chincheta
      nivel={nivel}
      tituloBase={nombre}
      className={className}
      size={size}
      onClick={() => {
        void alternarPin('editor', slotId, nombre).then(() => {
          // al anclar se muestra el editor (si no estaba abierto, anclarlo no tendría efecto visible)
          if (nivel < 0) openPluginEditor({ trackId, pluginId, pluginName: nombre })
        })
      }}
    />
  )
}

/** Pin de un panel flotante (ventana propia): se identifica por su toolId. */
export function PinPanelButton({ toolId, titulo, className }: { toolId: string; titulo: string; className?: string }) {
  const { lista } = usePins()
  const nivel = indicePin(lista, clavePinPanel(toolId))
  return (
    <Chincheta
      nivel={nivel}
      tituloBase={titulo}
      className={className}
      size="size-3.5"
      onClick={() => void alternarPin('panel', toolId, titulo)}
    />
  )
}
