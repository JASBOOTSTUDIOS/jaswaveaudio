/**
 * Aviso no bloqueante (D1): el proyecto abierto usa plugins JasWave que no están instalados.
 * Se instalan en segundo plano con progreso y se cargan en caliente, sin detener la reproducción.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, PackageCheck, X } from 'lucide-react'
import { useDAWState } from '@/src/context/daw-context'
import { configBackend } from '@/src/lib/backend/config'
import { ensureProjectVstInstruments } from '@/src/lib/plugin/track-vst-runtime'
import { getSharedStore } from '@/src/context/daw-context'
import {
  instalarPlugins,
  pluginsFaltantes,
  puertoEntregaEscritorio,
  type CatalogoPlugins,
  type ProgresoPlugin,
} from '@/src/lib/plugins/entrega'

/** Catálogo firmado (verificado en el proceso main); null si no hay escritorio o servidor. */
export function useCatalogoPlugins(): { catalogo: CatalogoPlugins | null; error: string | null; recargar: () => void } {
  const [catalogo, setCatalogo] = useState<CatalogoPlugins | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  useEffect(() => {
    const pedir = window.electron?.pluginsCatalogo
    if (!pedir) return
    let vivo = true
    pedir(configBackend().apiUrl)
      .then((c) => vivo && (setCatalogo(c), setError(null)))
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      vivo = false
    }
  }, [vuelta])
  return { catalogo, error, recargar: () => setVuelta((v) => v + 1) }
}

export function useProgresoPlugins(): Record<string, ProgresoPlugin> {
  const [progreso, setProgreso] = useState<Record<string, ProgresoPlugin>>({})
  useEffect(
    () => window.electron?.onPluginsProgreso?.((p) => setProgreso((prev) => ({ ...prev, [p.id]: p }))),
    [],
  )
  return progreso
}

/** Recarga los VST del proyecto con los plugins recién instalados (carga en caliente). */
export async function recargarVstDelProyecto(): Promise<void> {
  const st = getSharedStore().obtenerEstado()
  await ensureProjectVstInstruments(st.project.tracks, st.project.master?.plugins)
}

export function PluginsNecesarios() {
  const { catalogo } = useCatalogoPlugins()
  const progreso = useProgresoPlugins()
  // Solo se recalcula al cambiar la lista de plugins del proyecto (no en cada cambio de estado).
  const firma = useDAWState((s) =>
    [...s.project.tracks.flatMap((t) => (t.plugins ?? []).map((p) => p.nombre)), ...(s.project.master?.plugins ?? []).map((p) => p.nombre)].join('|'),
  )
  const [descartado, setDescartado] = useState('')
  const [instalando, setInstalando] = useState(false)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [version, setVersion] = useState(0)

  const faltan = useMemo(
    () => (catalogo ? pluginsFaltantes(getSharedStore().obtenerEstado(), catalogo) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalogo, firma, version],
  )

  const instalar = useCallback(async () => {
    const puerto = puertoEntregaEscritorio(configBackend().apiUrl, recargarVstDelProyecto)
    if (!puerto) return
    setInstalando(true)
    setErrores({})
    const r = await instalarPlugins(
      faltan.map((f) => f.id),
      puerto,
    )
    setErrores(Object.fromEntries(Object.entries(r).filter(([, v]) => !v.ok).map(([id, v]) => [id, v.error ?? 'error'])))
    setInstalando(false)
    setVersion((v) => v + 1)
  }, [faltan])

  if (faltan.length === 0 || descartado === firma) return null

  return (
    <div
      role="status"
      className="fixed bottom-10 right-4 z-50 flex w-80 flex-col gap-2 rounded-lg border border-border bg-panel p-3 shadow-lg"
    >
      <header className="flex items-start gap-2">
        <PackageCheck className="mt-0.5 size-4 shrink-0 text-accent-amber" />
        <p className="min-w-0 flex-1 text-[12px] text-foreground">
          Este proyecto usa {faltan.length === 1 ? 'un plugin JasWave' : `${faltan.length} plugins JasWave`} que no está
          {faltan.length === 1 ? '' : 'n'} instalado{faltan.length === 1 ? '' : 's'}.
        </p>
        <button aria-label="Cerrar aviso" className="text-muted-foreground hover:text-foreground" onClick={() => setDescartado(firma)}>
          <X className="size-3.5" />
        </button>
      </header>
      <ul className="flex flex-col gap-1.5">
        {faltan.map((f) => {
          const p = progreso[f.id]
          const pct = p?.fase === 'descargando' && p.total ? Math.round(((p.recibidos ?? 0) / p.total) * 100) : p?.fase === 'listo' ? 100 : 0
          return (
            <li key={f.id} className="flex flex-col gap-0.5 text-[11px]">
              <span className="flex justify-between gap-2">
                <span className="truncate text-foreground">{f.nombre}</span>
                <span className="shrink-0 text-muted-foreground">{errores[f.id] ? 'error' : p?.fase ?? `${(f.sizeBytes / 1024).toFixed(0)} KB`}</span>
              </span>
              {p && p.fase !== 'error' ? (
                <span className="h-1 overflow-hidden rounded bg-panel-raised">
                  <span className="block h-full bg-accent-amber transition-all" style={{ width: `${pct}%` }} />
                </span>
              ) : null}
              {errores[f.id] ? <span className="text-[10px] text-red-400">{errores[f.id]}</span> : null}
            </li>
          )
        })}
      </ul>
      <button
        disabled={instalando}
        onClick={() => void instalar()}
        className="flex items-center justify-center gap-1.5 rounded-md bg-accent-amber/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/30 disabled:opacity-50"
      >
        <Download className="size-3.5" />
        {instalando ? 'Instalando en segundo plano…' : 'Instalar ahora'}
      </button>
      <p className="text-[10px] text-muted-foreground">La reproducción no se interrumpe; los plugins se activan al terminar.</p>
    </div>
  )
}
