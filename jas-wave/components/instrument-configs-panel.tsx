/**
 * Listado de configs VST guardadas (estado real: DecentSampler, Kontakt, etc.)
 * para que la IA las reutilice por rol / presetId.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Loader2, Plus, Play, Star, Trash2, Globe } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'
import type { LibraryPreset } from '@/src/lib/library/preset-catalog'
import {
  libraryApplyPreset,
  libraryAuditionPreset,
  libraryDeletePreset,
  libraryList,
  libraryPromoteToGlobal,
  librarySaveFromTrack,
  libraryUpdateMeta,
} from '@/src/lib/library/ops'
import {
  ASSIGNABLE_INSTRUMENT_ROLES,
  getInstrumentAiPrefsSnapshot,
  INSTRUMENT_ROLE_LABELS,
  rolesWherePresetIsDefault,
  setRoleDefault,
  subscribeInstrumentAiPrefs,
  type RoleDefaultRef,
} from '@/src/lib/plugin/instrument-ai-prefs'
import type { InstrumentRole } from '@/src/lib/plugin-knowledge'

function useAiPrefs() {
  return useSyncExternalStore(
    subscribeInstrumentAiPrefs,
    getInstrumentAiPrefsSnapshot,
    getInstrumentAiPrefsSnapshot,
  )
}

export function InstrumentConfigsPanel({ onMessage }: { onMessage?: (msg: string) => void }) {
  const tienda = useDAW()
  const prefs = useAiPrefs()
  const projectId = useDAWState((s: DAWState) => s.project?.id ?? 'default')
  const selectedTrackId = useDAWState((s: DAWState) => getSelectedTrackId(s))
  const selectedTrackName = useDAWState((s: DAWState) => {
    const id = getSelectedTrackId(s)
    return s.project?.tracks?.find((t) => t.id === id)?.nombre ?? null
  })
  const selectedPluginName = useDAWState((s: DAWState) => {
    const id = getSelectedTrackId(s)
    const track = s.project?.tracks?.find((t) => t.id === id)
    return track?.plugins?.[0]?.nombre ?? null
  })

  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [presets, setPresets] = useState<LibraryPreset[]>([])
  const [tick, setTick] = useState(0)
  const [localMsg, setLocalMsg] = useState('')

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    void (async () => {
      const list = await libraryList(tienda, 'all')
      setPresets(list.filter((p) => (p.type ?? 'plugin') === 'plugin'))
    })()
  }, [tienda, tick, projectId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = !q
      ? presets
      : presets.filter((p) =>
          `${p.nombre} ${p.pluginNombre} ${p.rol ?? ''} ${p.generoTags.join(' ')} ${p.notas ?? ''}`
            .toLowerCase()
            .includes(q),
        )
    return list.slice().sort((a, b) => {
      const pa = a.pluginNombre.localeCompare(b.pluginNombre)
      if (pa !== 0) return pa
      return a.nombre.localeCompare(b.nombre)
    })
  }, [presets, query])

  const groups = useMemo(() => {
    const map = new Map<string, LibraryPreset[]>()
    for (const p of filtered) {
      const key = p.pluginNombre || 'Plugin'
      const arr = map.get(key) ?? []
      arr.push(p)
      map.set(key, arr)
    }
    return [...map.entries()]
  }, [filtered])

  const say = (msg: string) => {
    setLocalMsg(msg)
    onMessage?.(msg)
  }

  const onSave = async (global: boolean) => {
    if (!selectedTrackId) {
      say('Selecciona una pista con el VST ya configurado (p. ej. DecentSampler con un instrumento cargado).')
      return
    }
    const nombre = window.prompt(
      'Nombre personalizado para la IA (ej. «guitarra ambiental worship», «piano gospel suave»):',
      '',
    )
    if (!nombre?.trim()) return
    const refsRaw =
      window.prompt(
        'Referencias / aliases para buscar (separadas por coma, opcional).\nEj: worship, ambiental, nylon',
        '',
      ) ?? ''
    const generoTags = refsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const rolRaw =
      window.prompt(
        `Rol técnico opcional (${ASSIGNABLE_INSTRUMENT_ROLES.join('/')}):`,
        '',
      ) ?? ''
    const rol = rolRaw.trim().toLowerCase() || undefined
    setBusy(true)
    try {
      const r = await librarySaveFromTrack(tienda, {
        trackId: selectedTrackId,
        nombre: nombre.trim(),
        rol,
        generoTags,
        notas: generoTags.length ? `refs: ${generoTags.join(', ')}` : undefined,
        global,
      })
      say(r.message)
      if (r.ok && r.preset && rol && ASSIGNABLE_INSTRUMENT_ROLES.includes(rol as InstrumentRole)) {
        const makeDefault = window.confirm(
          `¿Usar «${r.preset.nombre}» como default de ${INSTRUMENT_ROLE_LABELS[rol as InstrumentRole] ?? rol} para la IA?`,
        )
        if (makeDefault) {
          const ref: RoleDefaultRef = {
            pluginId: r.preset.pluginId,
            pluginNombre: r.preset.pluginNombre,
            presetId: r.preset.id,
            presetNombre: r.preset.nombre,
          }
          setRoleDefault(rol as InstrumentRole, ref)
          say(`Default ${INSTRUMENT_ROLE_LABELS[rol as InstrumentRole]} → ${r.preset.nombre}`)
        }
      }
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const onRename = async (p: LibraryPreset) => {
    const nombre = window.prompt('Nuevo nombre (la IA busca por este texto):', p.nombre)
    if (!nombre?.trim() || nombre.trim() === p.nombre) return
    setBusy(true)
    try {
      const r = await libraryUpdateMeta(tienda, p.id, { nombre: nombre.trim() })
      say(r.message)
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const onEditRefs = async (p: LibraryPreset) => {
    const refsRaw = window.prompt(
      'Referencias IA (coma). Ej: guitarra ambiental worship, nylon, pad',
      p.generoTags.join(', '),
    )
    if (refsRaw === null) return
    const generoTags = refsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    setBusy(true)
    try {
      const r = await libraryUpdateMeta(tienda, p.id, {
        generoTags,
        notas: generoTags.length ? `refs: ${generoTags.join(', ')}` : p.notas,
      })
      say(r.message)
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const onApply = async (p: LibraryPreset) => {
    if (!selectedTrackId) {
      say('Selecciona la pista destino')
      return
    }
    setBusy(true)
    try {
      const r = await libraryApplyPreset(tienda, { presetId: p.id, trackId: selectedTrackId })
      say(r.message)
    } finally {
      setBusy(false)
    }
  }

  const onAudition = async (p: LibraryPreset) => {
    setBusy(true)
    try {
      const r = await libraryAuditionPreset(tienda, { presetId: p.id, bars: 2 })
      say(r.message)
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (p: LibraryPreset) => {
    if (!window.confirm(`¿Eliminar config «${p.nombre}»?`)) return
    setBusy(true)
    try {
      await libraryDeletePreset(tienda, p.id, p.scope === 'global' ? 'global' : 'project')
      say(`Eliminada «${p.nombre}»`)
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const onPromote = async (p: LibraryPreset) => {
    if (p.scope === 'global') return
    setBusy(true)
    try {
      const r = await libraryPromoteToGlobal(tienda, p.id)
      say(r.message)
      refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Guarda el <span className="text-foreground">estado completo</span> del VST con un{' '}
          <span className="text-foreground">nombre libre</span> (ej. «guitarra ambiental worship»).
          La IA busca por ese nombre, refs y <code className="text-[9px]">presetId</code>.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={busy || !selectedTrackId}
            onClick={() => void onSave(false)}
            className="inline-flex items-center gap-1 rounded-md bg-accent-amber/20 px-2 py-1 text-[10px] font-semibold text-accent-amber hover:bg-accent-amber/30 disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
            Guardar de pista
          </button>
          <button
            type="button"
            disabled={busy || !selectedTrackId}
            onClick={() => void onSave(true)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <Globe className="size-3" />
            Guardar global
          </button>
        </div>
        {selectedTrackName ? (
          <p className="truncate text-[10px] text-muted-foreground">
            Pista: <span className="text-foreground">{selectedTrackName}</span>
            {selectedPluginName ? (
              <>
                {' '}
                · VST <span className="text-foreground">{selectedPluginName}</span>
              </>
            ) : (
              ' · sin VST en la pista'
            )}
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Selecciona una pista con el VST ya cargado y configurado.
          </p>
        )}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar config, plugin, rol…"
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground"
        />
        {localMsg ? <p className="text-[10px] text-accent-amber">{localMsg}</p> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">
            Aún no hay configs. Configura DecentSampler (u otro VST) en una pista y pulsa{' '}
            <strong>Guardar de pista</strong>.
          </div>
        ) : (
          groups.map(([plugin, items]) => (
            <div key={plugin} className="border-b border-border/60">
              <div className="sticky top-0 z-10 bg-panel px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {plugin} · {items.length}
              </div>
              {items.map((p) => {
                const defaultRoles = rolesWherePresetIsDefault(p.id)
                const aiOn = !prefs.aiDisabledIds.includes(p.pluginId)
                return (
                  <div
                    key={p.id}
                    className={`flex items-start gap-2 border-b border-border/30 px-3 py-2 ${aiOn ? '' : 'opacity-50'}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          title="Renombrar (la IA busca por este nombre)"
                          onClick={() => void onRename(p)}
                          className="truncate text-left text-[12px] font-medium text-foreground hover:underline"
                        >
                          {p.nombre}
                        </button>
                        {p.scope === 'global' ? (
                          <span className="rounded bg-panel-raised px-1 text-[9px] text-muted-foreground">
                            global
                          </span>
                        ) : null}
                        {p.rol ? (
                          <span className="rounded bg-panel-raised px-1 text-[9px] text-muted-foreground">
                            {INSTRUMENT_ROLE_LABELS[p.rol as InstrumentRole] ?? p.rol}
                          </span>
                        ) : null}
                        {defaultRoles.map((r) => (
                          <span
                            key={r}
                            className="inline-flex items-center gap-0.5 rounded bg-accent-amber/20 px-1 text-[9px] text-accent-amber"
                          >
                            <Star className="size-2.5 fill-current" />
                            {INSTRUMENT_ROLE_LABELS[r]}
                          </span>
                        ))}
                        {!p.estadoPluginBase64 ? (
                          <span className="text-[9px] text-destructive">sin estado</span>
                        ) : null}
                      </div>
                      {p.generoTags.length > 0 ? (
                        <p className="truncate text-[9px] text-muted-foreground" title={p.generoTags.join(', ')}>
                          refs: {p.generoTags.join(' · ')}
                        </p>
                      ) : null}
                      <p className="truncate font-mono text-[9px] text-muted-foreground" title={p.id}>
                        presetId={p.id}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <label className="flex items-center gap-1 text-[9px] text-muted-foreground">
                          Default IA
                          <select
                            className="max-w-[120px] rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground"
                            value={defaultRoles[0] ?? ''}
                            onChange={(e) => {
                              const next = e.target.value as InstrumentRole | ''
                              if (!next) {
                                for (const r of defaultRoles) setRoleDefault(r, null)
                                say(`Sin default para «${p.nombre}»`)
                                return
                              }
                              setRoleDefault(next, {
                                pluginId: p.pluginId,
                                pluginNombre: p.pluginNombre,
                                presetId: p.id,
                                presetNombre: p.nombre,
                              })
                              say(`Default ${INSTRUMENT_ROLE_LABELS[next]} → ${p.nombre}`)
                            }}
                          >
                            <option value="">—</option>
                            {ASSIGNABLE_INSTRUMENT_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {INSTRUMENT_ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onEditRefs(p)}
                          className="rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                        >
                          Refs
                        </button>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        disabled={busy || !selectedTrackId}
                        onClick={() => void onApply(p)}
                        className="rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                      >
                        Aplicar
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onAudition(p)}
                        className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                      >
                        <Play className="size-2.5" />
                        Oír
                      </button>
                      {p.scope !== 'global' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onPromote(p)}
                          className="rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                          title="Promover a global"
                        >
                          <Globe className="size-2.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onDelete(p)}
                        className="rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-destructive disabled:opacity-40"
                      >
                        <Trash2 className="size-2.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
