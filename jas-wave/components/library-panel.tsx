import { useCallback, useMemo, useState } from 'react'
import { Library, Loader2, Play, Plus, Search, Trash2 } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'
import {
  deleteLibraryPreset,
  listLibraryPresets,
  type LibraryPreset,
} from '@/src/lib/library/preset-catalog'
import {
  libraryApplyPreset,
  libraryAuditionPreset,
  librarySaveFromTrack,
} from '@/src/lib/library/ops'

/**
 * Biblioteca del proyecto: presets VST con estado guardado (audicionables).
 */
export function LibraryPanel() {
  const tienda = useDAW()
  const projectId = useDAWState((s: DAWState) => s.project?.id ?? 'default')
  const projectRuta = useDAWState((s: DAWState) => s.project?.ruta)
  const selectedTrackId = useDAWState((s: DAWState) => getSelectedTrackId(s))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [tick, setTick] = useState(0)

  const presets = useMemo(() => {
    void tick
    const all = listLibraryPresets(projectId)
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((p) =>
      `${p.nombre} ${p.pluginNombre} ${p.rol ?? ''} ${p.generoTags.join(' ')}`.toLowerCase().includes(q),
    )
  }, [projectId, query, tick])

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  const onSave = useCallback(async () => {
    if (!selectedTrackId) {
      setMsg('Selecciona una pista con VST')
      return
    }
    const nombre = window.prompt('Nombre del preset en la biblioteca:')
    if (!nombre?.trim()) return
    setBusy(true)
    setMsg('')
    try {
      const tagsRaw = window.prompt('Tags de género (separados por coma, opcional):') ?? ''
      const generoTags = tagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const rol = window.prompt('Rol (drums/bass/pad/keys…, opcional):') ?? undefined
      const r = await librarySaveFromTrack(tienda, {
        trackId: selectedTrackId,
        nombre: nombre.trim(),
        rol: rol?.trim() || undefined,
        generoTags,
      })
      setMsg(r.message)
      refresh()
    } finally {
      setBusy(false)
    }
  }, [refresh, selectedTrackId, tienda])

  const onApply = useCallback(
    async (p: LibraryPreset) => {
      if (!selectedTrackId) {
        setMsg('Selecciona la pista destino')
        return
      }
      setBusy(true)
      setMsg('')
      try {
        const r = await libraryApplyPreset(tienda, { presetId: p.id, trackId: selectedTrackId })
        setMsg(r.message)
      } finally {
        setBusy(false)
      }
    },
    [selectedTrackId, tienda],
  )

  const onAudition = useCallback(
    async (p: LibraryPreset) => {
      setBusy(true)
      setMsg('')
      try {
        const r = await libraryAuditionPreset(tienda, { presetId: p.id, bars: 2 })
        setMsg(r.message)
      } finally {
        setBusy(false)
      }
    },
    [tienda],
  )

  const onDelete = useCallback(
    async (p: LibraryPreset) => {
      if (!window.confirm(`¿Eliminar preset «${p.nombre}»?`)) return
      await deleteLibraryPreset(projectId, p.id, projectRuta)
      refresh()
      setMsg(`Eliminado «${p.nombre}»`)
    },
    [projectId, projectRuta, refresh],
  )

  return (
    <div className="flex h-full flex-col bg-panel text-foreground">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Library className="size-4 text-muted-foreground" />
        <span className="text-[13px] font-semibold">Biblioteca del proyecto</span>
        {busy ? <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" /> : null}
      </div>
      <p className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        Guarda el estado real del VST (patch) para reutilizarlo y que la IA elija sonidos por género/rol.
      </p>
      <div className="flex gap-2 border-b border-border px-3 py-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-[12px]"
            placeholder="Buscar preset, plugin, género…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-[11px] hover:bg-muted disabled:opacity-50"
          onClick={() => void onSave()}
          disabled={busy || !selectedTrackId}
          title="Guardar VST de la pista seleccionada"
        >
          <Plus className="size-3.5" />
          Guardar
        </button>
      </div>
      {msg ? (
        <div className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">{msg}</div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {presets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-[12px] text-muted-foreground">
            <Library className="size-8 opacity-40" />
            <p>Sin presets aún. Carga un VST en una pista, ajústalo y pulsa Guardar.</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {presets.map((p) => (
              <li
                key={p.id}
                className="rounded-md border border-border bg-background/60 px-2.5 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium">{p.nombre}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {p.pluginNombre}
                      {p.rol ? ` · ${p.rol}` : ''}
                      {p.probeOk === false ? ' · probe✗' : p.probeOk ? ' · probe✓' : ''}
                    </div>
                    {p.generoTags.length ? (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {p.generoTags.join(' · ')}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="rounded border border-border p-1 hover:bg-muted"
                      title="Probar"
                      disabled={busy}
                      onClick={() => void onAudition(p)}
                    >
                      <Play className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded border border-border px-1.5 text-[10px] hover:bg-muted"
                      disabled={busy || !selectedTrackId}
                      onClick={() => void onApply(p)}
                    >
                      Aplicar
                    </button>
                    <button
                      type="button"
                      className="rounded border border-border p-1 text-muted-foreground hover:bg-muted"
                      title="Eliminar"
                      onClick={() => void onDelete(p)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
