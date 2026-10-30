import { useState } from 'react'
import { AlertCircle, Check, ChevronRight, Loader2, X } from 'lucide-react'
import { cn } from '@jaswave/host-sdk'
import { textoAcciones, type EstadoItem, type FilaActividad } from './actividad-agrupada'

function IconoEstado({ estado }: { estado: EstadoItem }) {
  if (estado === 'en_curso') return <Loader2 className="size-3 shrink-0 animate-spin text-accent-amber" aria-label="en curso" />
  if (estado === 'error') return <X className="size-3 shrink-0 text-destructive" aria-label="con error" />
  if (estado === 'aviso') return <AlertCircle className="size-3 shrink-0 text-amber-400" aria-label="aviso" />
  return <Check className="size-3 shrink-0 text-emerald-400" aria-label="hecho" />
}

/**
 * Una fila por agente: «Bajista · Revisando las notas MIDI · 12 acciones». El historial completo de ese
 * agente está en el detalle (cerrado por defecto, con altura limitada y desplazamiento). Los errores y
 * avisos quedan siempre a la vista debajo de la fila.
 */
export function FilasActividad({ filas, onElegir, className }: { filas: FilaActividad[]; onElegir?: (agente: string) => void; className?: string }) {
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({})
  if (!filas.length) return null
  return (
    <ul data-testid="actividad-por-agente" className={cn('space-y-1', className)}>
      {filas.map((f) => {
        const abierto = abiertos[f.agente] === true
        const nombre = f.nombre || 'Agente'
        return (
          <li key={f.agente || '_'} className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                aria-expanded={abierto}
                aria-label={`${abierto ? 'Ocultar' : 'Ver'} el detalle de ${nombre}`}
                onClick={() => setAbiertos((a) => ({ ...a, [f.agente]: !abierto }))}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className={cn('size-3 transition-transform duration-150', abierto && 'rotate-90')} />
              </button>
              <IconoEstado estado={f.estado} />
              {onElegir && f.agente ? (
                <button
                  type="button"
                  onClick={() => onElegir(f.agente)}
                  title={`Escribirle a ${nombre}`}
                  className="shrink-0 font-semibold hover:underline"
                  style={f.color ? { color: f.color } : undefined}
                >
                  {nombre}
                </button>
              ) : (
                <span className="shrink-0 font-semibold" style={f.color ? { color: f.color } : undefined}>
                  {nombre}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-foreground/90" title={f.texto}>
                · {f.texto}
              </span>
              <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{textoAcciones(f.total)}</span>
            </div>
            {f.alertas.length ? (
              <ul className="ml-7 mt-0.5 space-y-0.5">
                {f.alertas.slice(-3).map((a) => (
                  <li key={a.id} className={cn('break-words text-[10px]', a.estado === 'error' ? 'text-destructive' : 'text-amber-400')}>
                    {a.texto}
                  </li>
                ))}
              </ul>
            ) : null}
            {abierto ? (
              <ul className="ml-7 mt-0.5 max-h-40 space-y-0.5 overflow-y-auto overscroll-contain rounded border border-border/40 bg-panel-base/40 px-1.5 py-1 text-[10px] text-muted-foreground">
                {f.items.map((it) => (
                  <li key={it.id} className="break-words">
                    {it.texto}
                    {it.detalle ? <span className="block whitespace-pre-line pl-2 text-muted-foreground/70">{it.detalle}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
