import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getActiveProvider,
  loadAiSettings,
  saveAiSettings,
  PROVIDER_PRESETS,
  type AiSettings,
} from '@/src/lib/ai-settings'
import { requestOpenTool } from '@/src/workspace/types'

/**
 * Selector rápido de proveedor/modelo en el chat (sin abrir Configuración).
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

  const modelOptions = useMemo(() => {
    const set = new Set<string>([
      ...active.models,
      ...PROVIDER_PRESETS[active.kind].suggestedModels,
      active.selectedModel,
    ])
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [active])

  const persist = (next: AiSettings) => {
    setSettings(next)
    saveAiSettings(next)
    window.dispatchEvent(new CustomEvent('jaswave-ai-settings-changed'))
  }

  const selectClass =
    'max-w-full truncate rounded-md border border-border bg-panel-raised px-1.5 py-1 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber'

  return (
    <div
      className={`flex min-w-0 items-center gap-1 ${compact ? '' : 'rounded-md border border-border/60 bg-panel-raised/30 px-1.5 py-1'}`}
      title="Modelos del catálogo conectado a JasWave"
    >
      <select
        aria-label="Proveedor de IA"
        value={settings.activeProviderId}
        onChange={(e) => {
          const id = e.target.value
          const next = { ...settings, activeProviderId: id }
          persist(next)
        }}
        className={`${selectClass} min-w-0 flex-1`}
      >
        {settings.providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({PROVIDER_PRESETS[p.kind].label})
          </option>
        ))}
      </select>
      <select
        aria-label="Modelo"
        value={active.selectedModel}
        onChange={(e) => {
          const model = e.target.value
          const providers = settings.providers.map((p) =>
            p.id === active.id ? { ...p, selectedModel: model } : p,
          )
          persist({ ...settings, providers })
        }}
        className={`${selectClass} min-w-0 flex-[1.4]`}
      >
        {modelOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <button
        type="button"
        title="Abrir configuración de IA"
        onClick={() => requestOpenTool('settings', { zone: 'right' })}
        className="shrink-0 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-background hover:text-foreground"
      >
        ···
      </button>
    </div>
  )
}
