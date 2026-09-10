/**
 * Tablero arrangement: un solo scroll X+Y.
 * Cabeceras sticky a la izquierda — misma altura de fila que los clips.
 * Overlay de playhead unificado (regla + lanes) en coords de viewport.
 */

import type { ReactNode, RefObject, UIEventHandler } from 'react'
import { TrackCanvas } from './TrackCanvas'
import { HEADER_W } from './constants'

export function ArrangeBoard({
  tracksHeight,
  contentWidth,
  headerToolbar,
  ruler,
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
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Fila superior fija: acciones + regla */}
      <div className="flex shrink-0 border-b border-border bg-panel">
        <div
          className="flex shrink-0 items-center gap-2 border-r border-border px-3"
          style={{ width: HEADER_W, height: 40 }}
        >
          {headerToolbar}
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden" style={{ height: 40 }}>
          {ruler}
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

      {/* Una sola línea amarilla: misma X que regla y rejilla */}
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
