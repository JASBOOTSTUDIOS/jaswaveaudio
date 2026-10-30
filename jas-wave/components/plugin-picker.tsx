/**
 * Selector de plugin del catálogo con buscador. Una sola pieza para FX Chain y el inspector de pista.
 */

import { useMemo, useState } from 'react'
import type { PluginDescriptor } from '@/src/lib/plugin/types'

function etiqueta(d: PluginDescriptor): string {
  const formato = d.format === 'vst3' ? ' (VST3)' : d.format === 'vst2' ? ' (VST2)' : ''
  const estado =
    d.format === 'builtin' || d.hostReady ? '' : d.format === 'vst2' ? ' · no hosteable' : ' · pendiente'
  return `${d.name}${formato}${estado}`
}

export function filtrarCatalogo(catalog: PluginDescriptor[], q: string, selectedId?: string): PluginDescriptor[] {
  const t = q.trim().toLowerCase()
  if (!t) return catalog
  return catalog.filter(
    (d) => d.pluginId === selectedId || `${d.name} ${d.category ?? ''} ${d.format}`.toLowerCase().includes(t),
  )
}

export function PluginPicker({
  catalog,
  value,
  onChange,
}: {
  catalog: PluginDescriptor[]
  value: string
  onChange: (pluginId: string) => void
}) {
  const [q, setQ] = useState('')
  const lista = useMemo(() => filtrarCatalogo(catalog, q, value), [catalog, q, value])
  const sinResultados = q.trim() !== '' && lista.length === 0
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {catalog.length > 8 ? (
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            const primero = filtrarCatalogo(catalog, e.target.value)[0]
            if (primero && e.target.value.trim()) onChange(primero.pluginId)
          }}
          placeholder="Buscar plugin…"
          aria-label="Buscar plugin"
          className="rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground"
        />
      ) : null}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Plugin"
        className="min-w-0 rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground"
      >
        {lista.map((d) => (
          <option key={d.pluginId} value={d.pluginId}>
            {etiqueta(d)}
          </option>
        ))}
      </select>
      {sinResultados ? <p className="text-[10px] text-muted-foreground">Ningún plugin coincide con «{q}».</p> : null}
    </div>
  )
}
