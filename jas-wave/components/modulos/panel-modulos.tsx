/**
 * Módulos del DAW: activar, desactivar y descargar las piezas opcionales (asistente IA, partitura…).
 * Desactivar un módulo cierra sus herramientas; el proyecto y el audio no se ven afectados.
 */

import { Boxes, Download, Loader2 } from 'lucide-react'
import { cargarModulo, estadoCarga, fijarModuloActivo, listarModulos, moduloActivo } from '@/src/modulos/registro-modulos'
import { useVersionModulos } from '@/src/modulos/use-modulos'
import { TOOL_CATALOG, requestOpenTool } from '@/src/workspace/types'
import { Aviso, Boton, Seccion } from '@/components/cuenta/ui'

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
        El núcleo del DAW (arreglo, mezclador, piano roll, plugins) siempre está disponible. Los módulos añaden
        herramientas y se descargan solo cuando los activas.
      </Aviso>
      {modulos.map((m) => {
        const activo = moduloActivo(m.id)
        const carga = estadoCarga(m.id)
        return (
          <Seccion
            key={m.id}
            titulo={`${m.nombre} · v${m.version}`}
            acciones={
              <label className="flex items-center gap-1.5 text-[11px] text-foreground">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`Activar ${m.nombre}`}
                  checked={activo}
                  onChange={(e) => fijarModuloActivo(m.id, e.target.checked)}
                />
                {activo ? 'Activo' : 'Inactivo'}
              </label>
            }
          >
            <p className="text-[11px] text-muted-foreground">{m.descripcion}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {m.herramientas.map((h) => (
                <Boton key={h} disabled={!activo} onClick={() => requestOpenTool(h)} title={TOOL_CATALOG[h].description}>
                  {TOOL_CATALOG[h].title}
                </Boton>
              ))}
            </div>
            {activo ? (
              carga.estado === 'descargando' ? (
                <Aviso>
                  <Loader2 className="mr-1 inline size-3 animate-spin" />
                  Descargando…
                </Aviso>
              ) : carga.estado === 'error' ? (
                <div className="flex items-center gap-2">
                  <Aviso tipo="error">No se pudo descargar: {carga.error}</Aviso>
                  <Boton onClick={() => void cargarModulo(m.id).catch(() => {})}>
                    <Download className="mr-1 inline size-3" />
                    Reintentar
                  </Boton>
                </div>
              ) : carga.estado === 'listo' ? (
                <Aviso tipo="ok">Instalado y cargado.</Aviso>
              ) : (
                <Aviso>Se descargará al abrir una de sus herramientas.</Aviso>
              )
            ) : null}
          </Seccion>
        )
      })}
    </div>
  )
}
