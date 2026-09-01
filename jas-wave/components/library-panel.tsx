import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Download,
  Globe,
  Library,
  Loader2,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
  ArrowUpCircle,
  Sparkles,
} from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import { getSelectedClipId, getSelectedTrackId } from '@/src/lib/selection-helpers'
import {
  deleteLibraryPreset,
  listLibraryPresets,
  type LibraryPreset,
} from '@/src/lib/library/preset-catalog'
import {
  libraryApplyPreset,
  libraryAuditionPreset,
  libraryDeletePreset,
  libraryImportGlobalPreset,
  libraryList,
  libraryPromoteToGlobal,
  librarySaveFromTrack,
} from '@/src/lib/library/ops'
import { exportGlobalPreset } from '@/src/lib/library/global-preset-catalog'
import { styleApplyToClip, styleList } from '@/src/lib/styles/ops'
import type { StyleProfile } from '@/src/lib/styles/types'

type LibraryTab = 'project' | 'global' | 'styles'

/**
 * Biblioteca del proyecto + global: presets VST y perfiles de estilo.
 */
export function LibraryPanel() {
  const tienda = useDAW()
  const projectId = useDAWState((s: DAWState) => s.project?.id ?? 'default')
  const projectRuta = useDAWState((s: DAWState) => s.project?.ruta)
  const selectedTrackId = useDAWState((s: DAWState) => getSelectedTrackId(s))
  const selectedClipId = useDAWState((s: DAWState) => getSelectedClipId(s))
  const [tab, setTab] = useState<LibraryTab>('project')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [tick, setTick] = useState(0)
  const [globalPresets, setGlobalPresets] = useState<LibraryPreset[]>([])
  const [styles, setStyles] = useState<StyleProfile[]>([])

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    void (async () => {
      const list = await libraryList(tienda, 'global')
      setGlobalPresets(list)
      const st = await styleList(tienda, 'all')
      setStyles(st)
    })()
  }, [tienda, tick])

  const presets = useMemo(() => {
    void tick
    const all = tab === 'global' ? globalPresets : listLibraryPresets(projectId)
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((p) =>
      `${p.nombre} ${p.pluginNombre} ${p.rol ?? ''} ${p.generoTags.join(' ')}`.toLowerCase().includes(q),
    )
  }, [projectId, query, tick, tab, globalPresets])

  const filteredStyles = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return styles
    return styles.filter((p) =>
      `${p.nombre} ${p.rol} ${p.feel} ${p.tags.join(' ')} ${p.summaryText}`.toLowerCase().includes(q),
    )
  }, [styles, query])

  const onSave = useCallback(
    async (global: boolean) => {
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
          global,
        })
        setMsg(r.message)
        refresh()
      } finally {
        setBusy(false)
      }
    },
    [refresh, selectedTrackId, tienda],
  )

  const onApplyStyle = useCallback(
    async (p: StyleProfile) => {
      if (!selectedTrackId || !selectedClipId) {
        setMsg('Selecciona un clip MIDI destino')
        return
      }
      setBusy(true)
      setMsg('')
      try {
        const r = await styleApplyToClip(tienda, {
          profileId: p.id,
          pistaId: selectedTrackId,
          clipId: selectedClipId,
          replace: true,
        })
        setMsg(r.message)
      } finally {
        setBusy(false)
      }
    },
    [selectedClipId, selectedTrackId, tienda],
  )

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
      if ((p.type ?? 'plugin') === 'fxChain') {
        setMsg('Audición no disponible para cadenas FX')
        return
      }
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
      if (tab === 'global' || p.scope === 'global') {
        await libraryDeletePreset(tienda, p.id, 'global')
      } else {
        await deleteLibraryPreset(projectId, p.id, projectRuta)
      }
      refresh()
      setMsg(`Eliminado «${p.nombre}»`)
    },
    [projectId, projectRuta, refresh, tab, tienda],
  )

  const onPromote = useCallback(
    async (p: LibraryPreset) => {
      setBusy(true)
      setMsg('')
      try {
        const r = await libraryPromoteToGlobal(tienda, p.id)
        setMsg(r.message)
        refresh()
      } finally {
        setBusy(false)
      }
    },
    [refresh, tienda],
  )

  const onExport = useCallback(
    async (p: LibraryPreset) => {
      if (p.scope !== 'global' && tab !== 'global') {
        const json = JSON.stringify(p, null, 2)
        await navigator.clipboard.writeText(json)
        setMsg(`JSON copiado al portapapeles («${p.nombre}»)`)
        return
      }
      const json = await exportGlobalPreset(p.id)
      if (!json) {
        setMsg('No se pudo exportar')
        return
      }
      await navigator.clipboard.writeText(json)
      setMsg(`JSON global copiado («${p.nombre}»)`)
    },
    [tab],
  )

  const onImport = useCallback(async () => {
    const json = window.prompt('Pega el JSON del preset a importar (biblioteca global):')
    if (!json?.trim()) return
    setBusy(true)
    setMsg('')
    try {
      const r = await libraryImportGlobalPreset(json.trim())
      setMsg(r.message)
      if (r.ok) refresh()
    } finally {
      setBusy(false)
    }
  }, [refresh])

  return (
    <div className="flex h-full flex-col bg-panel text-foreground">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Library className="size-4 text-muted-foreground" />
        <span className="text-[13px] font-semibold">Biblioteca</span>
        {busy ? <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" /> : null}
      </div>
      <div className="flex border-b border-border">
        <button
          type="button"
          className={`flex-1 px-3 py-1.5 text-[11px] ${tab === 'project' ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}
          onClick={() => setTab('project')}
        >
          Proyecto
        </button>
        <button
          type="button"
          className={`flex flex-1 items-center justify-center gap-1 px-3 py-1.5 text-[11px] ${tab === 'global' ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}
          onClick={() => setTab('global')}
        >
          <Globe className="size-3" />
          Global
        </button>
        <button
          type="button"
          className={`flex flex-1 items-center justify-center gap-1 px-3 py-1.5 text-[11px] ${tab === 'styles' ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}
          onClick={() => setTab('styles')}
        >
          <Sparkles className="size-3" />
          Estilos
        </button>
      </div>
      <p className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        {tab === 'styles'
          ? 'Perfiles de estilo (recetas, no MIDI crudo). Guardá desde el piano roll; aplicá a un clip para variar.'
          : tab === 'global'
            ? 'Presets cross-proyecto en userData. La IA los referencia por presetId.'
            : 'Presets del proyecto (.jaswave/library/instruments.json). Promueve a Global para reutilizar.'}
      </p>
      <div className="flex gap-2 border-b border-border px-3 py-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-[12px]"
            placeholder={tab === 'styles' ? 'Buscar estilo, rol, tag…' : 'Buscar preset, plugin, género…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {tab !== 'styles' ? (
          <>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-[11px] hover:bg-muted disabled:opacity-50"
              onClick={() => void onSave(tab === 'global')}
              disabled={busy || !selectedTrackId}
              title="Guardar VST de la pista seleccionada"
            >
              <Plus className="size-3.5" />
              Guardar
            </button>
            {tab === 'global' ? (
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-md border border-border px-2 text-[11px] hover:bg-muted"
                onClick={() => void onImport()}
                disabled={busy}
                title="Importar JSON"
              >
                <Upload className="size-3.5" />
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {msg ? (
        <div className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">{msg}</div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === 'styles' ? (
          filteredStyles.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-[12px] text-muted-foreground">
              <Sparkles className="size-8 opacity-40" />
              <p>Sin estilos. En el piano roll: «Guardar como estilo…».</p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {filteredStyles.map((p) => (
                <li key={p.id} className="rounded-md border border-border bg-background/60 px-2.5 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium">{p.nombre}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {p.rol} · {p.feel} · {p.bpm} BPM · {p.scope}
                      </div>
                      {p.tags.length ? (
                        <div className="mt-1 text-[10px] text-muted-foreground">{p.tags.join(' · ')}</div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="rounded border border-border px-1.5 text-[10px] hover:bg-muted"
                      disabled={busy || !selectedTrackId || !selectedClipId}
                      onClick={() => void onApplyStyle(p)}
                    >
                      Aplicar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : presets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-[12px] text-muted-foreground">
            <Library className="size-8 opacity-40" />
            <p>
              {tab === 'global'
                ? 'Sin presets globales. Guarda desde una pista o importa JSON.'
                : 'Sin presets aún. Carga un VST, ajústalo y pulsa Guardar.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {presets.map((p) => (
              <li key={p.id} className="rounded-md border border-border bg-background/60 px-2.5 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium">{p.nombre}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {p.pluginNombre}
                      {p.rol ? ` · ${p.rol}` : ''}
                      {p.type === 'fxChain' ? ' · fxChain' : ''}
                      {p.probeOk === false ? ' · probe✗' : p.probeOk ? ' · probe✓' : ''}
                    </div>
                    {p.generoTags.length ? (
                      <div className="mt-1 text-[10px] text-muted-foreground">{p.generoTags.join(' · ')}</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {(p.type ?? 'plugin') !== 'fxChain' ? (
                      <button
                        type="button"
                        className="rounded border border-border p-1 hover:bg-muted"
                        title="Probar"
                        disabled={busy}
                        onClick={() => void onAudition(p)}
                      >
                        <Play className="size-3.5" />
                      </button>
                    ) : null}
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
                      className="rounded border border-border p-1 hover:bg-muted"
                      title="Exportar JSON"
                      onClick={() => void onExport(p)}
                    >
                      <Download className="size-3.5" />
                    </button>
                    {tab === 'project' ? (
                      <button
                        type="button"
                        className="rounded border border-border p-1 hover:bg-muted"
                        title="Promover a global"
                        onClick={() => void onPromote(p)}
                      >
                        <ArrowUpCircle className="size-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded border border-border p-1 hover:bg-destructive/15"
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
