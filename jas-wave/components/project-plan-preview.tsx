import { useCallback, useState } from 'react'
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
    <div className="mt-1.5 w-full min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[0.85em] text-foreground/90">{plan.nombre}</div>
          <div className="truncate text-[0.8em] text-muted-foreground/70">
            {plan.keyLabel} · {plan.bpm} BPM · {plan.tracks.length} pistas
          </div>
        </div>
        {local === 'applied' ? (
          <span className="text-[10px] text-muted-foreground/50">ok</span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply()}
            className="shrink-0 text-[0.85em] text-foreground/80 hover:text-foreground disabled:opacity-50"
          >
            {busy ? '…' : 'Crear pistas'}
          </button>
        )}
      </div>
      {plan.pensamiento ? (
        <p className="mt-0.5 text-[0.8em] text-muted-foreground/70">{plan.pensamiento}</p>
      ) : null}
      <ul className="mt-0.5 max-h-40 space-y-0.5 overflow-y-auto text-[0.85em] text-muted-foreground">
        {plan.tracks.map((t, i) => (
          <li key={`${t.nombre}-${i}`} className="truncate">
            <span className="text-foreground/80">{t.nombre}</span>
            {' · '}
            {t.rol}
            {t.pluginNombre ? ` · ${t.pluginNombre}` : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}
