import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, Circle, Loader2, Users, X } from 'lucide-react'
import { cn } from '@jaswave/host-sdk'

import type { ProgresoAgente } from '../motor/ai-chat-store'
import { agruparActividad, type ItemActividad } from './actividad-agrupada'
import { FilasActividad } from './actividad-por-agente'

type Props = {
  progreso: ProgresoAgente
  /** El turno sigue en curso: el panel se muestra abierto. */
  vivo?: boolean
}

function Icono({ estado }: { estado: 'pendiente' | 'en_curso' | 'hecha' | 'ok' | 'error' }) {
  if (estado === 'en_curso') return <Loader2 className="size-3 shrink-0 animate-spin text-accent-amber" />
  if (estado === 'hecha' || estado === 'ok') return <Check className="size-3 shrink-0 text-emerald-400" />
  if (estado === 'error') return <X className="size-3 shrink-0 text-destructive" />
  return <Circle className="size-3 shrink-0 text-muted-foreground/50" />
}

function etiquetaCabecera(p: ProgresoAgente, vivo: boolean): string {
  const hechas = p.tareas.filter((t) => t.estado === 'hecha').length
  if (vivo || p.estado === 'trabajando') {
    const actual = p.tareas.find((t) => t.estado === 'en_curso')?.titulo ?? [...p.actividad].reverse().find((a) => a.estado === 'en_curso')?.texto
    return actual ? `${actual}…` : 'Trabajando…'
  }
  const seg = p.fin ? Math.max(1, Math.round((p.fin - p.inicio) / 1000)) : null
  const base = p.tareas.length ? `${hechas} de ${p.tareas.length} tareas` : `${p.actividad.length} paso${p.actividad.length === 1 ? '' : 's'}`
  if (p.estado === 'detenido') return `Detenido · ${base}`
  return seg ? `${base} · ${seg} s` : base
}

/**
 * Progreso de la banda: una línea (etapa actual o resumen) y el detalle en un globo al pasar el ratón o con
 * el foco, flotando sobre el chat sin ocupar sitio.
 */
function ProgresoCompacto({ p, vivo, pasos }: { p: ProgresoAgente; vivo: boolean; pasos: ItemActividad[] }) {
  const trabajando = vivo || p.estado === 'trabajando'
  const ultimo = [...pasos].reverse().find((a) => a.estado === 'en_curso') ?? pasos.at(-1)
  const ultimoQuien = ultimo?.nombre ?? ultimo?.agente
  return (
    <div data-agente-progreso={p.estado} data-compacto="si" className="group relative mb-2 w-full min-w-0" tabIndex={0}>
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        {trabajando ? <Loader2 className="size-3 shrink-0 animate-spin text-accent-amber" /> : <Users className="size-3 shrink-0 text-accent-amber" />}
        <span className="shrink-0">{etiquetaCabecera(p, vivo)}</span>
        {trabajando && ultimo ? <span className="min-w-0 flex-1 truncate">· {ultimoQuien ? `${ultimoQuien}: ` : ''}{ultimo.texto}</span> : null}
      </div>
      <div className="invisible absolute inset-x-0 top-full z-40 mt-1 max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-panel-raised p-2 text-[11px] opacity-0 shadow-xl transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        {p.tareas.length ? (
          <ul className="space-y-0.5">
            {p.tareas.map((t, i) => (
              <li key={`${t.titulo}-${i}`} className="flex min-w-0 items-center gap-1.5">
                <Icono estado={t.estado} />
                <span className={cn('min-w-0 break-words', t.estado === 'hecha' ? 'text-muted-foreground' : 'text-foreground')}>{t.titulo}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {p.subagentes.length ? (
          <ul className="space-y-0.5 border-t border-border/40 pt-1">
            {p.subagentes.map((s) => (
              <li key={s.id} className="flex min-w-0 items-start gap-1.5">
                <span className="mt-0.5"><Icono estado={s.estado} /></span>
                <span className="min-w-0 break-words"><span className="font-medium text-foreground">{s.nombre}</span> · {s.resumen || s.tarea}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {pasos.length ? (
          <div className="border-t border-border/40 pt-1 text-muted-foreground">
            <FilasActividad filas={agruparActividad(pasos)} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Pasos del progreso como actividad por agente (la fila no tiene agente si el paso no indica quién). */
export function itemsDeActividad(actividad: ProgresoAgente['actividad']): ItemActividad[] {
  return actividad.slice(-400).map((a) => ({ id: a.id, agente: a.quien ?? '', nombre: a.quien ?? 'Agente', texto: a.texto, estado: a.estado }))
}

/** Progreso del agente en el chat: tareas planificadas, pasos y ayudantes en paralelo. */
export function AgenteProgreso({ progreso: p, vivo = false }: Props) {
  const [abierto, setAbierto] = useState(vivo)
  useEffect(() => setAbierto(vivo), [vivo])
  // Una fila por agente (con su contador) en lugar de una línea por llamada.
  const pasos = useMemo(() => itemsDeActividad(p.actividad), [p.actividad])
  if (!p.tareas.length && !p.actividad.length && !p.subagentes.length) {
    return vivo ? (
      <div className="mb-2 flex items-center gap-1.5 text-[12px] text-muted-foreground/80">
        <Loader2 className="size-3.5 animate-spin" /> Pensando…
      </div>
    ) : null
  }
  if (p.tipo === 'banda') return <ProgresoCompacto p={p} vivo={vivo} pasos={pasos} />
  return (
    <div data-agente-progreso={p.estado} className="mb-2 w-full min-w-0 rounded-md border border-border/50 bg-panel-raised/40">
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => setAbierto((o) => !o)}
        className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform duration-150', abierto && 'rotate-90')} />
        {vivo || p.estado === 'trabajando' ? <Loader2 className="size-3 shrink-0 animate-spin text-accent-amber" /> : null}
        <span className="min-w-0 flex-1 break-words">{etiquetaCabecera(p, vivo)}</span>
      </button>
      {abierto ? (
        <div className="space-y-2 border-t border-border/40 px-2.5 py-2 text-[12px]">
          {p.tareas.length ? (
            <ul className="space-y-1">
              {p.tareas.map((t, i) => (
                <li key={`${t.titulo}-${i}`} className="flex min-w-0 items-start gap-1.5">
                  <span className="mt-0.5">
                    <Icono estado={t.estado} />
                  </span>
                  <span className={cn('min-w-0 break-words', t.estado === 'hecha' ? 'text-muted-foreground line-through decoration-muted-foreground/40' : 'text-foreground')}>
                    {t.titulo}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {p.subagentes.length ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Users className="size-3" /> Trabajando en paralelo
              </div>
              {p.subagentes.map((s) => (
                <div key={s.id} className="flex min-w-0 items-start gap-1.5 pl-1">
                  <span className="mt-0.5">
                    <Icono estado={s.estado} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{s.nombre}</div>
                    <div className="break-words text-[11px] text-muted-foreground">{s.resumen || s.tarea}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {pasos.length ? (
            <div className="text-[11px] text-muted-foreground">
              <FilasActividad filas={agruparActividad(pasos)} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
