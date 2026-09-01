import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getActiveProvider,
  listCatalogModels,
  loadAiSettings,
  saveAiSettings,
  selectCatalogModel,
  type AiSettings,
} from '@/src/lib/ai-settings'
import { requestOpenTool } from '@/src/workspace/types'

/**
 * Selector del catálogo unificado (proveedor · modelo).
 * Incluye reintento automático con otros modelos si el activo falla.
 */
export function AiModelPicker({ compact = false }: { compact?: boolean }) {
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings())

  const reload = useCallback(() => {
    setSettings(loadAiSettings())
  }, [])

  useEffect(() => {
    const onChange = () => reload()
    window.addEventListener('jaswave-ai-settings-changed', onChange)
    return () => window.removeEventListener('jaswave-ai-settings-changed', onChange)
  }, [reload])

  const active = useMemo(() => getActiveProvider(settings), [settings])
  const catalog = useMemo(() => listCatalogModels(settings), [settings])
  const activeKey = `${active.id}::${active.selectedModel}`

  const persist = (next: AiSettings) => {
    setSettings(next)
    saveAiSettings(next)
    window.dispatchEvent(new CustomEvent('jaswave-ai-settings-changed'))
  }

  const selectClass =
    'max-w-full truncate rounded-md border border-border bg-panel-raised px-1.5 py-1 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber'

  return (
    <div
      className={`flex min-w-0 flex-wrap items-center gap-1 ${compact ? '' : 'rounded-md border border-border/60 bg-panel-raised/30 px-1.5 py-1'}`}
      title="Elige cualquier modelo del catálogo. Si falla, se reintenta con otros (mismo contexto)."
    >
      <select
        aria-label="Modelo del catálogo"
        value={catalog.some((c) => c.key === activeKey) ? activeKey : catalog[0]?.key ?? ''}
        onChange={(e) => {
          const hit = catalog.find((c) => c.key === e.target.value)
          if (!hit) return
          persist(selectCatalogModel(settings, hit.providerId, hit.model))
        }}
        className={`${selectClass} min-w-0 flex-1`}
      >
        {catalog.length === 0 ? (
          <option value="">Sin modelos — abre Configuración</option>
        ) : (
          catalog.map((c) => (
            <option key={c.key} value={c.key} disabled={!c.ready}>
              {c.healthy ? '● ' : c.ready ? '○ ' : '✕ '}
              {c.label}
              {!c.ready ? ' (falta key/URL)' : ''}
            </option>
          ))
        )}
      </select>
      <label
        className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        title="Si el modelo elegido no responde, probar el siguiente del catálogo con el mismo contexto"
      >
        <input
          type="checkbox"
          className="size-3 accent-accent-amber"
          checked={settings.fallbackEnabled !== false}
          onChange={(e) => persist({ ...settings, fallbackEnabled: e.target.checked })}
        />
        Auto
      </label>
      <button
        type="button"
        title="Abrir configuración de IA / catálogo"
        onClick={() => requestOpenTool('settings', { zone: 'right' })}
        className="shrink-0 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-background hover:text-foreground"
      >
        ···
      </button>
    </div>
  )
}
