import { useState, useEffect, useRef } from 'react'
import {
  orquestadorBandaSingleton,
  type BandaLiveState,
  type FaseBanda,
} from '../motor/banda-orchestrator'
import {
  Users,
  CheckCircle2,
  AlertCircle,
  Clock,
  Play,
  Square,
  Sparkles,
  Sliders,
  Disc,
  Music,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react'

export function BandaLiveOrchestrator() {
  const [liveState, setLiveState] = useState<BandaLiveState>(() =>
    orquestadorBandaSingleton.getState(),
  )
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return orquestadorBandaSingleton.subscribe((next) => {
      setLiveState({ ...next })
    })
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [liveState.eventos.length])

  const faseLabels: Record<FaseBanda, string> = {
    idle: 'En espera',
    planificacion: '1. Planificación Musical',
    direccion: '2. Asignación del Director',
    grabacion_musicos: '3. Grabación de Músicos',
    qa_musicos: '4. Auditoría QA Musical',
    mezcla: '5. Mezcla y Balance FX',
    qa_mezcla: '6. Auditoría QA Mezcla',
    mastering: '7. Masterización Final',
    qa_final: '8. Inspección QA Final',
    completado: '✓ Producción Finalizada',
    error: 'Error',
  }

  const faseIndex = (fase: FaseBanda): number => {
    switch (fase) {
      case 'planificacion':
        return 1
      case 'direccion':
        return 2
      case 'grabacion_musicos':
      case 'qa_musicos':
        return 3
      case 'mezcla':
      case 'qa_mezcla':
        return 4
      case 'mastering':
      case 'qa_final':
        return 5
      case 'completado':
        return 6
      default:
        return 0
    }
  }

  const currentStep = faseIndex(liveState.faseActual)
  const latestEvent = liveState.eventos[liveState.eventos.length - 1]

  if (!liveState.activo && liveState.eventos.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent-amber/40 bg-panel-raised/95 p-3 text-xs shadow-lg ring-1 ring-accent-amber/20">
      {/* Encabezado con estado en vivo */}
      <div className="flex items-center justify-between border-b border-border/60 pb-2">
        <div className="flex items-center gap-2">
          <div className="relative flex size-6 items-center justify-center rounded-full bg-accent-amber/20 text-accent-amber">
            <Users className="size-3.5" />
            {liveState.activo && (
              <span className="absolute -top-0.5 -right-0.5 flex size-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-amber opacity-75" />
                <span className="relative inline-flex rounded-full size-2 bg-accent-amber" />
              </span>
            )}
          </div>
          <div>
            <div className="font-semibold text-foreground text-[12px] flex items-center gap-1.5">
              <span>Banda Virtual de Músicos IA</span>
              <span className="rounded bg-accent-amber/15 px-1.5 py-0.2 text-[9px] font-bold text-accent-amber uppercase tracking-wider">
                {liveState.activo ? 'En Vivo' : 'Completado'}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground truncate max-w-xs" title={liveState.promptUsuario}>
              {faseLabels[liveState.faseActual]}
            </div>
          </div>
        </div>

        {liveState.activo && (
          <button
            type="button"
            onClick={() => orquestadorBandaSingleton.detener()}
            className="flex items-center gap-1 rounded bg-rose-500/20 px-2 py-1 text-[10px] font-medium text-rose-300 hover:bg-rose-500/30 transition-colors"
          >
            <Square className="size-3 fill-current" />
            <span>Detener</span>
          </button>
        )}
      </div>

      {/* Flujo de fases visual estilo Pipeline */}
      <div className="grid grid-cols-6 gap-1 pt-1 text-[10px] text-center font-medium">
        {[
          { num: 1, label: 'Plan', icon: Sparkles },
          { num: 2, label: 'Director', icon: Users },
          { num: 3, label: 'Músicos', icon: Music },
          { num: 4, label: 'Mezcla', icon: Sliders },
          { num: 5, label: 'Master', icon: Disc },
          { num: 6, label: 'QA Listo', icon: ShieldCheck },
        ].map((step) => {
          const isDone = currentStep > step.num || liveState.faseActual === 'completado'
          const isCurrent = currentStep === step.num && liveState.activo
          const Icon = step.icon
          return (
            <div
              key={step.num}
              className={`flex flex-col items-center gap-1 p-1 rounded-md transition-all ${
                isDone
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : isCurrent
                    ? 'bg-accent-amber/20 text-accent-amber border border-accent-amber/50 animate-pulse'
                    : 'bg-panel-base/40 text-muted-foreground/60 border border-border/40'
              }`}
            >
              <Icon className="size-3.5" />
              <span className="truncate w-full text-[9px]">{step.label}</span>
            </div>
          )
        })}
      </div>

      {/* Barra de progreso interactiva */}
      {latestEvent?.progresoPorcentaje != null && (
        <div className="w-full bg-panel-base/80 h-1.5 rounded-full overflow-hidden mt-1">
          <div
            className="bg-accent-amber h-full transition-all duration-300"
            style={{ width: `${latestEvent.progresoPorcentaje}%` }}
          />
        </div>
      )}

      {/* Consola de eventos y auditoría en tiempo real */}
      <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto rounded-lg bg-panel-base/80 p-2 border border-border/60">
        {liveState.eventos.map((ev) => (
          <div key={ev.id} className="flex items-start gap-1.5 text-[11px] leading-tight">
            {ev.estadoQA === 'aprobado' ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400 mt-0.5" />
            ) : ev.estadoQA === 'corrigiendo' ? (
              <AlertCircle className="size-3.5 shrink-0 text-amber-400 mt-0.5" />
            ) : ev.fase === 'completado' ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400 mt-0.5" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-accent-amber mt-0.5" />
            )}

            <div className="flex-1 min-w-0">
              <span className="font-semibold text-foreground mr-1" style={{ color: ev.color }}>
                [{ev.agenteNombre}]:
              </span>
              <span className="text-foreground/90">{ev.mensaje}</span>
              {ev.accionDetalle && (
                <div className="text-[10px] text-muted-foreground font-mono bg-panel-raised/50 rounded px-1.5 py-0.5 mt-0.5 border border-border/40">
                  {ev.accionDetalle}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      {/* Resumen de QA */}
      {liveState.qaReporte.detalles.length > 0 && (
        <div className="flex items-center gap-2 pt-1 border-t border-border/50 text-[10px] text-muted-foreground">
          <ShieldCheck className="size-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">
            Auditoría QA: {liveState.qaReporte.musicosAprobados}/{liveState.qaReporte.musicosTotal} músicos aprobados
            {liveState.qaReporte.mezclaAprobada ? ' · Mezcla OK' : ''}
            {liveState.qaReporte.masterAprobado ? ' · Master OK' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
