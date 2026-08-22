import { useEffect, useRef } from 'react'

/** Canvas de lanes + clips. Wheel con `{ passive: false }` para zoom Ctrl+rueda. */
export function TrackCanvas({
  children,
  className = '',
  style,
  onScroll,
  scrollRef,
  extraRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onWheel,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  onScroll?: React.UIEventHandler<HTMLDivElement>
  scrollRef?: React.RefObject<HTMLDivElement | null>
  extraRef?: React.RefObject<HTMLDivElement | null>
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>
  onPointerMove?: React.PointerEventHandler<HTMLDivElement>
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>
  onPointerLeave?: React.PointerEventHandler<HTMLDivElement>
  /** Listener nativo (no React) — permite preventDefault en zoom. */
  onWheel?: (e: WheelEvent) => void
}) {
  const localRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = localRef.current
    if (!el || !onWheel) return
    const handler = (e: WheelEvent) => onWheel(e)
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [onWheel])

  return (
    <div
      ref={(el) => {
        localRef.current = el
        if (scrollRef) (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el
        if (extraRef) (extraRef as React.MutableRefObject<HTMLDivElement | null>).current = el
      }}
      className={className}
      style={style}
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>
  )
}
