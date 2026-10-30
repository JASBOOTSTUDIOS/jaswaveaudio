import { Activity, BarChart3, Clock, FileDiff, Filter, ListChecks, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { getAgentEngine } from '../motor/agent-engine-host'
import { tituloHerramientaParaUsuario } from '../motor/describe-action'
import { textoLegible } from './detalles-tecnicos'
import { computeSemanticDiff, leerPlan, listarAuditHistorial, parsePlan, proyectarParaDiff, resumenDiff, siguientePasoPendiente, tendenciaMetrica, useDAWState } from '@jaswave/host-sdk'
import type { DiffSnapshot, PlanEstructurado, PlanPaso } from '@jaswave/host-sdk'

function pct(plan: PlanEstructurado): number {
  if (plan.pasos.length === 0) return 0
  const hechos = plan.pasos.filter((p) => p.estado === 'hecho' || p.estado === 'omitido').length
  return Math.round((hechos / plan.pasos.length) * 100)
}

function estadoClase(estado: PlanPaso['estado']): string {
  switch (estado) {
    case 'hecho':
      return 'text-emerald-400'
    case 'en-curso':
      return 'text-amber-400'
    case 'bloqueado':
      return 'text-red-400'
    case 'omitido':
      return 'text-muted-foreground'
    default:
      return 'text-muted-foreground'
  }
}

const ESTADO_PASO: Record<string, string> = {
  hecho: 'Hecho',
  'en-curso': 'En curso',
  bloqueado: 'Bloqueado',
  omitido: 'Omitido',
  pendiente: 'Pendiente',
}

const ESTADO_LOG: Record<string, string> = {
  ok: 'hecho',
  done: 'hecho',
  success: 'hecho',
  executed: 'hecho',
  applied: 'hecho',
  error: 'no se pudo',
  failed: 'no se pudo',
  fail: 'no se pudo',
  pending: 'pendiente',
  proposed: 'propuesto',
  running: 'en curso',
  skipped: 'omitido',
  rejected: 'descartado',
}

const ROL: Record<string, string> = {
  planner: 'Planificador',
  planificador: 'Planificador',
  director: 'Director',
  executor: 'Ejecución',
  critic: 'Revisión',
  qa: 'Revisión',
  mezcla: 'Mezcla',
  mastering: 'Máster',
  musico: 'Músico',
}

function nombreAgente(a: string): string {
  return ROL[a] ?? (a ? a.charAt(0).toUpperCase() + a.slice(1).replace(/[-_]+/g, ' ') : '')
}

function tituloLog(e: { tool?: string; kind?: string }): string {
  if (e.tool) return tituloHerramientaParaUsuario(e.tool)
  if (e.kind) return tituloHerramientaParaUsuario(e.kind)
  return 'Actividad'
}

export function ProgressPanel() {
  const tienda = useDAWState((s) => s) as any
  const [plan, setPlan] = useState<PlanEstructurado | null>(() => {
    const md = leerPlan(tienda as any)
    return md ? parsePlan(md as any) : null
  })
  const [agenteFiltro, setAgenteFiltro] = useState<string>('todos')
  const _setRunId = useState<string>('')[1]
  const [diffResumen, setDiffResumen] = useState<string>('Sin cambios')
  const [tendencia, setTendencia] = useState<Array<{ timestamp: number; valor: number }>>([])

  const engine = useMemo(() => getAgentEngine(tienda), [tienda])
  const run = useMemo(() => {
    const rns = (engine as any).getRuns?.()
    if (!rns) return null
    const all = Array.isArray(rns) ? rns : Object.values(rns)
    if (all.length === 0) return null
    const r = all[all.length - 1]
    return r ?? all[all.length - 1]
  }, [engine])

  const actualizar = useCallback(() => {
    const md = leerPlan(tienda as any)
    setPlan(md ? parsePlan(md as any) : null)
  }, [tienda])

  useEffect(() => {
    actualizar()
    const id = window.setInterval(actualizar, 1500)
    return () => window.clearInterval(id)
  }, [actualizar])

  const p = plan
  const actual = p ? (siguientePasoPendiente as any)(p) : null
  const agentes = useMemo(() => {
    const set = new Set<string>()
    for (const paso of p?.pasos ?? []) if ((paso as any).agente) set.add((paso as any).agente)
    return ['todos', ...[...set].sort()]
  }, [p])

  const historial = useMemo(() => {
    try {
      return (listarAuditHistorial as any)({ metrica: 'lufs' }) || []
    } catch {
      return []
    }
  }, [])
  useEffect(() => {
    try {
      const t = (tendenciaMetrica as any)(historial, 'lufs')
      setTendencia(Array.isArray(t) ? t : [])
    } catch {
      setTendencia([])
    }
  }, [historial])

  useEffect(() => {
    try {
      const estado = tienda.obtenerEstado ? tienda.obtenerEstado() : tienda
      const snap = proyectarParaDiff(estado as any)
      const antes: DiffSnapshot = { project: { tracks: [], routing: { sends: [], sidechains: [] } } }
      const ahora: DiffSnapshot = snap
      const diff = computeSemanticDiff(antes, ahora)
      setDiffResumen(resumenDiff(diff))
    } catch {
      setDiffResumen('Sin cambios')
    }
  }, [tienda])

  const log = useMemo(() => {
    const entries = (run?.log ?? []).slice(-80).reverse()
    if (agenteFiltro === 'todos') return entries
    return entries.filter((e: any) => e.role === agenteFiltro || e.agente === agenteFiltro)
  }, [run, agenteFiltro])

  return (
    <div className="flex h-full flex-col bg-panel text-[12px]">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-emerald-400" />
          <span className="font-semibold">Progreso</span>
        </div>
        <button type="button" onClick={actualizar} className="flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground hover:bg-hover hover:text-foreground">
          <RefreshCw className="size-3.5" />
          Actualizar
        </button>
      </header>

      <div className="flex-1 overflow-auto">
        <section className="border-b border-border px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListChecks className="size-4 text-muted-foreground" />
              <span className="font-medium">Plan</span>
            </div>
            <span className="text-muted-foreground">{p ? `${pct(p)} %` : 'Sin plan'}</span>
          </div>
          {p ? (
            <>
              <p className="mb-2 truncate text-muted-foreground" title={p.titulo}>{p.titulo}</p>
              {actual ? <p className="mb-2 break-words text-amber-300">Paso actual: {actual.titulo}</p> : <p className="mb-2 text-emerald-300">Sin pasos pendientes</p>}
              <div className="space-y-1">
                {p.pasos.slice(0, 12).map((paso) => (
                  <div key={paso.id} className="flex min-w-0 items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-hover/40">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`shrink-0 text-[11px] ${estadoClase(paso.estado)}`}>{ESTADO_PASO[paso.estado] ?? 'Pendiente'}</span>
                      <span className="min-w-0 truncate text-foreground" title={paso.titulo}>{paso.titulo}</span>
                    </div>
                    {paso.agente && <span className="shrink-0 text-[11px] text-muted-foreground">{nombreAgente(paso.agente)}</span>}
                  </div>
                ))}
                {p.pasos.length > 12 && <p className="px-1.5 text-[11px] text-muted-foreground">y {p.pasos.length - 12} pasos más</p>}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">Todavía no hay un plan para este proyecto. Pídele uno al asistente.</p>
          )}
        </section>

        <section className="border-b border-border px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" />
              <span className="font-medium">Actividad</span>
            </div>
            <div className="flex items-center gap-1">
              <Filter className="size-3.5 text-muted-foreground" />
              <select aria-label="Filtrar por especialista" value={agenteFiltro} onChange={(e) => setAgenteFiltro(e.target.value)} className="bg-transparent text-[11px] text-muted-foreground">
                {agentes.map((a) => <option key={a} value={a}>{a === 'todos' ? 'Todos' : nombreAgente(a)}</option>)}
              </select>
            </div>
          </div>
          {log.length === 0 ? (
            <p className="text-muted-foreground">Todavía no hay actividad.</p>
          ) : (
            <div className="space-y-1">
              {log.slice(0, 40).map((e: any, i: number) => (
                <div key={i} className="flex min-w-0 items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-hover/40">
                  <div className="flex min-w-0 items-center gap-2">
                    {e.role ? <span className="shrink-0 text-[11px] text-muted-foreground">{nombreAgente(String(e.role))}</span> : null}
                    <span className="shrink-0 text-foreground">{tituloLog(e)}</span>
                    <span className="min-w-0 truncate text-muted-foreground" title={textoLegible(e.message)}>{textoLegible(e.message)}</span>
                  </div>
                  {e.status && <span className="shrink-0 text-[11px] text-muted-foreground">{ESTADO_LOG[String(e.status)] ?? ''}</span>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border-b border-border px-3 py-2">
          <div className="mb-1 flex items-center gap-2">
            <FileDiff className="size-4 text-muted-foreground" />
            <span className="font-medium">Cambios en el proyecto</span>
          </div>
          <p className="text-muted-foreground">{diffResumen}</p>
        </section>

        <section className="px-3 py-2">
          <div className="mb-1 flex items-center gap-2">
            <BarChart3 className="size-4 text-muted-foreground" />
            <span className="font-medium">Volumen a lo largo del tiempo (LUFS)</span>
          </div>
          {tendencia.length === 0 ? (
            <p className="text-muted-foreground">Todavía no hay mediciones.</p>
          ) : (
            <div className="flex items-end gap-1">
              {tendencia.slice(-12).map((m, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="w-4 bg-emerald-400/60" style={{ height: `${Math.max(4, Math.min(40, 20 - m.valor))}px` }} />
                  <span className="text-[9px] text-muted-foreground">{m.valor.toFixed(1).replace('.', ',')}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
