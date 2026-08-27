/**
 * UI JasWave Roles (ex Soft Pad): instrumento + FX en el DAW.
 * Parámetros → setParameter del VST3 en el Plugin Host.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Music2, Waves } from 'lucide-react'
import type { PluginInfo } from '../../shared/src/types/entidades'
import {
  JASWAVE_ROLES_NAME,
  ROLE_PARAM_DEFS,
  type JasWaveRole,
  applyJasWaveRolesParameter,
  normalizeJasWaveRole,
  roleToNormalized,
} from '@/src/lib/plugin/jaswave-roles'
import { setSlotParameter, slotIdForTrackPlugin } from '@/src/lib/plugin/track-vst-runtime'
import { routeMidiToTrack } from '@/src/lib/plugin/vst-voice-router'

const ROLE_OPTIONS: { id: JasWaveRole; label: string }[] = [
  { id: 'drums', label: 'Drums' },
  { id: 'percussion', label: 'Percussion' },
  { id: 'bass', label: 'Bass' },
  { id: 'guitar', label: 'Guitar' },
  { id: 'piano', label: 'Piano' },
  { id: 'keys', label: 'Keys' },
  { id: 'pad', label: 'Pad' },
  { id: 'strings', label: 'Strings' },
  { id: 'choir', label: 'Choir' },
  { id: 'lead', label: 'Lead' },
  { id: 'brass', label: 'Brass' },
  { id: 'synth', label: 'Synth' },
  { id: 'default', label: 'Default' },
]

type Props = {
  trackId: string
  plugin: PluginInfo
  initialRole?: string
}

function KnobRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
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
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full accent-amber-400"
      />
    </label>
  )
}

export function JasWaveRolesPanel({ trackId, plugin, initialRole }: Props) {
  const slotId = useMemo(() => slotIdForTrackPlugin(trackId, plugin.id), [trackId, plugin.id])
  const [role, setRole] = useState<JasWaveRole>(() => normalizeJasWaveRole(initialRole ?? 'pad'))
  const [params, setParams] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = { 0: roleToNormalized(normalizeJasWaveRole(initialRole ?? 'pad')) }
    for (const d of ROLE_PARAM_DEFS) {
      if (d.id === 0) continue
      init[d.id] = d.defaultValue
    }
    return init
  })

  useEffect(() => {
    void applyJasWaveRolesParameter(trackId, plugin, role)
  }, [trackId, plugin, role])

  const setParam = useCallback(
    async (id: number, value: number) => {
      const v = Math.max(0, Math.min(1, value))
      setParams((prev) => ({ ...prev, [id]: v }))
      await setSlotParameter(slotId, id, v)
    },
    [slotId],
  )

  const preview = (pitch: number, on: boolean) => {
    routeMidiToTrack(trackId, on, pitch, 110, { ignoreMute: true, plugins: [plugin] })
  }

  const synthParams = ROLE_PARAM_DEFS.filter((d) => d.group === 'synth')
  const fxParams = ROLE_PARAM_DEFS.filter((d) => d.group === 'fx')

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <Waves className="size-4 text-accent-amber" />
        <div>
          <div className="text-[12px] font-semibold text-foreground">{JASWAVE_ROLES_NAME}</div>
          <div className="text-[10px] text-muted-foreground">
            Instrumento VST3 independiente del motor Web Audio del DAW
          </div>
        </div>
      </div>

      <section>
        <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Music2 className="size-3" /> Instrumento
        </div>
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
          {ROLE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setRole(opt.id)
                void setParam(0, roleToNormalized(opt.id))
              }}
              className={`rounded px-2 py-1.5 text-[11px] font-medium ring-1 ${
                role === opt.id
                  ? 'bg-accent-amber/20 text-accent-amber ring-accent-amber/50'
                  : 'bg-panel-raised text-muted-foreground ring-border hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-2 rounded-md border border-border bg-panel-raised/40 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Synth
          </div>
          {synthParams.map((d) => (
            <KnobRow
              key={d.id}
              label={d.label}
              value={params[d.id] ?? d.defaultValue}
              onChange={(v) => void setParam(d.id, v)}
            />
          ))}
        </div>
        <div className="space-y-2 rounded-md border border-border bg-panel-raised/40 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            FX · Tone
          </div>
          {fxParams.map((d) => (
            <KnobRow
              key={d.id}
              label={d.label}
              value={params[d.id] ?? d.defaultValue}
              onChange={(v) => void setParam(d.id, v)}
            />
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-1 border-t border-border pt-2">
        {[48, 52, 55, 60, 64, 67, 72].map((pitch) => (
          <button
            key={pitch}
            type="button"
            onPointerDown={() => preview(pitch, true)}
            onPointerUp={() => preview(pitch, false)}
            onPointerLeave={() => preview(pitch, false)}
            className="rounded bg-background px-2 py-1 font-mono text-[10px] ring-1 ring-border hover:ring-accent-amber"
          >
            {pitch}
          </button>
        ))}
      </div>
    </div>
  )
}
