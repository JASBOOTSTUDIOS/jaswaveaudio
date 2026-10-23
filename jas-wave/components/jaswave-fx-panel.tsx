/**
 * Panel de controles de los FX propios JasWave (A7d): EQ 8 bandas, Compresor,
 * Limitador true-peak 4×, Utility y De-esser.
 * Los parámetros se escriben al VST3 del Plugin Host vía setSlotParameter.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Music2, Waves, X } from 'lucide-react'
import type { PluginInfo } from '../../shared/src/types/entidades'
import { useDAW } from '@/src/context/daw-context'
import {
  applyMixOnTrack,
  eqBandParamIds,
  perfilParametros,
} from '@/src/lib/plugin/jaswave-fx-mix'
import { setSlotParameter, slotIdForTrackPlugin } from '@/src/lib/plugin/track-vst-runtime'

type FxKind = 'eq' | 'comp' | 'limiter' | 'utility' | 'deesser'

const KIND_LABELS: Record<FxKind, string> = {
  eq: 'EQ 8 bandas',
  comp: 'Compresor',
  limiter: 'Limitador true-peak',
  utility: 'Utility',
  deesser: 'De-esser',
}

type ProfilePlugin = { parameters: ReturnType<typeof perfilParametros> }

function paramsFor(kind: FxKind): ProfilePlugin['parameters'] {
  return perfilParametros(kind)
}

type Props = {
  trackId: string
  plugin: PluginInfo
}

function KnobRow({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  readOnly?: boolean
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono tabular-nums">{Math.round(value * 100)}</span>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`h-1.5 w-full accent-amber-400 ${readOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
      />
    </label>
  )
}

export function JasWaveFxPanel({ trackId, plugin }: Props) {
  const tienda = useDAW()
  const slotId = useMemo(() => slotIdForTrackPlugin(trackId, plugin.id), [trackId, plugin.id])
  const [activeKind, setActiveKind] = useState<FxKind>('eq')
  const [params, setParams] = useState<Record<number, number>>({})

  const kindMatch = (() => {
    const n = (plugin.nombre ?? '').toLowerCase()
    if (n.includes('eq')) return 'eq'
    if (n.includes('compresor') || n.includes('compress')) return 'comp'
    if (n.includes('limit')) return 'limiter'
    if (n.includes('utility')) return 'utility'
    if (n.includes('de-esser') || n.includes('deesser')) return 'deesser'
    return activeKind
  })()

  useEffect(() => {
    setActiveKind(kindMatch)
    const init: Record<number, number> = {}
    for (const d of paramsFor(kindMatch as FxKind)) {
      init[d.id] = d.default ?? 0
    }
    setParams(init)
  }, [trackId, plugin.id, kindMatch])

  const setParam = useCallback(
    async (id: number, value: number) => {
      const v = Math.max(0, Math.min(1, value))
      setParams((prev) => ({ ...prev, [id]: v }))
      await setSlotParameter(slotId, id, v)
    },
    [slotId],
  )

  const insertIfMissing = useCallback(async () => {
    const r = await applyMixOnTrack(tienda, trackId, kindMatch as FxKind, {})
    if (r.slotId) {
      // no-op ensure: applyMixOnTrack already inserted; just confirm
      void r
    }
  }, [tienda, trackId, kindMatch])

  const bands = useMemo(() => {
    const out: Array<{ band: number; params: ProfilePlugin['parameters'] }> = []
    for (let b = 1; b <= 8; b++) {
      const ids = eqBandParamIds(b)
      const group = paramsFor('eq').filter(
        (p) =>
          p.id === ids.type || p.id === ids.freq || p.id === ids.gain || p.id === ids.q || p.id === ids.on,
      )
      out.push({ band: b, params: group })
    }
    return out
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <Waves className="size-4 text-accent-amber" />
        <div>
          <div className="text-[12px] font-semibold text-foreground">JasWave FX</div>
          <div className="text-[10px] text-muted-foreground">
            EQ · Compresor · Limitador · Utility · De-esser (VST3 propio)
          </div>
        </div>
        <button
          type="button"
          onClick={() => void insertIfMissing()}
          disabled={!slotId}
          className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] ring-1 ring-border hover:text-foreground"
        >
          {slotId ? 'Insertar si falta' : 'Sin slot'}
        </button>
      </div>

      <div className="flex gap-1 border-b border-border pb-1 overflow-x-auto">
        {(['eq', 'comp', 'limiter', 'utility', 'deesser'] as FxKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setActiveKind(kind)}
            className={`rounded px-2 py-1 text-[10px] font-medium ring-1 border ${
              activeKind === kind
                ? 'bg-accent-amber/20 text-accent-amber ring-accent-amber/50'
                : 'bg-panel-raised text-muted-foreground ring-border hover:text-foreground'
            }`}
          >
            {KIND_LABELS[kind]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {}}
          className="ml-auto rounded px-1 text-[9px] text-muted-foreground ring-1 ring-border hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>

      <section className="grid gap-2 sm:grid-cols-2 flex-1 min-h-0">
        {activeKind === 'eq' ? (
          bands.map((g) => (
            <div key={g.band} className="rounded-md border border-border bg-panel-raised/40 p-2">
              <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Music2 className="size-3" /> Banda {g.band}
              </div>
              <div className="grid gap-1 sm:grid-cols-2">
                {g.params.map((d) => (
                  <KnobRow
                    key={d.id}
                    label={d.name}
                    value={params[d.id] ?? d.default ?? 0}
                    onChange={(v) => void setParam(d.id, v)}
                    readOnly={d.readOnly}
                  />
                ))}
              </div>
            </div>
          ))
        ) : (
          paramsFor(activeKind).map((d) => (
            <KnobRow
              key={d.id}
              label={d.name}
              value={params[d.id] ?? d.default ?? 0}
              onChange={(v) => void setParam(d.id, v)}
              readOnly={d.readOnly}
            />
          ))
        )}
      </section>

      <div className="flex flex-wrap gap-1 border-t border-border pt-2">
        {[60, 64, 67, 72].map((pitch) => (
          <button
            key={pitch}
            type="button"
            className="rounded bg-background px-2 py-1 font-mono text-[10px] ring-1 ring-border hover:ring-accent-amber"
          >
            {pitch}
          </button>
        ))}
      </div>
    </div>
  )
}
