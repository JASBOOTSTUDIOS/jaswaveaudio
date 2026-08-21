import { useCallback } from 'react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { guardarProyectoIO, cerrarProyectoIO } from '@/src/lib/project-io'
import { executeOrNotify } from '@/src/lib/execute-or-toast'

/**
 * Diálogo MVP: cerrar proyecto con cambios sin guardar.
 * Escucha ui.dialogoActivo === 'confirmar-cierre'.
 */
export function ProjectCloseDialog() {
  const tienda = useDAW()
  const dialogo = useDAWState((s) => s.ui?.dialogoActivo ?? null)
  const open = dialogo === 'confirmar-cierre'

  const cancel = useCallback(() => {
    void executeOrNotify(tienda, 'project.close', { cancelarDialogo: true })
  }, [tienda])

  const discard = useCallback(() => {
    void cerrarProyectoIO(tienda, { forzar: true })
  }, [tienda])

  const saveAndClose = useCallback(async () => {
    const saved = await guardarProyectoIO(tienda)
    if (saved.canceled) return
    if (!saved.success) {
      tienda.busEventos.emit('comando.fallido', {
        type: 'project.save',
        error: String(saved.error ?? 'No se pudo guardar'),
      })
      return
    }
    await cerrarProyectoIO(tienda, { forzar: true })
  }, [tienda])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={cancel} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-foreground">Cambios sin guardar</h2>
        <p className="mt-2 text-[13px] text-muted-foreground">
          El proyecto tiene cambios sin guardar. ¿Qué deseas hacer?
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={discard}
            className="rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground hover:bg-panel-raised"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={() => void saveAndClose()}
            className="rounded-md bg-accent-amber px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90"
          >
            Guardar y cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

/** Re-export por si se necesita ConfirmDialog genérico en el mismo sitio */
export { ConfirmDialog }
