/**
 * Módulos del DAW: los instalados (escritorio) o disponibles (web) y su estado. Activar descarga y
 * carga el módulo; desactivar quita sus herramientas y contribuciones sin tocar el proyecto ni el audio.
 * La instalación desde el catálogo firmado está en CatalogoModulos.
 */

import { Boxes, Loader2, RefreshCw } from 'lucide-react'
import { cargarModulo, fijarModuloActivo, listarModulos } from '@/src/modulos/registro-modulos'
import { useVersionModulos } from '@/src/modulos/use-modulos'
import { TOOL_CATALOG, requestOpenTool } from '@/src/workspace/types'
import { Aviso, Boton, Seccion } from '@/components/cuenta/ui'
import { CatalogoModulos } from './catalogo-modulos'

export function PanelModulos() {
  useVersionModulos()
  const modulos = listarModulos()

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto bg-panel p-3" data-testid="panel-modulos">
      <header className="flex items-center gap-2">
        <Boxes className="size-4 text-accent-amber" />
        <h2 className="text-[13px] font-semibold text-foreground">Módulos</h2>
      </header>
      <Aviso>
        El núcleo del DAW (arreglo, mezclador, piano roll, plugins) siempre está disponible. Los módulos son paquetes
        independientes que se descargan, verifican y cargan cuando los instalas o activas.
      </Aviso>
      {!modulos.length ? <Aviso>No hay módulos instalados.</Aviso> : null}
      {modulos.map((m) => (
        <Seccion
          key={m.fuente.id}
          titulo={`${m.fuente.nombre} · v${m.fuente.version}`}
          acciones={
            <label className="flex items-center gap-1.5 text-[11px] text-foreground">
              <input
                type="checkbox"
                role="switch"
                aria-label={`Activar ${m.fuente.nombre}`}
                checked={m.activo}
                onChange={(e) => fijarModuloActivo(m.fuente.id, e.target.checked)}
              />
              {m.activo ? 'Activo' : 'Inactivo'}
            </label>
          }
        >
          <p className="text-[11px] text-muted-foreground">{m.fuente.descripcion}</p>
          {m.herramientas.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {m.herramientas.map((h) =>
                TOOL_CATALOG[h] ? (
                  <Boton key={h} onClick={() => requestOpenTool(h)} title={TOOL_CATALOG[h].description}>
                    {TOOL_CATALOG[h].title}
                  </Boton>
                ) : null,
              )}
            </div>
          ) : null}
          {m.activo ? (
            m.estado === 'descargando' ? (
              <Aviso>
                <Loader2 className="mr-1 inline size-3 animate-spin" />
                Cargando…
              </Aviso>
            ) : m.estado === 'error' ? (
              <div className="flex items-center gap-2">
                <Aviso tipo="error">No se pudo cargar: {m.error}</Aviso>
                <Boton onClick={() => void cargarModulo(m.fuente.id).catch(() => {})}>
                  <RefreshCw className="mr-1 inline size-3" />
                  Reintentar
                </Boton>
              </div>
            ) : m.estado === 'listo' ? (
              <Aviso tipo="ok">Cargado.</Aviso>
            ) : null
          ) : null}
        </Seccion>
      ))}
      <CatalogoModulos />
    </div>
  )
}
