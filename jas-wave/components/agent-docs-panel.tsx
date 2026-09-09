/**
 * Editor group de Markdown: tabs independientes edit | preview por archivo.
 * Sin explorador embebido (usar panel «Explorador»). Zoom tipográfico Ctrl± con foco.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Eye, FileText, Hammer, Loader2, MessageSquareQuote, PlayCircle, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { DocMarkdown } from '@/components/chat-markdown'
import {
  PLAN_SLUG,
  bindAgentDocsDisk,
  getMarkdownSection,
  hydrateAgentDocsFromDisk,
  listAgentDocs,
  subscribeAgentDocs,
  writeAgentDoc,
  type AgentDoc,
} from '@/src/lib/agent-docs'
import { syncPlanAfterDawChange } from '@/src/lib/agent-plan-eval'
import { executeDawActions, formatActionResultsForUser } from '@/src/lib/ai-daw-agent'
import type { ProjectPlanData } from '@/src/lib/project-plan'
import {
  buildDocTextAnchor,
  captureActiveDocTextSelection,
  dispatchAskAiAboutSelection,
  rememberOpenDoc,
  setMusicalSelectionAnchor,
} from '@/src/lib/ai-selection-context'
import {
  bumpDocsTextZoom,
  closeDocsTab,
  getDocsEditorState,
  openDocsTab,
  setActiveDocsTab,
  setDocsPanelMounted,
  setDocsTextZoom,
  startDocsEditorChannel,
  subscribeDocsEditor,
  type DocsEditorTab,
} from '@/src/lib/docs-editor-store'

function useDocs(projectId: string): AgentDoc[] {
  return useSyncExternalStore(
    subscribeAgentDocs,
    () => listAgentDocs(projectId),
    () => listAgentDocs(projectId),
  )
}

function useDocsEditor() {
  return useSyncExternalStore(subscribeDocsEditor, getDocsEditorState, getDocsEditorState)
}

function tabLabel(tab: DocsEditorTab): string {
  return tab.mode === 'preview' ? `${tab.slug} · Vista` : tab.slug
}

/** Editor de Markdown del proyecto: tabs edit/vista, zoom tipográfico. */
export function AgentDocsPanel() {
  const tienda = useDAW()
  const projectId = useDAWState((s) => s.project?.id || 'default')
  const projectRuta = useDAWState((s) => s.project?.ruta)
  const docs = useDocs(projectId)
  const editor = useDocsEditor()
  const activeTab = editor.tabs.find((t) => t.id === editor.activeTabId) ?? editor.tabs[0] ?? null
  const activeDoc = activeTab ? docs.find((d) => d.slug === activeTab.slug) : null
  const [draft, setDraft] = useState(activeDoc?.content ?? '')
  const [evalMsg, setEvalMsg] = useState('')
  const [execBusy, setExecBusy] = useState(false)
  const [execMsg, setExecMsg] = useState('')
  const userDirty = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const previewHostRef = useRef<HTMLDivElement>(null)
  const [editSel, setEditSel] = useState('')
  const [askPop, setAskPop] = useState<{ x: number; y: number; text: string } | null>(null)

  useEffect(() => startDocsEditorChannel(), [])

  useEffect(() => {
    if (activeDoc) rememberOpenDoc(activeDoc.slug, activeTab?.mode === 'edit' ? draft : activeDoc.content)
  }, [activeDoc?.slug, activeDoc?.content, activeTab?.mode, draft])

  useEffect(() => {
    bindAgentDocsDisk(projectId, projectRuta)
    void hydrateAgentDocsFromDisk(projectId, projectRuta)
  }, [projectId, projectRuta])

  useEffect(() => {
    if (editor.tabs.length === 0) {
      openDocsTab(PLAN_SLUG, 'edit')
    }
  }, [editor.tabs.length])

  useEffect(() => {
    if (!activeDoc || !activeTab || activeTab.mode !== 'edit') return
    userDirty.current = false
    setDraft(activeDoc.content)
  }, [activeDoc?.slug, activeDoc?.updatedAt, activeTab?.mode, activeTab?.id])

  useEffect(() => {
    if (!activeDoc || !activeTab || activeTab.mode !== 'edit' || !userDirty.current) return
    const t = window.setTimeout(() => {
      if (draft !== activeDoc.content) {
        writeAgentDoc(projectId, activeDoc.slug, draft, { origin: 'user', preserveUserNotes: false })
        userDirty.current = false
      }
    }, 450)
    return () => window.clearTimeout(t)
  }, [draft, activeDoc, activeTab, projectId])

  const flushDraft = useCallback(() => {
    if (activeDoc && activeTab?.mode === 'edit' && userDirty.current && draft !== activeDoc.content) {
      writeAgentDoc(projectId, activeDoc.slug, draft, { origin: 'user', preserveUserNotes: false })
      userDirty.current = false
    }
  }, [activeDoc, activeTab, draft, projectId])

  const sourceMd = (activeTab?.mode === 'edit' ? draft : activeDoc?.content) || ''

  const askAboutText = useCallback(
    (text: string, autoSend?: string) => {
      const slug = activeDoc?.slug || PLAN_SLUG
      const md = sourceMd || activeDoc?.content || ''
      if (text.trim().length < 2) return
      setMusicalSelectionAnchor(buildDocTextAnchor({ slug, markdown: md, text }))
      dispatchAskAiAboutSelection(autoSend ? { autoSend } : undefined)
      setAskPop(null)
    },
    [activeDoc?.slug, activeDoc?.content, sourceMd],
  )

  const runSection = useCallback(
    (heading: string) => {
      const md = activeDoc?.content || draft
      const body = getMarkdownSection(md, heading).trim()
      const placeholder =
        !body ||
        /^_/.test(body) ||
        /por definir|tareas concretas|a[ñn]ade tareas|reescribe en cada pedido/i.test(body)
      if (placeholder) {
        askAboutText(
          `## ${heading}\n${body || '(vacío)'}`,
          `La sección «${heading}» del plan está vacía o es placeholder. NO inventes una canción nueva. Pide al usuario qué quiere ahí, o reescribe SOLO esa sección en plan.md con contenido musical concreto (BPM, género, pistas, forma). No toques Notas del usuario.`,
        )
        return
      }
      // Incluir el cuerpo en el mensaje visible: evita recursión «implementa implementa…»
      askAboutText(
        `## ${heading}\n${body}`,
        [
          `Ejecuta en el DAW lo descrito en «${heading}» del plan (fragmento anclado abajo).`,
          'Emite <<<ACTIONS>>> reales (midi.clip.create / notes.set / musicBuild según haga falta).',
          'MIDI denso y musical — PROHIBIDO esqueletos (kick cada 4 beats, 4 notas en 32 beats).',
          'Actualiza SOLO esa parte del plan.md al marcar progreso. No reescribas Notas del usuario ni inventes otro género.',
          '',
          '### Contenido a ejecutar',
          body.slice(0, 4000),
        ].join('\n'),
      )
    },
    [activeDoc?.content, draft, askAboutText],
  )

  const runTask = useCallback(
    (task: string) => {
      const clean = task.replace(/^\s*[-*]\s*\[[ xX]?\]\s*/, '').trim()
      askAboutText(
        `- [ ] ${clean}`,
        [
          `Ejecuta YA esta tarea del plan en el DAW. Emite <<<ACTIONS>>> con notas MIDI reales (no esqueleto).`,
          `Tarea: ${clean}`,
          'No reescribas todo el plan ni Notas del usuario. Tras aplicar, marca la tarea [x] en plan.md.',
        ].join('\n'),
      )
    },
    [askAboutText],
  )

  const syncEditSelection = useCallback((el: HTMLTextAreaElement) => {
    const t = el.value.slice(el.selectionStart, el.selectionEnd)
    setEditSel(t.trim().length >= 2 ? t : '')
  }, [])

  const onEval = useCallback(() => {
    flushDraft()
    const ev = syncPlanAfterDawChange(projectId, tienda.obtenerEstado())
    setEvalMsg(ev?.summary || 'Nada que evaluar aún. Añade tareas `- [ ]` en el plan.')
  }, [flushDraft, projectId, tienda])

  const onExecutePlan = useCallback(async () => {
    if (activeTab?.slug !== PLAN_SLUG) return
    flushDraft()
    const content = draft || activeDoc?.content || ''
    setExecBusy(true)
    setExecMsg('')
    try {
      const intent = getMarkdownSection(content, 'Intención').trim()
      const todoBody = getMarkdownSection(content, 'Por implementar')
      const tracks: ProjectPlanData['tracks'] = []
      for (const line of todoBody.split('\n')) {
        const m = /^\s*[-*]\s*\[[ xX]?\]\s*Pista\s*«([^»]+)»\s*\(([^)]*)\)/i.exec(line)
        if (!m) continue
        const nombre = m[1]!.trim()
        const meta = m[2] || ''
        const rol = meta.split(/[·|,]/)[0]?.trim() || 'keys'
        const vst = /VST\s+([^·|,]+)/i.exec(meta)?.[1]?.trim()
        tracks.push({ nombre, rol, tipo: 'midi', pluginNombre: vst })
      }
      const bpmHit = /(\d{2,3})\s*BPM/i.exec(intent) || /(\d{2,3})\s*BPM/i.exec(content)
      const bpm = bpmHit ? Number(bpmHit[1]) : tienda.obtenerEstado().project.bpm?.valor ?? 120
      const nombre =
        /^#\s*Plan:\s*(.+)$/im.exec(content)?.[1]?.trim() ||
        tienda.obtenerEstado().project.nombre ||
        'Proyecto'
      const actions =
        tracks.length > 0
          ? [
              {
                type: 'daw.composeProject',
                payload: { aplicar: true, nombre, bpm, pensamiento: intent || undefined, pistas: tracks },
              },
            ]
          : [
              {
                type: 'daw.musicBuild',
                payload: { aplicar: true, prompt: content.slice(0, 6000), nombre, bpm },
              },
            ]
      const results = await executeDawActions(tienda, actions, {
        agentMode: 'create',
        forceApply: true,
        respectModeGate: false,
        source: 'user_build',
      })
      setExecMsg(formatActionResultsForUser(results) || 'Plan ejecutado.')
      syncPlanAfterDawChange(projectId, tienda.obtenerEstado())
    } catch (err) {
      setExecMsg(err instanceof Error ? err.message : 'Error al ejecutar el plan')
    } finally {
      setExecBusy(false)
    }
  }, [activeDoc, activeTab, draft, flushDraft, projectId, tienda])

  const zoom = editor.textZoom
  const fontPx = Math.round(11 * zoom)

  useEffect(() => {
    setDocsPanelMounted(true)
    return () => setDocsPanelMounted(false)
  }, [])

  /** Ctrl/Cmd + / - / 0: captura global solo con foco en este panel (o undock Docs). */
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const root = rootRef.current
      if (!root) return
      const undockDocs =
        new URLSearchParams(window.location.search).get('undock') === 'docs' ||
        window.location.hash.replace(/^#/, '').startsWith('undock/docs')
      const inPanel =
        undockDocs ||
        root.contains(document.activeElement) ||
        root === document.activeElement
      if (!inPanel) return
      const key = e.key
      const code = e.code
      const zoomIn =
        key === '=' || key === '+' || code === 'NumpadAdd' || code === 'Equal'
      const zoomOut = key === '-' || key === '_' || code === 'NumpadSubtract' || code === 'Minus'
      const zoomReset = key === '0' || code === 'Digit0' || code === 'Numpad0'
      if (!zoomIn && !zoomOut && !zoomReset) return
      e.preventDefault()
      e.stopPropagation()
      if (zoomIn) bumpDocsTextZoom(0.1)
      else if (zoomOut) bumpDocsTextZoom(-0.1)
      else setDocsTextZoom(1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault()
      e.stopPropagation()
      if (!captureActiveDocTextSelection()) {
        const t = editSel || askPop?.text
        if (t) askAboutText(t)
        else return
      } else {
        dispatchAskAiAboutSelection()
      }
      setAskPop(null)
      return
    }
    if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
      e.preventDefault()
      e.stopPropagation()
      bumpDocsTextZoom(0.1)
    } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
      e.preventDefault()
      e.stopPropagation()
      bumpDocsTextZoom(-0.1)
    } else if (e.key === '0') {
      e.preventDefault()
      e.stopPropagation()
      setDocsTextZoom(1)
    }
  }

  return (
    <div
      ref={rootRef}
      data-docs-panel
      className="flex h-full min-h-0 flex-col bg-panel"
      onKeyDown={onKeyDown}
      onPointerDown={() => {
        // Asegura foco para Ctrl± tras clic en vista previa.
        rootRef.current?.focus({ preventScroll: true })
      }}
      tabIndex={-1}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-foreground">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          Docs
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="Alejar texto (Ctrl+-)"
            onClick={() => bumpDocsTextZoom(-0.1)}
            className="rounded p-1 text-muted-foreground hover:bg-panel-raised"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <span className="min-w-[2.5rem] text-center text-[10px] tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            title="Acercar texto (Ctrl+=)"
            onClick={() => bumpDocsTextZoom(0.1)}
            className="rounded p-1 text-muted-foreground hover:bg-panel-raised"
          >
            <ZoomIn className="size-3.5" />
          </button>
          {activeTab?.slug === PLAN_SLUG ? (
            <button
              type="button"
              title="Ejecutar plan"
              disabled={execBusy}
              onClick={() => void onExecutePlan()}
              className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {execBusy ? <Loader2 className="size-3 animate-spin" /> : <Hammer className="size-3" />}
              Ejecutar
            </button>
          ) : null}
          <button
            type="button"
            title="Evaluar plan vs DAW"
            onClick={onEval}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <PlayCircle className="size-3.5" />
            Evaluar
          </button>
        </div>
      </header>

      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border bg-panel-raised/40 px-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {editor.tabs.map((tab) => {
            const isActive = tab.id === (activeTab?.id ?? editor.activeTabId)
            return (
              <div
                key={tab.id}
                className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] ${
                  isActive ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-panel'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveDocsTab(tab.id)}
                  className="flex max-w-[10rem] items-center gap-1 truncate"
                  title={tabLabel(tab)}
                >
                  {tab.mode === 'preview' ? (
                    <Eye className="size-3 shrink-0 opacity-70" />
                  ) : (
                    <FileText className="size-3 shrink-0 opacity-70" />
                  )}
                  <span className="truncate">{tabLabel(tab)}</span>
                </button>
                <button
                  type="button"
                  title="Cerrar tab"
                  onClick={(e) => {
                    e.stopPropagation()
                    flushDraft()
                    closeDocsTab(tab.id)
                  }}
                  className="rounded p-0.5 hover:bg-panel-raised hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
        {activeTab ? (
          <button
            type="button"
            title={
              activeTab.mode === 'edit'
                ? 'Abrir tab de vista previa'
                : 'Abrir tab de edición'
            }
            onClick={() =>
              openDocsTab(activeTab.slug, activeTab.mode === 'edit' ? 'preview' : 'edit')
            }
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-panel hover:text-foreground"
          >
            {activeTab.mode === 'edit' ? '+ Vista' : '+ Editar'}
          </button>
        ) : null}
      </div>

      {execMsg || evalMsg ? (
        <div className="border-b border-border/60 px-2 py-1 text-[10px] text-muted-foreground">
          {execMsg || evalMsg}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {!activeTab || !activeDoc ? (
          <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
            Abre un archivo desde el Explorador
          </div>
        ) : activeTab.mode === 'edit' ? (
          <div className="flex h-full min-h-0 flex-col">
            {editSel ? (
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground" title={editSel}>
                  {editSel.replace(/\s+/g, ' ').slice(0, 80)}
                </span>
                <button
                  type="button"
                  title="Preguntar a Jas sobre esta selección (Ctrl+L)"
                  onClick={() => askAboutText(editSel)}
                  className="inline-flex items-center gap-1 rounded-md bg-accent-amber px-2 py-0.5 text-[10px] font-semibold text-background"
                >
                  <MessageSquareQuote className="size-3" />
                  Preguntar a Jas
                  <kbd className="rounded bg-background/20 px-1 font-mono text-[9px]">Ctrl+L</kbd>
                </button>
              </div>
            ) : null}
            <textarea
              value={draft}
              data-doc-slug={activeTab.slug}
              onChange={(e) => {
                userDirty.current = true
                setDraft(e.target.value)
                syncEditSelection(e.target)
              }}
              onSelect={(e) => syncEditSelection(e.currentTarget)}
              onKeyUp={(e) => syncEditSelection(e.currentTarget)}
              onMouseUp={(e) => syncEditSelection(e.currentTarget)}
              onKeyDown={onKeyDown}
              spellCheck={false}
              style={{ fontSize: fontPx }}
              className="h-full w-full resize-none bg-background/40 px-2 py-1.5 font-mono leading-relaxed text-foreground outline-none"
              aria-label={`Editar ${activeTab.slug}`}
            />
          </div>
        ) : (
          <div
            ref={previewHostRef}
            className="doc-md-preview relative h-full overflow-y-auto"
            data-doc-preview=""
            data-doc-slug={activeTab.slug}
            data-chat-selectable=""
            onMouseUp={() => {
              const sel = window.getSelection()
              const text = sel?.toString().trim() ?? ''
              const host = previewHostRef.current
              if (!host || text.length < 2 || !sel || sel.rangeCount === 0) {
                setAskPop(null)
                return
              }
              const node = sel.anchorNode
              const el = node instanceof Element ? node : node?.parentElement
              if (!el || !host.contains(el)) {
                setAskPop(null)
                return
              }
              const r = sel.getRangeAt(0).getBoundingClientRect()
              const box = host.getBoundingClientRect()
              setAskPop({
                x: r.left - box.left + r.width / 2 + host.scrollLeft,
                y: r.top - box.top + host.scrollTop,
                text,
              })
            }}
          >
            <nav className="doc-md-crumb" aria-label="Ruta del documento">
              <span>docs</span>
              <span className="doc-md-crumb-sep">›</span>
              <span className="text-[#cccccc]">{activeTab.slug}</span>
            </nav>
            <article className="doc-md-page" style={{ fontSize: `${Math.round(15 * zoom)}px` }}>
              <DocMarkdown
                text={activeDoc.content}
                actions={{ onRunTask: runTask, onRunSection: runSection }}
              />
            </article>
            {askPop ? (
              <button
                type="button"
                className="doc-md-ask-pop"
                style={{ left: askPop.x, top: Math.max(8, askPop.y - 8) }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => askAboutText(askPop.text)}
              >
                <MessageSquareQuote className="size-3" />
                Preguntar a Jas
                <kbd>Ctrl+L</kbd>
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
