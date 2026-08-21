import { useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'info'
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'danger',
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === 'Enter') { e.preventDefault(); onConfirm() }
    }
    window.addEventListener('keydown', handler)
    setTimeout(() => confirmRef.current?.focus(), 50)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, onConfirm])

  if (!open) return null

  const variantStyles = {
    danger: {
      icon: 'text-red-400',
      iconBg: 'bg-red-500/15',
      confirm: 'bg-red-600 hover:bg-red-500 text-white',
    },
    warning: {
      icon: 'text-amber-400',
      iconBg: 'bg-amber-500/15',
      confirm: 'bg-amber-600 hover:bg-amber-500 text-white',
    },
    info: {
      icon: 'text-accent-cyan',
      iconBg: 'bg-accent-cyan/15',
      confirm: 'bg-accent-cyan hover:brightness-110 text-background',
    },
  }

  const v = variantStyles[variant]

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5">
          <div className={`flex size-9 items-center justify-center rounded-full ${v.iconBg}`}>
            <AlertTriangle className={`size-5 ${v.icon}`} />
          </div>
          <div className="flex-1">
            <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Message */}
        <div className="px-5 pt-3 pb-0">
          <p className="text-[12px] leading-relaxed text-muted-foreground">{message}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-panel-raised px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition-all hover:brightness-110 ${v.confirm}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
