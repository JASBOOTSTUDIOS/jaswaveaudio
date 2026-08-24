/**
 * Lanes MVP de automatización vol/pan (pista seleccionada).
 */

import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'

export function AutomationLanesPanel() {
  const tienda = useDAW()
  const tracks = useDAWState((s: DAWState) => s.project?.tracks ?? [])
  const selectedId = useDAWState((s: DAWState) => getSelectedTrackId(s))
  const track = tracks.find((t) => t.id === selectedId)
  if (!track) {
    return (
      <div className="border-t border-border p-2 text-[10px] text-muted-foreground">
        Selecciona una pista para editar automatización.
      </div>
    )
  }
  const vol = track.automatizaciones?.find((a) => a.parametro === 'volumen')
  const pan = track.automatizaciones?.find((a) => a.parametro === 'paneo')

  const setRamp = (parametro: 'volumen' | 'paneo', from: number, to: number, endSec: number) => {
    void tienda.executor.execute('automation.setCurve', {
      trackId: track.id,
      parametro,
      puntos: [
        { tiempo: 0, valor: from },
        { tiempo: endSec, valor: to },
      ],
    })
  }

  return (
    <div className="border-t border-border p-2 text-[10px]">
      <p className="mb-1 font-medium text-foreground">Automatización · {track.nombre}</p>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className="rounded bg-panel-raised px-2 py-0.5 hover:bg-accent-amber/20"
          onClick={() => setRamp('volumen', 0.2, 0.9, 8)}
        >
          Vol fade-in 8s
        </button>
        <button
          type="button"
          className="rounded bg-panel-raised px-2 py-0.5 hover:bg-accent-amber/20"
          onClick={() => setRamp('volumen', 0.9, 0.1, 8)}
        >
          Vol fade-out 8s
        </button>
        <button
          type="button"
          className="rounded bg-panel-raised px-2 py-0.5 hover:bg-accent-amber/20"
          onClick={() => setRamp('paneo', -0.8, 0.8, 4)}
        >
          Pan L→R 4s
        </button>
        {(vol || pan) && (
          <button
            type="button"
            className="rounded px-2 py-0.5 text-muted-foreground hover:bg-panel-raised"
            onClick={() =>
              void tienda.executor.execute('automation.clear', { trackId: track.id })
            }
          >
            Limpiar
          </button>
        )}
      </div>
      <p className="mt-1 text-muted-foreground">
        Curvas: vol={vol?.puntos?.length ?? 0} pts · pan={pan?.puntos?.length ?? 0} pts
      </p>
    </div>
  )
}
