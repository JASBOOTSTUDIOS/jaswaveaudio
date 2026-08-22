/**
 * Tablero arrangement: un solo scroll X+Y.
 * Cabeceras sticky a la izquierda — misma altura de fila que los clips.
 */

import type { ReactNode, RefObject, UIEventHandler } from 'react'
import { TrackCanvas } from './TrackCanvas'

const HEADER_W = 300

export function ArrangeBoard({
  tracksHeight,
  contentWidth,
  headerToolbar,
  ruler,
  headers,
  lanes,
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
  scrollRef: RefObject<HTMLDivElement | null>
  extraRef?: RefObject<HTMLDivElement | null>
  onScroll?: UIEventHandler<HTMLDivElement>
  onPointerMove?: React.PointerEventHandler<HTMLDivElement>
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>
  onPointerLeave?: React.PointerEventHandler<HTMLDivElement>
  onWheel?: (e: WheelEvent) => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Fila superior fija: acciones + regla */}
      <div className="flex shrink-0 border-b border-border bg-panel">
        <div
          className="flex shrink-0 items-center gap-2 border-r border-border px-3"
          style={{ width: HEADER_W, height: 40 }}
        >
          {headerToolbar}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden" style={{ height: 40 }}>
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
            className="sticky left-0 z-30 shrink-0 border-r border-border bg-panel"
            style={{ width: HEADER_W, height: tracksHeight }}
          >
            {headers}
          </div>
          <div className="relative" style={{ width: contentWidth, height: tracksHeight, minWidth: contentWidth }}>
            {lanes}
          </div>
        </div>
      </TrackCanvas>
    </div>
  )
}

export const ARRANGE_HEADER_W = HEADER_W
