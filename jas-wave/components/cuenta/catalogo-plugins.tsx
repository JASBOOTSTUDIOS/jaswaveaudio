/**
 * Plugins JasWave disponibles (catálogo firmado): instalar o actualizar uno a uno, bajo demanda.
 */

import { useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { configBackend } from '@/src/lib/backend/config'
import { instalarPlugins, puertoEntregaEscritorio, versionInstalada } from '@/src/lib/plugins/entrega'
import { recargarVstDelProyecto, useCatalogoPlugins, useProgresoPlugins } from '@/components/plugins/plugins-necesarios'
import { Aviso, Boton, Seccion } from './ui'

export function CatalogoPluginsCuenta() {
  const { catalogo, error, recargar } = useCatalogoPlugins()
  const progreso = useProgresoPlugins()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [fallos, setFallos] = useState<Record<string, string>>({})
  const [, refrescar] = useState(0)

  if (!window.electron?.pluginsCatalogo) return null

  const instalar = async (id: string) => {
    const puerto = puertoEntregaEscritorio(configBackend().apiUrl, recargarVstDelProyecto)
    if (!puerto) return
    setOcupado(id)
    const r = await instalarPlugins([id], puerto)
    setFallos((f) => ({ ...f, [id]: r[id]?.ok ? '' : r[id]?.error ?? 'error' }))
    setOcupado(null)
    refrescar((v) => v + 1)
  }

  return (
    <Seccion
      titulo="Plugins JasWave"
      acciones={
        <Boton aria-label="Recargar catálogo" onClick={recargar}>
          <RefreshCw className="size-3.5" />
        </Boton>
      }
    >
      {error ? <Aviso tipo="error">No se pudo obtener el catálogo: {error}</Aviso> : null}
      {catalogo && catalogo.paquetes.length === 0 ? <Aviso>No hay plugins publicados.</Aviso> : null}
      <ul className="flex flex-col gap-1.5">
        {catalogo?.paquetes.map((p) => {
          const instalada = versionInstalada(p.id)
          const fase = progreso[p.id]?.fase
          return (
            <li key={p.id} className="flex items-center gap-2 text-[11px]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">{p.nombre}</span>
                <span className="text-[10px] text-muted-foreground">
                  {instalada ? `instalado ${instalada}` : 'no instalado'} · disponible {p.version}
                  {ocupado === p.id && fase ? ` · ${fase}` : ''}
                </span>
                {fallos[p.id] ? <span className="block text-[10px] text-red-400">{fallos[p.id]}</span> : null}
              </span>
              {instalada === p.version ? (
                <span className="text-[10px] text-accent-emerald">al día</span>
              ) : (
                <Boton disabled={ocupado !== null} className="flex items-center gap-1" onClick={() => void instalar(p.id)}>
                  <Download className="size-3" /> {instalada ? 'Actualizar' : 'Instalar'}
                </Boton>
              )}
            </li>
          )
        })}
      </ul>
    </Seccion>
  )
}
