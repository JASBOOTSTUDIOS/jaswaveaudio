/**
 * Proyectos del navegador (W1): abrir los guardados en este navegador, importar un `.jaswave` desde
 * disco o exportar el actual. Se abre con el evento `jaswave-abrir-web` (lo dispara abrirProyectoIO
 * cuando no hay Electron).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { FileDown, FileUp, FolderOpen, X } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import { cargarProyectoDesdeRutaIO, confirmarCambiosIO } from '@/src/lib/project-io'
import { FileServiceNavegador, rutaWebPara } from '@/src/lib/web/file-service-navegador'

export const EVENTO_ABRIR_WEB = 'jaswave-abrir-web'

const servicio = () => new FileServiceNavegador()

export function ProyectosWebDialog() {
  const tienda = useDAW()
  const [abierto, setAbierto] = useState(false)
  const [lista, setLista] = useState<Awaited<ReturnType<FileServiceNavegador['listarProyectos']>>>([])
  const [error, setError] = useState<string | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  const recargar = useCallback(async () => {
    try {
      setLista(await servicio().listarProyectos())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    const abrir = () => {
      setAbierto(true)
      setError(null)
      void recargar()
    }
    window.addEventListener(EVENTO_ABRIR_WEB, abrir)
    return () => window.removeEventListener(EVENTO_ABRIR_WEB, abrir)
  }, [recargar])

  const cargar = async (ruta: string) => {
    const confirmado = await confirmarCambiosIO(tienda, 'abrir')
    if (!confirmado.continuar) return
    const r = await cargarProyectoDesdeRutaIO(tienda, ruta)
    if (r.success) setAbierto(false)
    else setError((typeof r.error === 'string' ? r.error : r.error?.message) ?? 'No se pudo abrir el proyecto')
  }

  const importar = async (archivo: File | undefined) => {
    if (!archivo) return
    try {
      const texto = await archivo.text()
      JSON.parse(texto) // el esquema completo lo valida project.load
      const ruta = rutaWebPara(archivo.name.replace(/\.jaswave$/i, ''))
      await servicio().guardar(ruta, texto)
      await cargar(ruta)
    } catch (e) {
      setError(`No se pudo importar: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const exportar = async (ruta: string, nombre: string) => {
    const texto = await servicio().leer(ruta)
    const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${nombre}.jaswave`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!abierto) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-label="Proyectos del navegador">
      <div className="flex max-h-[80vh] w-[440px] flex-col gap-3 rounded-lg border border-border bg-panel p-4">
        <header className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-foreground">Proyectos en este navegador</h2>
          <button aria-label="Cerrar" className="text-muted-foreground hover:text-foreground" onClick={() => setAbierto(false)}>
            <X className="size-4" />
          </button>
        </header>
        {error ? <p role="alert" className="text-[11px] text-red-400">{error}</p> : null}
        <ul className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
          {lista.length === 0 ? <li className="px-3 py-4 text-center text-[11px] text-muted-foreground">Aún no hay proyectos guardados aquí.</li> : null}
          {lista.map((p) => (
            <li key={p.ruta} className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-foreground">{p.nombre}</span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(p.actualizado).toLocaleString()} · {(p.bytes / 1024).toFixed(0)} KB
                </span>
              </span>
              <button aria-label={`Exportar ${p.nombre}`} className="text-muted-foreground hover:text-foreground" onClick={() => void exportar(p.ruta, p.nombre)}>
                <FileDown className="size-3.5" />
              </button>
              <button
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground hover:bg-panel-raised"
                onClick={() => void cargar(p.ruta)}
              >
                <FolderOpen className="size-3.5" /> Abrir
              </button>
            </li>
          ))}
        </ul>
        <input ref={entrada} type="file" accept=".jaswave,application/json" className="hidden" onChange={(e) => void importar(e.target.files?.[0])} />
        <button
          className="flex items-center justify-center gap-1.5 rounded-md bg-accent-amber/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/30"
          onClick={() => entrada.current?.click()}
        >
          <FileUp className="size-3.5" /> Importar .jaswave
        </button>
      </div>
    </div>
  )
}
