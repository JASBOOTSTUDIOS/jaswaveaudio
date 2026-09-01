/**
 * Banco de FX en el canal (estilo Reaper MCP/TCP): plugins apilados,
 * bypass, clic para abrir el editor, + para añadir.
 */

import { Plus } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import type { PluginInfo } from '../../shared/src/types/entidades'
import { openFxChain } from '@/src/lib/plugin/fx-chain-store'
import { openPluginEditor } from '@/src/lib/plugin/plugin-editor-store'
import { selectTrackPayload } from '@/src/lib/selection-helpers'
import { MASTER_FX_TRACK_ID } from '../../shared/src/commands/plugin-commands'

export function ChannelFxBank({
  trackId,
  trackName,
  plugins,
  compact = false,
}: {
  trackId: string
  trackName: string
  plugins: PluginInfo[]
  compact?: boolean
}) {
  const tienda = useDAW()
  const maxH = compact ? 'max-h-[80px]' : 'max-h-[160px]'

  const openChain = () => {
    if (trackId !== MASTER_FX_TRACK_ID) {
      void tienda.executor.execute('selection.set', selectTrackPayload(trackId))
    }
    openFxChain(trackId, 'right')
  }

  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden rounded border border-border/80 bg-background/40 ${maxH}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-0.5 border-b border-border/60 px-1 py-0.5">
        <button
          type="button"
          title={`Banco FX · ${trackName}`}
          onClick={openChain}
          className="min-w-0 flex-1 truncate text-left text-[8px] font-bold uppercase tracking-wide text-muted-foreground hover:text-accent-amber"
        >
          FX {plugins.length > 0 ? plugins.length : ''}
        </button>
        <button
          type="button"
          title="Añadir FX"
          onClick={openChain}
          className="flex size-3.5 items-center justify-center rounded text-muted-foreground hover:bg-panel-raised hover:text-accent-amber"
        >
          <Plus className="size-2.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {plugins.length === 0 ? (
          <button
            type="button"
            onClick={openChain}
            className="w-full px-1 py-1 text-left text-[8px] text-muted-foreground/80 hover:text-foreground"
          >
            vacío
          </button>
        ) : (
          plugins.map((p) => (
            <div
              key={p.id}
              className={`flex items-center gap-0.5 border-b border-border/40 px-0.5 py-px ${
                p.bypass ? 'opacity-45' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={!p.bypass}
                title={p.bypass ? 'Activar' : 'Bypass'}
                onChange={() => {
                  void tienda.executor.execute('plugin.bypass', {
                    trackId,
                    pluginInstanceId: p.id,
                    bypass: !p.bypass,
                  })
                }}
                className="size-2.5 shrink-0 accent-accent-amber"
              />
              <button
                type="button"
                title={p.nombre}
                onClick={() =>
                  openPluginEditor({
                    trackId,
                    pluginId: p.id,
                    pluginName: p.nombre,
                    zone: 'right',
                  })
                }
                className="min-w-0 flex-1 truncate text-left text-[9px] leading-4 text-foreground hover:text-accent-amber"
              >
                {p.nombre}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
