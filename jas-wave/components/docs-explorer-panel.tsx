/**
 * Explorador VS Code-like de `{proyecto}/docs/*.md`.
 * Abre tabs de edición/vista en el panel Docs (independiente).
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Eye, FilePlus, FileText, FolderOpen, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useDAWState } from '@/src/context/daw-context'
import {
  PLAN_SLUG,
  bindAgentDocsDisk,
  createAgentDoc,
  deleteAgentDoc,
  docsFolderForProject,
  hydrateAgentDocsFromDisk,
  listAgentDocs,
  listDocsSlugsOnDisk,
  subscribeAgentDocs,
} from '@/src/lib/agent-docs'
import { openDocsTab } from '@/src/lib/docs-editor-store'
import { requestOpenTool } from '@/src/workspace/types'

function useDocs(projectId: string) {
  return useSyncExternalStore(
    subscribeAgentDocs,
    () => listAgentDocs(projectId),
    () => listAgentDocs(projectId),
  )
}

export function DocsExplorerPanel() {
  const projectId = useDAWState((s) => s.project?.id || 'default')
  const projectRuta = useDAWState((s) => s.project?.ruta)
  const docs = useDocs(projectId)
  const [diskSlugs, setDiskSlugs] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      bindAgentDocsDisk(projectId, projectRuta)
      await hydrateAgentDocsFromDisk(projectId, projectRuta)
      setDiskSlugs(await listDocsSlugsOnDisk(projectRuta))
    } finally {
      setBusy(false)
    }
  }, [projectId, projectRuta])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const slugs = (() => {
    const set = new Set([...docs.map((d) => d.slug), ...diskSlugs, PLAN_SLUG])
    return [...set].sort((a, b) => {
      if (a === PLAN_SLUG) return -1
      if (b === PLAN_SLUG) return 1
      return a.localeCompare(b)
    })
  })()

  const folderLabel = projectRuta ? docsFolderForProject(projectRuta) : '(guarda el proyecto para crear /docs)'

  const openInDocs = (slug: string, mode: 'edit' | 'preview') => {
    openDocsTab(slug, mode)
    requestOpenTool('docs', { zone: 'left' })
  }

  const onNew = () => {
    const name = window.prompt('Nombre del documento (.md)', 'notas.md')
    if (!name) return
    const doc = createAgentDoc(projectId, name, `# ${name.replace(/\.md$/i, '')}\n\n`, 'user')
    openInDocs(doc.slug, 'edit')
    void refresh()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-foreground">
          <FolderOpen className="size-3.5 shrink-0 text-accent-amber" />
          Explorador
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="Recargar desde disco"
            disabled={busy}
            onClick={() => void refresh()}
            className="rounded p-1 text-muted-foreground hover:bg-panel-raised hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            title="Nuevo .md"
            onClick={onNew}
            className="rounded p-1 text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          >
            <FilePlus className="size-3.5" />
          </button>
        </div>
      </header>
      <div className="border-b border-border/60 px-2 py-1 text-[9px] text-muted-foreground" title={folderLabel}>
        <span className="font-mono">docs/</span>
        <span className="ml-1 truncate opacity-70">{projectRuta ? 'en carpeta del proyecto' : 'solo memoria'}</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {slugs.map((slug) => (
          <li key={slug} className="group flex items-center gap-0.5 px-1">
            <button
              type="button"
              title={`Abrir ${slug} (edición)`}
              onClick={() => openInDocs(slug, 'edit')}
              onDoubleClick={() => openInDocs(slug, 'edit')}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] text-foreground hover:bg-panel-raised"
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{slug}</span>
            </button>
            <button
              type="button"
              title="Abrir edición"
              onClick={() => openInDocs(slug, 'edit')}
              className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent-amber/15 hover:text-accent-amber group-hover:opacity-100"
            >
              <Pencil className="size-3" />
            </button>
            <button
              type="button"
              title="Abrir vista previa"
              onClick={() => openInDocs(slug, 'preview')}
              className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent-amber/15 hover:text-accent-amber group-hover:opacity-100"
            >
              <Eye className="size-3" />
            </button>
            {slug !== PLAN_SLUG ? (
              <button
                type="button"
                title="Eliminar"
                onClick={() => {
                  if (window.confirm(`¿Borrar ${slug}?`)) {
                    deleteAgentDoc(projectId, slug)
                    void refresh()
                  }
                }}
                className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="size-3" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
