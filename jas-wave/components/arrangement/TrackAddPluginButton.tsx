/**
 * Abre el panel Instrumentos (tab del workspace / ventana undock) para la pista.
 * Sin dropdown flotante — evita quedar bajo otros paneles.
 */

import { Piano } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import { selectTrackPayload } from '@/src/lib/selection-helpers'
import { requestOpenTool } from '@/src/workspace/types'

export function TrackAddPluginButton({
  trackId,
  trackName,
}: {
  trackId: string
  trackName: string
}) {
  const tienda = useDAW()

  return (
    <button
      type="button"
      title={`Añadir instrumento a ${trackName} (abre panel Instrumentos)`}
      onClick={(e) => {
        e.stopPropagation()
        void tienda.executor.execute('selection.set', selectTrackPayload(trackId))
        // Tab en zona izquierda (o enfoca ventana si ya está en otro monitor)
        requestOpenTool('instruments', { zone: 'left' })
      }}
      className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-panel-raised hover:text-accent-amber"
    >
      <Piano className="size-3" />
    </button>
  )
}
