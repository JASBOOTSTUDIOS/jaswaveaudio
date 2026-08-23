import { useCallback, useState } from 'react'
import { Check, Loader2, Layers } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import { executeDawActions } from '@/src/lib/ai-daw-agent'
import type { MusicBuildResult, MusicBuildStageStatus } from '@/src/lib/music-build/types'

type Props = {
  build: MusicBuildResult
  status?: 'pending' | 'applied' | 'discarded'
}

function stageMark(status: MusicBuildStageStatus): string {
  if (status === 'ok') return '✓'
  if (status === 'fail') return '✗'
  if (status === 'running') return '●'
  if (status === 'skip') return '–'
  return ' '
}

/** Vista del Music Build: fases + pistas. Aplicar orquesta las herramientas existentes. */
export function MusicBuildPreview({ build, status = 'pending' }: Props) {
  const tienda = useDAW()
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState(build.applied ? 'applied' : status)
  const spec = build.spec

  const apply = useCallback(async () => {
    setBusy(true)
    try {
      const results = await executeDawActions(tienda, [
        {
          type: 'daw.musicBuild',
          payload: {
            aplicar: true,
            prompt: spec.prompt,
            nombre: spec.nombre,
            bpm: spec.bpm,
            minutos: spec.minutes,
          },
        },
      ])
      if (results.some((r) => r.success)) setLocal('applied')
    } finally {
      setBusy(false)
    }
  }, [spec, tienda])

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-background/50 ring-1 ring-accent-amber/20">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate text-[12px] font-semibold text-foreground">
            <Layers className="size-3.5 shrink-0 text-accent-amber" />
            Build · {spec.nombre}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {spec.keyLabel} · {spec.bpm} BPM · {spec.minutes} min · {spec.tracks.length} pistas
          </div>
        </div>
        {local === 'applied' ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">
            <Check className="size-3" /> Completado
          </span>
        ) : (
          <span className="text-[9px] uppercase tracking-wide text-accent-amber">Planificado</span>
        )}
      </div>
      <p className="border-b border-border/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {spec.sections.map((s) => `${s.name} ${s.bars}c`).join(' → ')}
      </p>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto px-2.5 py-2 font-mono text-[10px] text-muted-foreground">
        {build.stages.map((s) => (
          <li key={s.id}>
            [{stageMark(s.status)}] {s.label}
            {s.detail ? <span className="text-muted-foreground/80"> — {s.detail}</span> : null}
          </li>
        ))}
      </ul>
      <ul className="max-h-32 space-y-1 overflow-y-auto border-t border-border/40 px-2.5 py-2">
        {spec.tracks.map((t, i) => (
          <li key={`${t.nombre}-${i}`} className="text-[11px] leading-snug">
            <span className="font-medium text-foreground">{t.nombre}</span>
            <span className="text-muted-foreground">
              {' '}
              · {t.rol}
              {t.pluginNombre ? ` · ${t.pluginNombre}` : ' · (catálogo al aplicar)'}
            </span>
          </li>
        ))}
      </ul>
      {build.issues.length > 0 ? (
        <ul className="border-t border-border/40 px-2.5 py-1.5 text-[10px] text-amber-400/90">
          {build.issues.slice(0, 6).map((i, n) => (
            <li key={`${i.code}-${n}`}>{i.message}</li>
          ))}
        </ul>
      ) : null}
      {local !== 'applied' ? (
        <div className="border-t border-border/60 px-2.5 py-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply()}
            className="inline-flex items-center gap-1 rounded-md bg-accent-amber/20 px-2 py-1 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/30 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : null}
            Ejecutar Music Build
          </button>
        </div>
      ) : null}
    </div>
  )
}
