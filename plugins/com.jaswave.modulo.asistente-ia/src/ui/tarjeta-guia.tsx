/**
 * Tarjeta «Te estoy guiando: paso 2 de 5 — …» (U-maestra F6). Se alimenta del estado de la guía del host
 * (`suscribirGuia` / `obtenerEstadoGuia`) y solo ofrece Siguiente y Salir; no mueve nada del proyecto.
 * NO está montada en el árbol: F7 la coloca cerca del campo del chat (`<TarjetaGuia />`; sin guía activa no pinta nada).
 * Colores solo con tokens del tema (border-border, bg-panel-raised, text-foreground…).
 */
import { useSyncExternalStore } from 'react'
import { cn, descartarGuia, obtenerEstadoGuia, siguientePaso, suscribirGuia } from '@jaswave/host-sdk'
import type { EstadoGuia } from '@jaswave/host-sdk'

/** Línea de progreso accesible. Pura (testeable sin DOM). `null` si no hay guía. */
export function textoProgresoGuia(e: Pick<EstadoGuia, 'pasos' | 'paso' | 'terminada'>): string | null {
  if (e.paso < 0 || e.pasos.length === 0) return null
  const actual = e.pasos[Math.min(e.paso, e.pasos.length - 1)]
  if (e.terminada) return `Guía terminada: ${e.pasos.length} de ${e.pasos.length} pasos.`
  return `Te estoy guiando: paso ${e.paso + 1} de ${e.pasos.length} — ${actual?.texto ?? ''}`
}

/** ¿El paso avanza solo (clic, estado, panel abierto) o hace falta el botón? Para el texto de ayuda. */
export function pasoAvanzaSolo(e: Pick<EstadoGuia, 'pasos' | 'paso'>): boolean {
  const h = e.pasos[e.paso]?.hastaQue
  return !!h && !('manual' in h)
}

const BOTON =
  'rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground outline-none transition-colors hover:bg-panel-raised focus-visible:ring-2 focus-visible:ring-accent-amber/70'

export function TarjetaGuia({ className }: { className?: string }) {
  const e = useSyncExternalStore(suscribirGuia, obtenerEstadoGuia, obtenerEstadoGuia)
  const linea = textoProgresoGuia(e)
  if (!linea) return null
  const ultimo = e.paso >= e.pasos.length - 1
  return (
    <section
      role="region"
      aria-label="Guía paso a paso"
      className={cn('mt-2 space-y-2 rounded-md border border-accent-amber/40 bg-panel-raised/50 p-2.5', className)}
    >
      <p role="status" aria-live="polite" className="text-[12px] leading-snug text-foreground">
        {linea}
      </p>
      {!e.terminada && pasoAvanzaSolo(e) ? (
        <p className="text-[10px] text-muted-foreground">Avanza cuando lo hagas; también puedes pulsar Siguiente.</p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button type="button" className={BOTON} onClick={() => descartarGuia()} aria-label="Salir de la guía">
          {e.terminada ? 'Cerrar' : 'Salir'}
        </button>
        {!e.terminada ? (
          <button type="button" className={BOTON} onClick={() => siguientePaso()} aria-label={ultimo ? 'Terminar la guía' : 'Ir al siguiente paso'}>
            {ultimo ? 'Terminar' : 'Siguiente'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
