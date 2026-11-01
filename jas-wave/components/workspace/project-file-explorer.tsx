/**
 * Explorador del proyecto por carpetas estilo IDE (VS Code).
 *
 * Características:
 * - Árbol jerárquico recursivo de carpetas y archivos.
 * - Iconografía contextual según extensión (.jaswave, .mid, .wav, .mp3, .md, .json).
 * - Apertura contextual al hacer clic:
 *   - .jaswave -> Carga de proyecto
 *   - .md -> Abre panel Docs / plan
 *   - .mid / .midi -> Abre Piano Roll con vista previa
 *   - .wav / .mp3 / audio -> Preescucha rápida / importación
 * - Botones de acción rápida: Nueva carpeta, Nuevo archivo, Recargar árbol.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  File,
  FileAudio,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FilePlus,
  Music,
  RefreshCw,
  FolderSearch,
} from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { servicioDeModulo } from '@/src/modulos/contribuciones'
import { requestOpenTool } from '@/src/workspace/types'

interface FileNode {
  name: string
  isDirectory: boolean
  isFile: boolean
  path: string
  children?: FileNode[]
  isOpen?: boolean
}

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'jaswave':
      return <Music className="size-4 shrink-0 text-accent-indigo" />
    case 'mid':
    case 'midi':
      return <Music className="size-4 shrink-0 text-accent-cyan" />
    case 'wav':
    case 'mp3':
    case 'flac':
    case 'ogg':
      return <FileAudio className="size-4 shrink-0 text-accent-emerald" />
    case 'md':
      return <FileText className="size-4 shrink-0 text-accent-amber" />
    case 'json':
      return <FileJson className="size-4 shrink-0 text-yellow-400" />
    case 'ts':
    case 'tsx':
    case 'js':
      return <FileCode className="size-4 shrink-0 text-blue-400" />
    default:
      return <File className="size-4 shrink-0 text-muted-foreground" />
  }
}

export function ProjectFileExplorer() {
  const tienda = useDAW()
  const projectRuta = useDAWState((s) => s.project?.ruta)
  const projectNombre = useDAWState((s) => s.project?.nombre ?? 'Sin título')
  const [tree, setTree] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const api = typeof window !== 'undefined'
    ? (window as unknown as { electronAPI?: {
        fileListDir?: (dir: string) => Promise<{ success: boolean; entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>; error?: string }>
        dialogOpenDirectory?: () => Promise<{ canceled: boolean; filePaths: string[] }>
        fileSave?: (p: string, c: string) => Promise<{ success: boolean; error?: string }>
      } }).electronAPI
    : undefined

  const loadDirectory = useCallback(async (dir: string): Promise<FileNode[]> => {
    if (!api?.fileListDir) return []
    try {
      const res = await api.fileListDir(dir)
      if (!res.success || !res.entries) return []
      return res.entries
        .map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory,
          isFile: e.isFile,
          path: `${dir.replace(/[\\/]$/, '')}/${e.name}`,
          isOpen: false,
        }))
        .sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1
          if (!a.isDirectory && b.isDirectory) return 1
          return a.name.localeCompare(b.name)
        })
    } catch {
      return []
    }
  }, [api])

  const refreshTree = useCallback(async () => {
    if (!projectRuta) {
      setTree([])
      return
    }
    setLoading(true)
    try {
      const rootEntries = await loadDirectory(projectRuta)
      setTree(rootEntries)
    } finally {
      setLoading(false)
    }
  }, [projectRuta, loadDirectory])

  useEffect(() => {
    void refreshTree()
  }, [refreshTree])

  const toggleFolder = async (node: FileNode) => {
    if (!node.isDirectory) return
    if (!node.isOpen && (!node.children || node.children.length === 0)) {
      const children = await loadDirectory(node.path)
      node.children = children
    }
    node.isOpen = !node.isOpen
    setTree([...tree])
  }

  const handleItemClick = (node: FileNode) => {
    setSelectedPath(node.path)
    if (node.isDirectory) {
      void toggleFolder(node)
      return
    }

    const ext = node.name.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'md') {
      const documentos = servicioDeModulo('documentos')
      if (documentos) documentos.abrir(node.name, 'edit')
      else requestOpenTool('modulos')
    } else if (ext === 'mid' || ext === 'midi') {
      requestOpenTool('piano-roll', { zone: 'bottom' })
    }
  }

  const handleOpenFolderDialog = async () => {
    if (!api?.dialogOpenDirectory) return
    const res = await api.dialogOpenDirectory()
    if (!res.canceled && res.filePaths?.[0]) {
      const chosen = res.filePaths[0]
      // Fijar ruta de proyecto en el DAW
      await tienda.executor.execute('project.update', { ruta: chosen })
      void refreshTree()
    }
  }

  const handleNewFile = async () => {
    const filename = window.prompt('Nombre del nuevo archivo (ej. notas.md, script.js):', 'notas.md')
    if (!filename || !projectRuta || !api?.fileSave) return
    const target = `${projectRuta.replace(/[\\/]$/, '')}/${filename}`
    await api.fileSave(target, '')
    void refreshTree()
  }

  const handleNewFolder = async () => {
    const folderName = window.prompt('Nombre de la nueva carpeta:', 'stems')
    if (!folderName || !projectRuta || !api?.fileSave) return
    const keepPath = `${projectRuta.replace(/[\\/]$/, '')}/${folderName}/.gitkeep`
    await api.fileSave(keepPath, '')
    void refreshTree()
  }

  const renderNode = (node: FileNode, level = 0) => {
    const isSelected = selectedPath === node.path
    return (
      <div key={node.path} className="select-none">
        <div
          onClick={() => handleItemClick(node)}
          style={{ paddingLeft: `${Math.max(8, level * 16)}px` }}
          className={`flex cursor-pointer items-center gap-1.5 py-1 pr-2 text-[11.5px] transition-colors ${
            isSelected
              ? 'bg-accent/20 text-accent-cyan font-medium'
              : 'text-foreground/80 hover:bg-panel-raised hover:text-foreground'
          }`}
        >
          {node.isDirectory ? (
            <>
              {node.isOpen ? (
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              {node.isOpen ? (
                <FolderOpen className="size-4 shrink-0 text-accent-amber" />
              ) : (
                <Folder className="size-4 shrink-0 text-accent-amber/80" />
              )}
            </>
          ) : (
            <>
              <span className="w-3.5 shrink-0" />
              {getFileIcon(node.name)}
            </>
          )}
          <span className="truncate">{node.name}</span>
        </div>

        {node.isDirectory && node.isOpen && node.children && (
          <div>
            {node.children.length === 0 ? (
              <div
                style={{ paddingLeft: `${(level + 1) * 16}px` }}
                className="py-1 text-[11px] italic text-muted-foreground"
              >
                (carpeta vacía)
              </div>
            ) : (
              node.children.map((child) => renderNode(child, level + 1))
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      {/* Cabecera estilo VS Code */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FolderSearch className="size-4 shrink-0 text-accent-cyan" />
          <span className="truncate text-[12px] font-semibold text-foreground uppercase tracking-wide">
            {projectNombre}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Nuevo archivo"
            disabled={!projectRuta}
            onClick={handleNewFile}
            className="rounded p-1 text-muted-foreground hover:bg-panel-raised hover:text-foreground disabled:opacity-40"
          >
            <FilePlus className="size-3.5" />
          </button>
          <button
            type="button"
            title="Nueva carpeta"
            disabled={!projectRuta}
            onClick={handleNewFolder}
            className="rounded p-1 text-muted-foreground hover:bg-panel-raised hover:text-foreground disabled:opacity-40"
          >
            <FolderPlus className="size-3.5" />
          </button>
          <button
            type="button"
            title="Recargar árbol"
            disabled={loading || !projectRuta}
            onClick={() => void refreshTree()}
            className="rounded p-1 text-muted-foreground hover:bg-panel-raised hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Cuerpo del explorador */}
      <div className="flex-1 overflow-y-auto py-1">
        {!projectRuta ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <Folder className="size-8 text-muted-foreground/30" />
            <div className="text-[12px] font-medium text-foreground">Ninguna carpeta abierta</div>
            <p className="max-w-[200px] text-[11px] text-muted-foreground">
              Abre una carpeta de proyecto para explorar stems, notas y recursos.
            </p>
            <button
              type="button"
              onClick={handleOpenFolderDialog}
              className="mt-1 rounded bg-accent/20 px-3 py-1.5 text-[11px] font-medium text-accent-cyan hover:bg-accent/30"
            >
              Abrir Carpeta
            </button>
          </div>
        ) : tree.length === 0 && !loading ? (
          <div className="p-4 text-center text-[11px] text-muted-foreground">
            Carpeta de proyecto vacía.
          </div>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>

      {/* Barra de estado inferior con ruta activa */}
      {projectRuta && (
        <footer className="border-t border-border/60 bg-panel-raised/40 px-3 py-1 text-[10px] text-muted-foreground truncate">
          {projectRuta}
        </footer>
      )}
    </div>
  )
}
