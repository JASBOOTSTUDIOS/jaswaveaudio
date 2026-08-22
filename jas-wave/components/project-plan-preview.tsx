import { useCallback, useState } from 'react'
import { Check, Loader2, ListMusic } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import { executeDawActions } from '@/src/lib/ai-daw-agent'
import type { ProjectPlanData } from '@/src/lib/project-plan'

type Props = {
  plan: ProjectPlanData
  status?: 'pending' | 'applied' | 'discarded'
}

/** Vista previa de un plan de proyecto (pistas + VSTs + mapas MIDI). */
export function ProjectPlanPreview({ plan, status = 'pending' }: Props) {
  const tienda = useDAW()
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState(plan.applied ? 'applied' : status)

  const apply = useCallback(async () => {
    setBusy(true)
    try {
      const results = await executeDawActions(tienda, [
        {
          type: 'daw.composeProject',
          payload: {
            aplicar: true,
            nombre: plan.nombre,
            bpm: plan.bpm,
            tonalidad: plan.keyLabel,
            minutos: plan.minutes,
            pensamiento: plan.pensamiento,
            pistas: plan.tracks.map((t) => ({
              nombre: t.nombre,
              rol: t.rol,
              tipo: t.tipo,
              pluginNombre: t.pluginNombre,
              pluginId: t.pluginId,
              articulacion: t.articulacion,
            })),
          },
        },
      ])
      if (results.some((r) => r.success)) setLocal('applied')
    } finally {
      setBusy(false)
    }
  }, [plan, tienda])

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-background/50 ring-1 ring-accent-amber/20">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate text-[12px] font-semibold text-foreground">
            <ListMusic className="size-3.5 shrink-0 text-accent-amber" />
            {plan.nombre}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {plan.keyLabel} · {plan.bpm} BPM · {plan.minutes} min · {plan.tracks.length} pistas
          </div>
        </div>
        {local === 'applied' ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">
            <Check className="size-3" /> Aplicado
          </span>
        ) : (
          <span className="text-[9px] uppercase tracking-wide text-accent-amber">Vista previa</span>
        )}
      </div>
      {plan.pensamiento ? (
        <p className="border-b border-border/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {plan.pensamiento}
        </p>
      ) : null}
      <ul className="max-h-48 space-y-1 overflow-y-auto px-2.5 py-2">
        {plan.tracks.map((t, i) => (
          <li key={`${t.nombre}-${i}`} className="text-[11px] leading-snug">
            <span className="font-medium text-foreground">{t.nombre}</span>
            <span className="text-muted-foreground">
              {' '}
              · {t.rol}
              {t.pluginNombre ? ` · ${t.pluginNombre}` : ' · (sin VST aún)'}
            </span>
            {t.noteMapSummary ? (
              <div className="pl-2 text-[10px] text-muted-foreground/90">{t.noteMapSummary}</div>
            ) : null}
          </li>
        ))}
      </ul>
      {local !== 'applied' ? (
        <div className="border-t border-border/60 px-2.5 py-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply()}
            className="inline-flex items-center gap-1 rounded-md bg-accent-amber/20 px-2 py-1 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/30 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : null}
            Crear pistas, cargar VSTs y MIDI
          </button>
        </div>
      ) : null}
    </div>
  )
}
