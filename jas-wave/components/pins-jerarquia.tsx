/**
 * Jerarquía de anclados: lista ordenada de arriba abajo (nivel 1 = índice 0 = el que queda por encima de todos).
 * Subir/bajar reordena; la chincheta de cada fila lo suelta. Se muestra solo si hay algo anclado.
 */
import { useState, useSyncExternalStore } from 'react'
import { ArrowDown, ArrowUp, Layers, Pin, X } from 'lucide-react'
import { getEstadoPins, moverPin, quitarPin, subscribePins } from '@/src/lib/pins/pins-cliente'

export function PinsJerarquia() {
  const { lista } = useSyncExternalStore(subscribePins, getEstadoPins, getEstadoPins)
  const [abierto, setAbierto] = useState(false)
  if (lista.length === 0) return null
  return (
    <div className="relative shrink-0" data-testid="pins-jerarquia">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        title="Jerarquía de anclados (nivel 1 = el que queda por encima de todos)"
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-accent-amber hover:bg-panel-raised"
      >
        <Layers className="size-3" />
        {lista.length}
      </button>
      {abierto ? (
        <div className="absolute bottom-full right-0 z-50 mb-1 w-64 rounded-md border border-border bg-panel p-1.5 shadow-lg">
          <div className="mb-1 px-1 text-[10px] text-muted-foreground">
            Anclados, de arriba abajo. Nivel 1 queda por encima de todos; los no anclados quedan debajo.
          </div>
          <ul className="flex flex-col gap-0.5">
            {lista.map((p, i) => (
              <li key={p.clave} className="flex items-center gap-1 rounded bg-panel-raised px-1.5 py-1 text-[11px]">
                <span className="w-4 shrink-0 text-center font-bold tabular-nums text-accent-amber">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate" title={p.etiqueta}>
                  {p.tipo === 'panel' ? 'Panel · ' : ''}
                  {p.etiqueta}
                </span>
                <button
                  type="button"
                  aria-label="Subir nivel"
                  disabled={i === 0}
                  onClick={() => void moverPin(p.clave, -1)}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUp className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="Bajar nivel"
                  disabled={i === lista.length - 1}
                  onClick={() => void moverPin(p.clave, 1)}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDown className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="Soltar pin"
                  title="Soltar pin"
                  onClick={() => void quitarPin(p.clave)}
                  className="rounded p-0.5 text-accent-amber hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex items-center gap-1 px-1 text-[9px] text-muted-foreground">
            <Pin className="size-2.5" /> Se ocultan con la app minimizada y vuelven al restaurarla.
          </div>
        </div>
      ) : null}
    </div>
  )
}
