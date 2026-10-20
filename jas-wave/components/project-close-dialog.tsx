import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { guardarProyectoIO, cerrarProyectoIO } from '@/src/lib/project-io'
import { executeOrNotify } from '@/src/lib/execute-or-toast'
import {
  obtenerSolicitudConfirmacion,
  responderSolicitudConfirmacion,
  suscribirSolicitudConfirmacion,
  type MotivoConfirmacion,
} from '@/src/lib/project-guards'

const TEXTO_MOTIVO: Record<MotivoConfirmacion, string> = {
  nuevo: 'Vas a crear un proyecto nuevo y el actual tiene cambios sin guardar.',
  abrir: 'Vas a abrir otro proyecto y el actual tiene cambios sin guardar.',
  cerrar: 'Vas a cerrar el proyecto y tiene cambios sin guardar.',
  'cerrar-app': 'Vas a salir de JasWave y el proyecto tiene cambios sin guardar.',
}

/**
 * Diálogo "Cambios sin guardar": Guardar / No guardar / Cancelar.
 * Responde a las solicitudes de `confirmarDescartarCambios` (nuevo, abrir, cerrar, salir, IA) y,
 * por compatibilidad, a `ui.dialogoActivo === 'confirmar-cierre'` (comando project.close directo).
 */
export function ProjectCloseDialog() {
  const tienda = useDAW()
  const solicitud = useSyncExternalStore(suscribirSolicitudConfirmacion, obtenerSolicitudConfirmacion)
  const dialogoLegacy = useDAWState((s) => s.ui?.dialogoActivo ?? null) === 'confirmar-cierre'
  const open = !!solicitud || dialogoLegacy
  const saveBtnRef = useRef<HTMLButtonElement>(null)

  const limpiarLegacy = useCallback(() => {
    if (tienda.obtenerEstado().ui?.dialogoActivo === 'confirmar-cierre') {
      void executeOrNotify(tienda, 'project.close', { cancelarDialogo: true })
    }
  }, [tienda])

  const cancel = useCallback(() => {
    if (obtenerSolicitudConfirmacion()) {
      responderSolicitudConfirmacion('cancelar')
      limpiarLegacy()
      return
    }
    limpiarLegacy()
  }, [limpiarLegacy])

  const discard = useCallback(() => {
    if (obtenerSolicitudConfirmacion()) {
      limpiarLegacy()
      responderSolicitudConfirmacion('descartar')
      return
    }
    void cerrarProyectoIO(tienda, { forzar: true })
  }, [tienda, limpiarLegacy])

  const save = useCallback(async () => {
    if (obtenerSolicitudConfirmacion()) {
      // El guardado lo hace quien preguntó (confirmarDescartarCambios) para poder abortar si falla.
      limpiarLegacy()
      responderSolicitudConfirmacion('guardar')
      return
    }
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
  }, [tienda, limpiarLegacy])

  useEffect(() => {
    if (!open) return
    saveBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, cancel])

  if (!open) return null

  const mensaje = solicitud
    ? TEXTO_MOTIVO[solicitud.motivo]
    : 'El proyecto tiene cambios sin guardar. ¿Qué deseas hacer?'
  const etiquetaGuardar = solicitud ? 'Guardar' : 'Guardar y cerrar'

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center" data-testid="unsaved-changes-dialog">
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={cancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-2xl"
      >
        <h2 id="unsaved-changes-title" className="text-sm font-semibold text-foreground">
          Cambios sin guardar
        </h2>
        <p className="mt-2 text-[13px] text-muted-foreground">{mensaje}</p>
        {solicitud?.origen === 'ia' ? (
          <p className="mt-1 text-[12px] text-muted-foreground">Lo ha pedido el asistente de IA.</p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            data-testid="unsaved-cancel"
            onClick={cancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid="unsaved-discard"
            onClick={discard}
            className="rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground hover:bg-panel-raised"
          >
            No guardar
          </button>
          <button
            ref={saveBtnRef}
            type="button"
            data-testid="unsaved-save"
            onClick={() => void save()}
            className="rounded-md bg-accent-amber px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90"
          >
            {etiquetaGuardar}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Re-export por si se necesita ConfirmDialog genérico en el mismo sitio */
export { ConfirmDialog }
