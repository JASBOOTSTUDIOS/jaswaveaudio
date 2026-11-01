import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useDAW } from '@/src/context/daw-context'
import {
  obtenerSolicitudMediaFaltante,
  responderSolicitudMediaFaltante,
  suscribirSolicitudMediaFaltante,
} from '@/src/lib/media-faltante'
import { reenlazarMediaFaltante } from '@/src/lib/project-media-flow'

/**
 * Diálogo "Media faltante": avisa de los archivos de audio que no están en la
 * carpeta del proyecto y permite localizarlos en otra carpeta.
 */
export function MediaFaltanteDialog() {
  const tienda = useDAW()
  const solicitud = useSyncExternalStore(
    suscribirSolicitudMediaFaltante,
    obtenerSolicitudMediaFaltante,
  )
  const buscarRef = useRef<HTMLButtonElement>(null)
  const [buscando, setBuscando] = useState(false)
  const open = !!solicitud

  const ignorar = useCallback(() => {
    responderSolicitudMediaFaltante('ignorar')
  }, [])

  const buscar = useCallback(async () => {
    if (!solicitud) return
    const dialogo = await window.electron?.dialogOpenDirectory?.()
    if (!dialogo || dialogo.canceled || !dialogo.filePaths?.length) {
      responderSolicitudMediaFaltante('ignorar')
      return
    }
    setBuscando(true)
    try {
      await reenlazarMediaFaltante(tienda, {
        carpeta: dialogo.filePaths[0]!,
        faltantes: solicitud.referencias.map((r) => ({ id: r.id, rutaRelativa: r.rutaRelativa })),
        rutaProyecto: solicitud.rutaProyecto,
      })
    } catch {
      /* best-effort: el aviso ya está en pantalla */
    } finally {
      setBuscando(false)
      responderSolicitudMediaFaltante('ignorar')
    }
  }, [solicitud, tienda])

  useEffect(() => {
    if (!open) return
    buscarRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      ignorar()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, ignorar])

  if (!open || !solicitud) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center" data-testid="media-faltante-dialog">
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="media-faltante-title"
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-2xl"
      >
        <h2 id="media-faltante-title" className="text-sm font-semibold text-foreground">
          Media faltante
        </h2>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Faltan {solicitud.referencias.length} archivo(s) de audio en la carpeta del proyecto. El audio
          podría estar en otra carpeta o en otro disco.
        </p>
        <ul className="mt-3 max-h-40 space-y-1 overflow-auto rounded-md border border-border bg-panel-raised p-2 text-[12px] text-muted-foreground">
          {solicitud.referencias.map((r) => (
            <li key={r.id} className="truncate" title={r.rutaRelativa}>
              {r.rutaRelativa}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            data-testid="media-faltante-ignorar"
            onClick={ignorar}
            className="rounded-md px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          >
            Ignorar
          </button>
          <button
            ref={buscarRef}
            type="button"
            data-testid="media-faltante-buscar"
            disabled={buscando}
            onClick={() => void buscar()}
            className="rounded-md bg-accent-amber px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90 disabled:opacity-60"
          >
            {buscando ? 'Buscando…' : 'Buscar en carpeta…'}
          </button>
        </div>
      </div>
    </div>
  )
}
