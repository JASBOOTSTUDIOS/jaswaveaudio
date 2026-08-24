import { useCallback, useEffect, useMemo, useState } from 'react'
import { Radio, Search, X } from 'lucide-react'
import { useDAWState } from '@/src/context/daw-context'
import { Button } from '@/components/ui/button'
import { midiController } from '@/src/lib/midi-controller'
import {
  buildMidiMapCatalog,
  formatMidiMapTrigger,
  looksLikeSmcMixer,
  mergeSmcMixerPreset,
  pluginParamTarget,
  type MidiMapTarget,
} from '@/src/lib/midi-map'
import { midiMapStore } from '@/src/lib/midi-map-store'
import { setMidiMapTargetIndex } from '@/src/lib/midi-map-runtime'
import { listLoadedSlots, listSlotParameters } from '@/src/lib/plugin/track-vst-runtime'

type Props = { open: boolean; onClose: () => void }

export function MidiMapDialog({ open, onClose }: Props) {
  const trackCount = useDAWState((s) => s.project?.tracks?.length ?? 0)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('Todas')
  const [tick, setTick] = useState(0)
  const [pluginTargets, setPluginTargets] = useState<MidiMapTarget[]>([])
  const [deviceHint, setDeviceHint] = useState('')

  useEffect(() => midiMapStore.subscribe(() => setTick((n) => n + 1)), [])

  useEffect(() => {
    if (!open) return
    const names = midiController.getStatus().devices.map((d) => d.name)
    setDeviceHint(names.find(looksLikeSmcMixer) ?? '')
  }, [open, tick])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const extra: MidiMapTarget[] = []
      for (const slot of listLoadedSlots()) {
        const params = await listSlotParameters(slot.slotId)
        const pluginName = slot.path.split(/[/\\]/).pop()?.replace(/\.vst3$/i, '') ?? slot.pluginId
        for (const p of params) {
          extra.push(pluginParamTarget(slot.slotId, pluginName, p.parameterId, p.name))
        }
      }
      if (!cancelled) setPluginTargets(extra)
    })()
    return () => {
      cancelled = true
    }
  }, [open, tick])

  const catalog = useMemo(() => {
    const base = buildMidiMapCatalog(Math.max(trackCount, 8))
    return [...base, ...pluginTargets]
  }, [trackCount, pluginTargets])

  useEffect(() => {
    setMidiMapTargetIndex(catalog)
  }, [catalog])

  const groups = useMemo(() => {
    const set = new Set(catalog.map((t) => t.group))
    return ['Todas', ...set]
  }, [catalog])

  const bindings = midiMapStore.getBindings()
  const learning = midiMapStore.getLearnTargetId()
  const q = query.trim().toLowerCase()

  const rows = useMemo(() => {
    return catalog.filter((t) => {
      if (group !== 'Todas' && t.group !== group) return false
      if (!q) return true
      return t.search.includes(q) || t.name.toLowerCase().includes(q)
    })
  }, [catalog, group, q])

  const bindingOf = useCallback(
    (id: string) => bindings.find((b) => b.targetId === id),
    [bindings],
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative z-10 flex h-[75vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Radio className="size-4 text-accent-amber" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">Control MIDI</h2>
            <p className="text-[11px] text-muted-foreground">
              Busca una función, pulsa Escuchar MIDI y mueve el control (pedal, fader, tecla o botón).
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-md bg-panel-raised px-2 py-1">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar: sustain, volumen, play…"
              className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
              spellCheck={false}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => midiMapStore.replaceAll(mergeSmcMixerPreset(midiMapStore.getBindings()))}
          >
            Preset SMC-MIXER
          </Button>
          <Button size="sm" variant="ghost" onClick={() => midiMapStore.clearAll()}>
            Borrar mapas
          </Button>
        </div>

        {deviceHint ? (
          <div className="border-b border-border bg-accent-amber/10 px-4 py-1.5 text-[11px] text-accent-amber">
            Detectado: {deviceHint}. En el mixer usa modo CC / User (no DAW/Mackie). Preset: faders
            CC40–47 → volumen, knobs CC30–37 → paneo.
          </div>
        ) : (
          <div className="border-b border-border px-4 py-1.5 text-[11px] text-muted-foreground">
            M-VAVE SMC-MIXER: ponlo en modo CC (User) y aplica el preset. La paleta de comandos
            (Ctrl+K) ejecuta las mismas acciones; el editor de automatización llega después de este
            mapeo.
          </div>
        )}

        <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-1.5">
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroup(g)}
              className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] ${
                group === g ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((t) => {
            const b = bindingOf(t.id)
            const capturing = learning === t.id
            return (
              <div key={t.id} className="flex items-center gap-2 border-b border-border/60 px-4 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-foreground">{t.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{t.hint ?? t.group}</div>
                </div>
                <span className="max-w-[160px] truncate font-mono text-[11px] text-muted-foreground">
                  {capturing ? 'Esperando señal…' : b ? formatMidiMapTrigger(b.trigger) : '—'}
                </span>
                <Button
                  size="sm"
                  variant={capturing ? 'default' : 'outline'}
                  onClick={() =>
                    capturing ? midiMapStore.cancelLearn() : midiMapStore.startLearn(t.id)
                  }
                >
                  {capturing ? 'Cancelar' : 'Escuchar MIDI'}
                </Button>
                {b && !capturing ? (
                  <Button size="sm" variant="ghost" onClick={() => midiMapStore.unbind(t.id)}>
                    Quitar
                  </Button>
                ) : null}
              </div>
            )
          })}
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">
              Nada coincide con la búsqueda.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
