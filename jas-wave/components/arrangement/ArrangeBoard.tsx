/**
 * Tablero arrangement: un solo scroll X+Y.
 * Cabeceras sticky a la izquierda — misma altura de fila que los clips.
 * Overlay de playhead unificado (regla + carriles de cabecera + lanes) en coords de viewport.
 *
 * La cabecera es una pila de filas: la regla (HEADER_H) y, debajo, los carriles de marcadores, acordes y
 * letra (`headerRows`), cada uno con su etiqueta y botón de plegado en la columna de cabeceras.
 */

import type { ReactNode, RefObject, UIEventHandler } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { TrackCanvas } from './TrackCanvas'
import { HEADER_H, HEADER_W } from './constants'
import type { HeaderLaneRow } from './TimelineLyricChordLane'

/** Alto de una fila de carril plegada (solo la etiqueta). */
export const HEADER_ROW_COLLAPSED_H = 12

export function ArrangeBoard({
  tracksHeight,
  contentWidth,
  headerToolbar,
  ruler,
  headerRows = [],
  headers,
  lanes,
  playhead,
  scrollRef,
  extraRef,
  onScroll,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onWheel,
}: {
  tracksHeight: number
  contentWidth: number
  headerToolbar: ReactNode
  ruler: ReactNode
  /** Filas bajo la regla (marcadores, acordes, letra); alto total de la cabecera variable. */
  headerRows?: HeaderLaneRow[]
  headers: ReactNode
  lanes: ReactNode
  /** Playhead continuo encima de regla + carriles (coords viewport, left = HEADER_W). */
  playhead?: ReactNode
  scrollRef: RefObject<HTMLDivElement | null>
  extraRef?: RefObject<HTMLDivElement | null>
  onScroll?: UIEventHandler<HTMLDivElement>
  onPointerMove?: React.PointerEventHandler<HTMLDivElement>
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>
  onPointerLeave?: React.PointerEventHandler<HTMLDivElement>
  onWheel?: (e: WheelEvent) => void
}) {
  const altoFila = (r: HeaderLaneRow) => (r.collapsed ? HEADER_ROW_COLLAPSED_H : r.height)
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Cabecera fija apilada: acciones + regla, y debajo los carriles */}
      <div className="flex shrink-0 border-b border-border bg-panel" data-testid="arrange-cabecera">
        <div className="flex shrink-0 flex-col border-r border-border" style={{ width: HEADER_W }}>
          <div className="flex items-center gap-2 px-3" style={{ height: HEADER_H }}>
            {headerToolbar}
          </div>
          {headerRows.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-1 border-t border-border/60 px-2 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground"
              style={{ height: altoFila(r) }}
            >
              {r.onToggle ? (
                <button
                  type="button"
                  aria-label={`${r.collapsed ? 'Mostrar' : 'Plegar'} ${r.label}`}
                  aria-expanded={!r.collapsed}
                  data-testid={r.testId ? `${r.testId}-plegar` : undefined}
                  onClick={r.onToggle}
                  className="flex size-3.5 items-center justify-center rounded hover:bg-panel-raised hover:text-foreground"
                >
                  {r.collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                </button>
              ) : null}
              <span className="truncate">{r.label}</span>
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative min-w-0 overflow-hidden" style={{ height: HEADER_H }}>
            {ruler}
          </div>
          {headerRows.map((r) => (
            <div
              key={r.id}
              className="relative min-w-0 overflow-hidden border-t border-border/60"
              style={{ height: altoFila(r) }}
              data-testid={r.testId}
              data-plegado={r.collapsed ? 'true' : undefined}
            >
              {r.collapsed ? null : r.content}
            </div>
          ))}
        </div>
      </div>

      {/* Único scroller: cabeceras + carriles se mueven juntos en Y */}
      <TrackCanvas
        scrollRef={scrollRef}
        extraRef={extraRef}
        className="jw-scrollbar relative min-h-0 flex-1 overflow-auto"
        onScroll={onScroll}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onWheel={onWheel}
      >
        <div
          className="flex"
          style={{
            width: HEADER_W + contentWidth,
            minWidth: '100%',
            height: tracksHeight,
          }}
        >
          <div
            className="sticky left-0 z-30 shrink-0 border-r border-border bg-panel shadow-[6px_0_12px_rgba(0,0,0,0.45)]"
            style={{ width: HEADER_W, height: tracksHeight, isolation: 'isolate' }}
          >
            {headers}
          </div>
          <div className="relative z-0" style={{ width: contentWidth, height: tracksHeight, minWidth: contentWidth }}>
            {lanes}
          </div>
        </div>
      </TrackCanvas>

      {/* Una sola línea amarilla: misma X que regla, carriles y rejilla */}
      {playhead ? (
        <div
          className="pointer-events-none absolute bottom-0 top-0 z-40 overflow-hidden"
          style={{ left: HEADER_W, right: 0 }}
        >
          {playhead}
        </div>
      ) : null}
    </div>
  )
}

export const ARRANGE_HEADER_W = HEADER_W
