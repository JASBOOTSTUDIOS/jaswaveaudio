import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { FilePlus, FileText, Hammer, Loader2, PlayCircle, Trash2 } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { ChatMarkdown } from '@/components/chat-markdown'
import {
  PLAN_SLUG,
  bindAgentDocsDisk,
  createAgentDoc,
  deleteAgentDoc,
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

function useDocs(projectId: string): AgentDoc[] {
  return useSyncExternalStore(
    subscribeAgentDocs,
    () => listAgentDocs(projectId),
    () => listAgentDocs(projectId),
  )
}

/** Editor de Markdown del proyecto: plan.md y documentos creados por la IA o el usuario. */
export function AgentDocsPanel() {
  const tienda = useDAW()
  const projectId = useDAWState((s) => s.project?.id || 'default')
  const projectRuta = useDAWState((s) => s.project?.ruta)
  const docs = useDocs(projectId)
  const [activeSlug, setActiveSlug] = useState(PLAN_SLUG)
  const active = docs.find((d) => d.slug === activeSlug) ?? docs[0]
  const [draft, setDraft] = useState(active?.content ?? '')
  const [evalMsg, setEvalMsg] = useState('')
  const [execBusy, setExecBusy] = useState(false)
  const [execMsg, setExecMsg] = useState('')
  const userDirty = useRef(false)

  useEffect(() => {
    bindAgentDocsDisk(projectId, projectRuta)
    void hydrateAgentDocsFromDisk(projectId, projectRuta)
  }, [projectId, projectRuta])

  useEffect(() => {
    if (!active) return
    userDirty.current = false
    setDraft(active.content)
  }, [active?.slug, active?.updatedAt])

  useEffect(() => {
    if (!active || !userDirty.current) return
    const t = window.setTimeout(() => {
      if (draft !== active.content) {
        writeAgentDoc(projectId, active.slug, draft, { origin: 'user', preserveUserNotes: false })
        userDirty.current = false
      }
    }, 450)
    return () => window.clearTimeout(t)
  }, [draft, active?.slug, active?.content, projectId])

  const preview = useMemo(() => draft, [draft])

  const onNew = useCallback(() => {
    const name = window.prompt('Nombre del documento (.md)', 'notas.md')
    if (!name) return
    const doc = createAgentDoc(projectId, name, `# ${name.replace(/\.md$/i, '')}\n\n`, 'user')
    setActiveSlug(doc.slug)
  }, [projectId])

  const onEval = useCallback(() => {
    if (active && userDirty.current && draft !== active.content) {
      writeAgentDoc(projectId, active.slug, draft, { origin: 'user', preserveUserNotes: false })
      userDirty.current = false
    }
    const ev = syncPlanAfterDawChange(projectId, tienda.obtenerEstado())
    setEvalMsg(ev?.summary || 'Nada que evaluar aún. Añade tareas `- [ ]` en el plan.')
  }, [projectId, tienda, active, draft])

  const onExecutePlan = useCallback(async () => {
    if (active?.slug !== PLAN_SLUG) return
    if (userDirty.current && draft !== active.content) {
      writeAgentDoc(projectId, active.slug, draft, { origin: 'user', preserveUserNotes: false })
      userDirty.current = false
    }
    setExecBusy(true)
    setExecMsg('')
    try {
      const intent = getMarkdownSection(draft, 'Intención').trim()
      const todoBody = getMarkdownSection(draft, 'Por implementar')
      const tracks: ProjectPlanData['tracks'] = []
      for (const line of todoBody.split('\n')) {
        const m = /^\s*[-*]\s*\[[ xX]?\]\s*Pista\s*«([^»]+)»\s*\(([^)]*)\)/i.exec(line)
        if (!m) continue
        const nombre = m[1]!.trim()
        const meta = m[2] || ''
        const rol = meta.split(/[·|,]/)[0]?.trim() || 'keys'
        const vst = /VST\s+([^·|,]+)/i.exec(meta)?.[1]?.trim()
        tracks.push({
          nombre,
          rol,
          tipo: 'midi',
          pluginNombre: vst,
        })
      }
      const bpmHit = /(\d{2,3})\s*BPM/i.exec(intent) || /(\d{2,3})\s*BPM/i.exec(draft)
      const bpm = bpmHit ? Number(bpmHit[1]) : tienda.obtenerEstado().project.bpm?.valor ?? 120
      const nombre =
        /^#\s*Plan:\s*(.+)$/im.exec(draft)?.[1]?.trim() ||
        tienda.obtenerEstado().project.nombre ||
        'Proyecto'

      const actions =
        tracks.length > 0
          ? [
              {
                type: 'daw.composeProject',
                payload: {
                  aplicar: true,
                  nombre,
                  bpm,
                  pensamiento: intent || undefined,
                  pistas: tracks,
                },
              },
            ]
          : [
              {
                type: 'daw.musicBuild',
                payload: {
                  aplicar: true,
                  prompt: draft.slice(0, 6000),
                  nombre,
                  bpm,
                },
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
  }, [active, draft, projectId, tienda])

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-foreground">
          <FileText className="size-3.5 shrink-0 text-accent-amber" />
          Plan / Docs
        </div>
        <div className="flex items-center gap-1">
          {active?.slug === PLAN_SLUG ? (
            <button
              type="button"
              title="Ejecutar plan en el DAW"
              disabled={execBusy}
              onClick={() => void onExecutePlan()}
              className="inline-flex items-center gap-1 rounded-md bg-accent-amber px-1.5 py-1 text-[10px] font-semibold text-background hover:opacity-90 disabled:opacity-50"
            >
              {execBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Hammer className="size-3.5" />}
              Ejecutar
            </button>
          ) : null}
          <button
            type="button"
            title="Evaluar plan vs DAW"
            onClick={onEval}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-accent-amber hover:bg-accent-amber/15"
          >
            <PlayCircle className="size-3.5" />
            Evaluar
          </button>
          <button
            type="button"
            title="Nuevo .md"
            onClick={onNew}
            className="rounded-md p-1 text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          >
            <FilePlus className="size-3.5" />
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <ul className="w-[7.5rem] shrink-0 overflow-y-auto border-r border-border py-1">
          {docs.map((d) => (
            <li key={d.slug}>
              <button
                type="button"
                onClick={() => setActiveSlug(d.slug)}
                className={`flex w-full items-center justify-between gap-1 px-2 py-1 text-left text-[11px] ${
                  d.slug === active?.slug
                    ? 'bg-accent-amber/15 font-medium text-accent-amber'
                    : 'text-muted-foreground hover:bg-panel-raised/80 hover:text-foreground'
                }`}
              >
                <span className="truncate">{d.slug}</span>
                {d.slug !== PLAN_SLUG ? (
                  <span
                    role="button"
                    tabIndex={0}
                    title="Eliminar"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (window.confirm(`¿Borrar ${d.slug}?`)) {
                        deleteAgentDoc(projectId, d.slug)
                        setActiveSlug(PLAN_SLUG)
                      }
                    }}
                    className="rounded p-0.5 hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex min-w-0 flex-1 flex-col">
          {execMsg || evalMsg ? (
            <div className="border-b border-border/60 px-2 py-1 text-[10px] text-muted-foreground">
              {execMsg || evalMsg}
            </div>
          ) : (
            <div className="border-b border-border/60 px-2 py-1 text-[10px] text-muted-foreground">
              Editable por ti y por la IA. «Ejecutar» aplica el plan al DAW. «Notas del usuario» se conserva.
            </div>
          )}
          <textarea
            value={draft}
            onChange={(e) => {
              userDirty.current = true
              setDraft(e.target.value)
            }}
            spellCheck={false}
            className="min-h-[40%] flex-1 resize-none bg-background/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground outline-none"
            aria-label={`Editar ${active?.slug ?? 'documento'}`}
          />
          <div className="max-h-[38%] overflow-y-auto border-t border-border px-2 py-1.5">
            <div className="mb-1 text-[9px] uppercase tracking-wide text-muted-foreground">Vista previa</div>
            <ChatMarkdown text={preview} />
          </div>
        </div>
      </div>
    </div>
  )
}
