/** Panel fijo de cabeceras de pista (fase C). */
export function TrackHeaderPanel({
  children,
  className = '',
  style,
  onScroll,
  onWheel,
  scrollRef,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  onScroll?: React.UIEventHandler<HTMLDivElement>
  onWheel?: React.WheelEventHandler<HTMLDivElement>
  scrollRef?: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={scrollRef}
      className={className}
      style={style}
      onScroll={onScroll}
      onWheel={onWheel}
    >
      {children}
    </div>
  )
}
