import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import {
  mensajeConflictoDisco,
  obtenerConflictoPendiente,
  responderConflicto,
  suscribirConflicto,
} from '@/src/lib/save-conflict'

/**
 * Diálogo "El archivo cambió en disco": Sobrescribir / Guardar como / Cancelar.
 * Responde a la solicitud de `detectarConflictoProyecto` (U7).
 */
export function SaveConflictDialog() {
  const conflicto = useSyncExternalStore(suscribirConflicto, obtenerConflictoPendiente)
  const cancelarRef = useRef<HTMLButtonElement>(null)

  const elegir = useCallback((eleccion: 'sobrescribir' | 'guardar-como' | 'cancelar') => {
    responderConflicto(eleccion)
  }, [])

  useEffect(() => {
    if (!conflicto) return
    cancelarRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      elegir('cancelar')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [conflicto, elegir])

  if (!conflicto) return null

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center" data-testid="save-conflict-dialog">
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="save-conflict-title"
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-2xl"
      >
        <h2 id="save-conflict-title" className="text-sm font-semibold text-foreground">
          El archivo cambió en disco
        </h2>
        <p className="mt-2 break-all text-[13px] text-muted-foreground">{mensajeConflictoDisco(conflicto)}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Si guardas encima, se pierde la versión que hay ahora en el disco.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelarRef}
            type="button"
            data-testid="save-conflict-cancel"
            onClick={() => elegir('cancelar')}
            className="rounded-md px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid="save-conflict-save-as"
            onClick={() => elegir('guardar-como')}
            className="rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground hover:bg-panel-raised"
          >
            Guardar como
          </button>
          <button
            type="button"
            data-testid="save-conflict-overwrite"
            onClick={() => elegir('sobrescribir')}
            className="rounded-md bg-accent-amber px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90"
          >
            Sobrescribir
          </button>
        </div>
      </div>
    </div>
  )
}
