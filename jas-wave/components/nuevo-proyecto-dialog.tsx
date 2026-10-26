import React, { useState, useEffect, useCallback } from 'react'
import { Folder, FolderPlus, Sparkles, AlertCircle, X } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { persistirRutaYGuardar } from '@/src/lib/project-io'

export function NuevoProyectoDialog() {
  const tienda = useDAW()
  const project = useDAWState((s) => s.project)
  const [open, setOpen] = useState(false)
  const [nombre, setNombre] = useState('')
  const [carpetaPadre, setCarpetaPadre] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mensajeContextual, setMensajeContextual] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)

  // Escuchar evento para abrir el diálogo
  useEffect(() => {
    const handleOpen = (e: Event) => {
      const custom = e as CustomEvent<{ mensaje?: string }>
      setMensajeContextual(custom.detail?.mensaje || null)
      setNombre(project.nombre && project.nombre !== 'Sin título' && project.nombre !== 'Proyecto sin nombre' ? project.nombre : 'Mi Proyecto')
      setError(null)
      setOpen(true)
    }

    window.addEventListener('jaswave-nuevo-proyecto', handleOpen)
    return () => window.removeEventListener('jaswave-nuevo-proyecto', handleOpen)
  }, [project.nombre])

  // Obtener carpeta predeterminada al abrir
  useEffect(() => {
    if (!open) return
    void (async () => {
      try {
        const docs = await window.electron?.userDataPath?.()
        if (docs && !carpetaPadre) {
          // Usar carpeta por defecto de proyectos
          setCarpetaPadre(docs.replace(/[/\\]+$/, ''))
        }
      } catch {
        /* best-effort */
      }
    })()
  }, [open, carpetaPadre])

  const examinarCarpeta = useCallback(async () => {
    setError(null)
    try {
      if (window.electron?.dialogOpenDirectory) {
        const res = await window.electron.dialogOpenDirectory()
        if (!res.canceled && res.filePaths?.[0]) {
          setCarpetaPadre(res.filePaths[0])
        }
      } else if (window.electron?.dialogSave) {
        const res = await window.electron.dialogSave(nombre ? `${nombre}.jaswave` : 'Proyecto.jaswave')
        if (!res.canceled && res.filePath) {
          const sep = res.filePath.includes('/') ? '/' : '\\'
          const partes = res.filePath.split(sep)
          partes.pop()
          setCarpetaPadre(partes.join(sep))
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [nombre])

  const sanitizarNombre = (str: string) => {
    return str.replace(/[\\/:*?"<>|]+/g, '').trim()
  }

  const nombreLimpio = sanitizarNombre(nombre)
  const sep = carpetaPadre.includes('/') && !carpetaPadre.includes('\\') ? '/' : '\\'
  const rutaFinal = carpetaPadre && nombreLimpio ? `${carpetaPadre}${sep}${nombreLimpio}.jaswave` : ''

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nombreLimpio) {
      setError('Por favor indica un nombre para el proyecto.')
      return
    }
    if (!carpetaPadre) {
      setError('Debes seleccionar la carpeta destino donde se guardará el proyecto.')
      return
    }
    setCreando(true)
    setError(null)

    try {
      // 1. Ejecutar project.new para reiniciar estado con el nombre elegido
      const resultNew = await tienda.executor.execute('project.new', { nombre: nombreLimpio })
      if (!resultNew.success) {
        throw new Error(resultNew.error?.message || 'Error al inicializar el proyecto')
      }

      // 2. Establecer ruta del proyecto y persistir de inmediato a disco
      const guardado = await persistirRutaYGuardar(tienda, rutaFinal)
      if (!guardado.success) {
        const msg = typeof guardado.error === 'string' ? guardado.error : guardado.error?.message || 'No se pudo guardar el archivo de proyecto en la carpeta seleccionada'
        throw new Error(msg)
      }

      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreando(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border/80 bg-panel shadow-2xl shadow-black/60">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-border/60 bg-panel-raised/50 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-accent-amber/20 text-accent-amber">
              <FolderPlus className="size-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">Crear Nuevo Proyecto</h2>
              <p className="text-[11px] text-muted-foreground">Configura el destino permanente para tus pistas y audios</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-panel hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleCrear} className="space-y-4 p-6">
          {mensajeContextual && (
            <div className="flex items-start gap-2.5 rounded-lg border border-accent-amber/40 bg-accent-amber/10 p-3 text-[12px] text-accent-amber">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{mensajeContextual}</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-[12px] text-destructive">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-foreground flex items-center gap-1.5">
              <span>Nombre del Proyecto</span>
              <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Worship Live 2026, Acústico Piano..."
              className="w-full rounded-lg border border-border bg-panel-raised px-3.5 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-accent-amber focus:outline-none focus:ring-1 focus:ring-accent-amber transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-foreground flex items-center gap-1.5">
              <span>Carpeta de Almacenamiento</span>
              <span className="text-destructive">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={carpetaPadre}
                placeholder="Selecciona una carpeta..."
                className="flex-1 rounded-lg border border-border bg-panel-raised/50 px-3.5 py-2 text-[12px] text-muted-foreground cursor-pointer focus:outline-none"
                onClick={examinarCarpeta}
              />
              <button
                type="button"
                onClick={examinarCarpeta}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-panel-raised px-3.5 py-2 text-[12px] font-medium text-foreground hover:bg-accent-amber/15 hover:border-accent-amber/50 hover:text-accent-amber transition-colors"
              >
                <Folder className="size-3.5" />
                <span>Examinar</span>
              </button>
            </div>
          </div>

          {rutaFinal && (
            <div className="rounded-lg bg-panel-raised/40 border border-border/40 p-3 text-[11px] text-muted-foreground font-mono break-all">
              <span className="text-accent-cyan font-sans font-medium mr-1.5">Ruta del Proyecto:</span>
              {rutaFinal}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-border/60">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={creando}
              className="rounded-lg px-4 py-2 text-[13px] font-medium text-muted-foreground hover:bg-panel-raised hover:text-foreground transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={creando || !nombreLimpio || !carpetaPadre}
              className="flex items-center gap-2 rounded-lg bg-accent-amber px-5 py-2 text-[13px] font-semibold text-black shadow-lg shadow-accent-amber/20 hover:bg-accent-amber/90 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all"
            >
              {creando ? (
                <>
                  <div className="size-3.5 animate-spin rounded-full border-2 border-black border-t-transparent" />
                  <span>Creando proyecto...</span>
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" />
                  <span>Crear y Abrir Proyecto</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
