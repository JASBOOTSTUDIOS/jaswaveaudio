export function TrackButton({
  children,
  active,
  activeClass = 'bg-accent-amber text-background',
  onClick,
  label,
}: {
  children: React.ReactNode
  active?: boolean
  activeClass?: string
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex size-5 items-center justify-center rounded text-[10px] font-bold transition-colors ${
        active
          ? activeClass
          : 'bg-panel-raised text-muted-foreground ring-1 ring-border hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
