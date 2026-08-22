import { useCallback, useEffect, useRef } from 'react'
import { createProjection } from '@/lib/timeline-projection'
import { ARRANGE_MAX_ZOOM, ARRANGE_MIN_ZOOM } from '@/components/arrangement/constants'

type TiendaLike = {
  establecerEstado: (fn: (s: any) => any) => void
}

/**
 * Zoom cursor-centric + sync scroll headers ↔ canvas (fase F).
 */
export function useArrangementViewport(opts: {
  tienda: TiendaLike
  zoom: number
  scrollLeft: number
  pixelsPerBeat: number
  bpm: number
  lanesScrollRef: React.RefObject<HTMLDivElement | null>
  rulerScrollRef: React.RefObject<HTMLDivElement | null>
  headersScrollRef: React.RefObject<HTMLDivElement | null>
}) {
  const {
    tienda,
    zoom,
    scrollLeft,
    pixelsPerBeat,
    bpm,
    lanesScrollRef,
    rulerScrollRef,
    headersScrollRef,
  } = opts
  const syncingScroll = useRef(false)
  const lastPointerXRef = useRef<number | null>(null)

  const applyZoomAtCursor = useCallback(
    (direction: 'in' | 'out', cursorViewportX: number) => {
      const lanes = lanesScrollRef.current
      if (!lanes) return
      const liveScroll = lanes.scrollLeft
      const liveProjection = createProjection({
        pixelsPerBeat,
        viewportWidth: lanes.clientWidth,
        scrollX: liveScroll,
        bpm,
      })
      const result = liveProjection.zoomAt(
        zoom,
        cursorViewportX,
        direction,
        ARRANGE_MIN_ZOOM,
        ARRANGE_MAX_ZOOM,
      )
      if (Math.abs(result.zoom - zoom) < 1e-6) return
      tienda.establecerEstado((s: any) => ({
        ...s,
        ui: { ...s.ui, zoomHorizontal: result.zoom, scrollX: result.scrollAdjust },
      }))
      lanes.scrollLeft = result.scrollAdjust
      if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = result.scrollAdjust
    },
    [pixelsPerBeat, zoom, tienda, bpm, lanesScrollRef, rulerScrollRef],
  )

  const setZoomAbsolute = useCallback(
    (z: number) => {
      if (Math.abs(z - zoom) < 1e-9) return
      const lanes = lanesScrollRef.current
      if (!lanes) return
      const liveScroll = lanes.scrollLeft
      const ratio = z / zoom
      const anchor = lastPointerXRef.current ?? lanes.clientWidth / 2
      const contentX = liveScroll + anchor
      const newScroll = Math.max(0, contentX * ratio - anchor)
      tienda.establecerEstado((s: any) => ({
        ...s,
        ui: { ...s.ui, zoomHorizontal: z, scrollX: newScroll },
      }))
      lanes.scrollLeft = newScroll
      if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = newScroll
    },
    [pixelsPerBeat, zoom, tienda, lanesScrollRef, rulerScrollRef],
  )

  // Restaurar scrollX del estado
  useEffect(() => {
    const lanes = lanesScrollRef.current
    if (!lanes) return
    if (Math.abs(lanes.scrollLeft - scrollLeft) < 1) return
    syncingScroll.current = true
    lanes.scrollLeft = scrollLeft
    if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = scrollLeft
    requestAnimationFrame(() => {
      syncingScroll.current = false
    })
  }, [scrollLeft, lanesScrollRef, rulerScrollRef])

  const onLanesScroll = useCallback(() => {
    if (syncingScroll.current) return
    const lanes = lanesScrollRef.current
    if (!lanes) return
    syncingScroll.current = true
    if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = lanes.scrollLeft
    if (headersScrollRef.current) {
      headersScrollRef.current.scrollTop = lanes.scrollTop
    }
    tienda.establecerEstado((s: any) => ({ ...s, ui: { ...s.ui, scrollX: lanes.scrollLeft } }))
    requestAnimationFrame(() => {
      syncingScroll.current = false
    })
  }, [tienda, lanesScrollRef, rulerScrollRef, headersScrollRef])

  const onRulerScroll = useCallback(() => {
    if (syncingScroll.current) return
    const ruler = rulerScrollRef.current
    if (!ruler || !lanesScrollRef.current) return
    syncingScroll.current = true
    lanesScrollRef.current.scrollLeft = ruler.scrollLeft
    tienda.establecerEstado((s: any) => ({ ...s, ui: { ...s.ui, scrollX: ruler.scrollLeft } }))
    requestAnimationFrame(() => {
      syncingScroll.current = false
    })
  }, [tienda, lanesScrollRef, rulerScrollRef])

  const onHeadersScroll = useCallback(() => {
    if (syncingScroll.current) return
    const headers = headersScrollRef.current
    const lanes = lanesScrollRef.current
    if (!headers || !lanes) return
    syncingScroll.current = true
    lanes.scrollTop = headers.scrollTop
    requestAnimationFrame(() => {
      syncingScroll.current = false
    })
  }, [headersScrollRef, lanesScrollRef])

  return {
    lastPointerXRef,
    applyZoomAtCursor,
    setZoomAbsolute,
    onLanesScroll,
    onRulerScroll,
    onHeadersScroll,
  }
}
