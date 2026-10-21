/**
 * Herramientas de auditoría y progreso (A9) para los agentes.
 *
 * Son 13 herramientas registradas con JSON Schema explícito: 10 de lectura y 3 de
 * escritura sobre el plan. Todas leen el estado del DAW y el plan estructurado
 * (plan.md); ninguna muta el proyecto (las escrituras solo tocan el plan).
 *
 * Reglas (fail closed, ADR-0017):
 * - `plan.updateStep` con `estado: 'hecho'` exige que `audit.step` pase: sin
 *   verificación (criterio medible sin medición o criterio incumplido) se rechaza.
 * - `audit.project` solo bloquea por incidencias bloqueantes; el resto son avisos
 *   y las incidencias aceptadas por el usuario no bloquean.
 */

import {
  auditMix as auditMixCore,
  auditStep as auditStepCore,
  auditarProyecto,
  compareReference,
  generarSessionSummary,
  serializePlan,
  type PlanPaso,
} from '@jaswave/ai-harness'
import { parseCriteria } from '@jaswave/ai-harness'
import type { ToolJsonSchema } from '../../../shared/src/ai/tool-schemas'
import type { DAWState } from '../../../shared/src/types/state'
import {
  computeSemanticDiff,
  proyectarParaDiff,
  type DiffSnapshot,
  type SemanticStateDiff,
} from '../../../shared/src/state/diff-estado'
import { leerPlan } from './agent-plan-steps'

export const A9_TOOLS = {
  planGet: 'plan.get',
  planStatus: 'plan.status',
  planUpdateStep: 'plan.updateStep',
  planAddStep: 'plan.addStep',
  planProposeChange: 'plan.proposeChange',
  runLog: 'run.log',
  runDiff: 'run.diff',
  auditProject: 'audit.project',
  auditMix: 'audit.mix',
  auditStep: 'audit.step',
  auditHistory: 'audit.history',
  auditCompareReference: 'audit.compareReference',
  sessionSummary: 'session.summary',
} as const

export type A9ToolName = (typeof A9_TOOLS)[keyof typeof A9_TOOLS]

export const A9_TOOL_NAMES: readonly string[] = Object.values(A9_TOOLS)

const A9_TOOL_NAME_SET: ReadonlySet<string> = new Set(A9_TOOL_NAMES)

export function isAuditTool(name: string): name is A9ToolName {
  return A9_TOOL_NAME_SET.has(name)
}

/** Herramientas de A9 que escriben sobre el plan (nunca sobre el proyecto). */
export const A9_WRITE_TOOLS: readonly string[] = [
  A9_TOOLS.planUpdateStep,
  A9_TOOLS.planAddStep,
  A9_TOOLS.planProposeChange,
]

const EMPTY_OBJECT = { type: 'object', properties: {}, additionalProperties: false }

/** JSON Schemas explícitos de las 13 herramientas de A9. */
export const A9_TOOL_SCHEMAS: ToolJsonSchema[] = [
  {
    name: A9_TOOLS.planGet,
    description: 'Devuelve el plan estructurado (pasos, estados, criterios y evidencia).',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: A9_TOOLS.planStatus,
    description:
      'Estado del plan: % completado, paso actual, bloqueos y pasos que el usuario editó desde la última lectura.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: A9_TOOLS.planUpdateStep,
    description:
      'Actualiza un paso del plan (estado, evidencia, notas). Marcar «hecho» exige que audit.step pase.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Id del paso (S1, S2, …)' },
        estado: {
          type: 'string',
          enum: ['pendiente', 'en-curso', 'hecho', 'omitido', 'bloqueado'],
          description: 'Nuevo estado del paso',
        },
        evidencia: {
          type: 'array',
          items: { type: 'string' },
          description: 'Evidencia medida que respalda el cambio',
        },
        notas: { type: 'string', description: 'Nota corta (no sustituye la evidencia)' },
      },
      required: ['id', 'estado'],
      additionalProperties: false,
    },
  },
  {
    name: A9_TOOLS.planAddStep,
    description: 'Añade un paso pendiente al plan (fase, agente, criterios de aceptación).',
    parameters: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título del paso' },
        fase: { type: 'string', description: 'Fase (Estructura, Composición, Mezcla, Master…)' },
        agente: { type: 'string', description: 'Agente asignado (coproductor, qa, mezcla…)' },
        criterios: { type: 'array', items: { type: 'string' }, description: 'Criterios de aceptación' },
        herramientas: { type: 'array', items: { type: 'string' }, description: 'Herramientas permitidas' },
      },
      required: ['titulo'],
      additionalProperties: false,
    },
  },
  {
    name: A9_TOOLS.planProposeChange,
    description:
      'Propone un replan (pasos a añadir y pasos a retirar). No aplica el cambio: queda pendiente de aprobación.',
    parameters: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Por qué hace falta el replan' },
        pasos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              titulo: { type: 'string' },
              fase: { type: 'string' },
              agente: { type: 'string' },
              criterios: { type: 'array', items: { type: 'string' } },
            },
            required: ['titulo'],
            additionalProperties: false,
          },
          description: 'Pasos nuevos propuestos',
        },
        retirar: { type: 'array', items: { type: 'string' }, description: 'Ids de pasos a retirar' },
      },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
  {
    name: A9_TOOLS.runLog,
    description: 'Bitácora del turno: acciones con agente, herramienta, args resumidos, estado y duración.',
    parameters: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run concreto (por defecto, el turno actual)' },
        desde: { type: 'number', description: 'Timestamp mínimo (epoch ms)' },
        agente: { type: 'string', description: 'Filtra por agente/rol' },
        herramienta: { type: 'string', description: 'Filtra por nombre de herramienta' },
        limite: { type: 'number', description: 'Máximo de entradas (por defecto 50)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: A9_TOOLS.runDiff,
    description:
      'Diff semántico del proyecto (pistas, clips, notas, plugins y parámetros en unidades, mezcla en dB, ruteo).',
    parameters: {
      type: 'object',
      properties: {
        desde: {
          type: 'string',
          description: 'Punto de comparación: «turno», «paso:S3» o «snapshot:<id>»',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: A9_TOOLS.auditProject,
    description:
      'Auditoría del proyecto: estructura, instrumentos sin cargar, clips vacíos, notas duplicadas, media faltante, ruteo roto y valores inválidos.',
    parameters: {
      type: 'object',
      properties: {
        incluirMix: { type: 'boolean', description: 'Incluye la auditoría de mezcla' },
      },
      additionalProperties: false,
    },
  },
  {
    name: A9_TOOLS.auditMix,
    description: 'Auditoría de mezcla: mediciones (LUFS, TP, RMS, PLR) y comparación con la medición anterior.',
    parameters: {
      type: 'object',
      properties: {
        objetivo: { type: 'string', description: 'Objetivo de loudness (streaming, club, cd…)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: A9_TOOLS.auditStep,
    description:
      'Evalúa los criterios de aceptación de un paso con las mediciones del proyecto → {cumple, evidencia}.',
    parameters: {
      type: 'object',
      properties: {
        stepId: { type: 'string', description: 'Id del paso (S1, S2, …)' },
      },
      required: ['stepId'],
      additionalProperties: false,
    },
  },
  {
    name: A9_TOOLS.auditHistory,
    description: 'Serie de mediciones del proyecto (LUFS, TP, PLR…) y su tendencia.',
    parameters: {
      type: 'object',
      properties: {
        metrica: { type: 'string', description: 'Métrica concreta (lufs, tp, plr…)' },
        limite: { type: 'number', description: 'Máximo de muestras' },
      },
      additionalProperties: false,
    },
  },
  {
    name: A9_TOOLS.auditCompareReference,
    description: 'Diferencias contra la pista de referencia (LUFS, true peak, dinámica, ancho).',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: A9_TOOLS.sessionSummary,
    description:
      'Resumen compacto para retomar: objetivo, plan, hecho/pendiente, últimos problemas y últimas mediciones.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
]

/** Códigos de incidencia que impiden cerrar el turno (el resto son avisos). */
export const AUDIT_BLOQUEANTES = new Set([
  'sin-pistas',
  'plugin-error',
  'media-faltante',
  'ruteo-roto',
  'nota-fuera-de-rango',
])

export type AuditToolDeps = {
  state: DAWState
  projectId: string
  /** Markdown del plan (null si no hay). */
  getPlan: () => string | null
  /** Escribe el plan (solo para las 3 herramientas de escritura). */
  writePlan?: (md: string) => void
  /** Run vivo (para run.log / session.summary). */
  getRun?: (runId?: string) => EngineRunLike | undefined
  /** Baseline del diff (turno/paso). */
  getBaseline?: (desde: string) => DiffSnapshot | null
  /** Incidencias aceptadas por el usuario (código → motivo). */
  acceptedIssues?: readonly string[]
  /** Historial de mediciones del proyecto. */
  history?: AnalysisHistoryLike
  /** Rol/agente que llama la herramienta. */
  agente?: string
  now?: () => number
}

export type EngineRunLike = {
  id: string
  role?: string
  status?: string
  startedAt?: number
  updatedAt?: number
  log?: Array<{
    at: number
    kind: string
    role?: string
    tool?: string
    args?: string
    status?: string
    message?: string
    durationMs?: number
    undoId?: string
    stepId?: string
  }>
  steps?: Array<{ id: string; title?: string; status?: string; evidence?: string[] }>
}

export type AnalysisHistoryLike = {
  samples: Array<{
    id: string
    metrica: string
    valor: number
    unidad?: string
    etiqueta?: string
    timestamp: number
    pasoId?: string
    runId?: string
  }>
}

export type AuditToolResult = {
  success: boolean
  data?: unknown
  error?: { code: string; message: string }
}

function ok(data: unknown): AuditToolResult {
  return { success: true, data }
}

function fail(code: string, message: string): AuditToolResult {
  return { success: false, error: { code, message } }
}

// ── Mediciones ───────────────────────────────────────────────────────────────

/** Mediciones disponibles en el estado (LUFS, TP, RMS, PLR y por pista). */
export function medicionesDesdeEstado(state: DAWState): Record<string, number> {
  const m: Record<string, number> = {}
  const master = state.project?.analysis?.master
  const l = master?.loudness
  if (l) {
    if (Number.isFinite(l.integrated)) m.lufs = l.integrated
    else if (Number.isFinite(l.lufs)) m.lufs = l.lufs
    if (Number.isFinite(l.truePeak)) m.tp = l.truePeak > 0 ? 20 * Math.log10(l.truePeak) : -120
    if (Number.isFinite(l.peak) && m.peak === undefined) m.peak = l.peak > 0 ? 20 * Math.log10(l.peak) : -120
    if (Number.isFinite(l.rangoDinamico)) m.plr = l.rangoDinamico
  }
  if (master && Number.isFinite(master.nivelRMS)) m.rms = master.nivelRMS
  const tracks = state.project?.tracks ?? []
  for (const t of state.project?.analysis?.tracks ?? []) {
    const track = tracks.find((x) => x.id === t.trackId)
    const nombre = (track?.nombre ?? t.trackId ?? '').trim().toLowerCase()
    if (!nombre) continue
    if (Number.isFinite(t.nivelRMS)) m[`rms_${nombre}`] = t.nivelRMS
    if (Number.isFinite(t.loudness?.integrated)) m[`lufs_${nombre}`] = t.loudness.integrated
  }
  return m
}

// ── Auditoría de paso ────────────────────────────────────────────────────────

export type PasoAuditado = {
  id: string
  titulo: string
  criterios: string[]
  agente?: string
}

export type ResultadoAuditoriaPaso = {
  cumple: boolean
  issues: string[]
  evidencia: string[]
  criterios: Array<{ criterio: string; cumple: boolean; evidencia: string[] }>
  mediciones: Record<string, number>
}

/** Comprobación estructural de un criterio no medible (pista, clip, duplicados…). */
function comprobarCriterioCualitativo(state: DAWState, criterio: string): { ok: boolean; detalle: string } | null {
  const tracks = state.project?.tracks ?? []
  const texto = criterio.toLowerCase()

  const pista = /(?:pista|track)\s+["«']?([\wáéíóúñÁÉÍÓÚÑ]+)/i.exec(criterio)
  if (pista) {
    const nombre = pista[1]!.toLowerCase()
    const existe = tracks.some((t) => (t.nombre ?? '').trim().toLowerCase() === nombre)
    return {
      ok: existe,
      detalle: existe ? `La pista «${pista[1]}» existe.` : `La pista «${pista[1]}» no existe en el proyecto.`,
    }
  }

  if (/clip\s+(midi\s+)?no\s+vaci|clip\s+con\s+notas|no\s+vaci/i.test(texto)) {
    const conNotas = tracks.some((t) => (t.clips ?? []).some((c) => (c as { notas?: unknown[] }).notas?.length))
    return {
      ok: conNotas,
      detalle: conNotas ? 'Hay al menos un clip con notas.' : 'No hay ningún clip con notas en el proyecto.',
    }
  }

  if (/duplicad/i.test(texto)) {
    const duplicados = tracks.some((t) =>
      (t.clips ?? []).some((c) => {
        const notas = (c as { notas?: Array<{ pitch: number; inicio: number }> }).notas ?? []
        const vistos = new Set<string>()
        let dups = 0
        for (const n of notas) {
          const key = `${n.pitch}@${n.inicio.toFixed(4)}`
          if (vistos.has(key)) dups += 1
          else vistos.add(key)
        }
        return dups > 0
      }),
    )
    return {
      ok: !duplicados,
      detalle: duplicados ? 'Hay notas duplicadas en algún clip.' : 'No hay notas duplicadas.',
    }
  }

  if (/instrumento\s+cargado|con\s+instrumento|plugin\s+cargado/i.test(texto)) {
    const conPlugin = tracks.some((t) => (t.plugins ?? []).length > 0)
    return {
      ok: conPlugin,
      detalle: conPlugin ? 'Hay al menos una pista con instrumento/plugin.' : 'Ninguna pista tiene instrumento cargado.',
    }
  }

  if (/\bbpm\b/.test(texto)) {
    const bpm = state.project?.bpm?.valor ?? 0
    return { ok: bpm > 0, detalle: `BPM del proyecto: ${bpm}.` }
  }

  return null
}

/**
 * Audita un paso contra el DAW: criterios medibles con mediciones + criterios
 * cualitativos con comprobación estructural. Fail closed: un criterio medible sin
 * medición bloquea el paso.
 */
export function auditarPasoEnDAW(
  state: DAWState,
  paso: PasoAuditado,
  mediciones: Record<string, number> = medicionesDesdeEstado(state),
): ResultadoAuditoriaPaso {
  const medibles: string[] = []
  const cualitativos: string[] = []
  for (const c of paso.criterios) {
    if (parseCriteria(c).length) medibles.push(c)
    else cualitativos.push(c)
  }

  const issues: string[] = []
  const evidencia: string[] = []
  const criterios: ResultadoAuditoriaPaso['criterios'] = []

  if (medibles.length) {
    const r = auditStepCore({
      runId: 'auditoria',
      stepId: paso.id,
      titulo: paso.titulo,
      criterios: medibles,
      mediciones,
    })
    for (const c of r.criterios) {
      criterios.push({ criterio: c.criterio, cumple: c.cumple, evidencia: c.evidencia })
    }
    for (const i of r.incidencias) {
      if (i.severidad === 'error' || i.severidad === 'critical') issues.push(i.mensaje)
    }
    for (const e of r.evidencia) evidencia.push(e.descripcion)
    if (r.incidencias.some((i) => i.codigo === 'MEDICION_FALTANTE')) {
      issues.push(
        'Faltan mediciones en el proyecto para verificar los criterios (haz un bounce/analysis para medirlos).',
      )
    }
  }

  for (const c of cualitativos) {
    const chk = comprobarCriterioCualitativo(state, c)
    if (!chk) {
      criterios.push({ criterio: c, cumple: true, evidencia: ['criterio cualitativo verificado por el agente'] })
      evidencia.push(`Criterio cualitativo: ${c}`)
      continue
    }
    criterios.push({ criterio: c, cumple: chk.ok, evidencia: [chk.detalle] })
    if (chk.ok) evidencia.push(chk.detalle)
    else issues.push(chk.detalle)
  }

  return {
    cumple: issues.length === 0,
    issues,
    evidencia,
    criterios,
    mediciones,
  }
}

// ── Auditoría de proyecto ────────────────────────────────────────────────────

export type ResultadoAuditoriaProyecto = {
  limpio: boolean
  issues: string[]
  warnings: string[]
  resumen: { pistas: number; clips: number; notas: number; plugins: number; envios: number; sidechains: number }
  incidencias: Array<{ codigo: string; mensaje: string; severidad: string }>
  evidencia: string[]
}

/** Auditoría del proyecto: separa incidencias bloqueantes de avisos. */
export function auditarProyectoEnDAW(
  state: DAWState,
  opts: { acceptedIssues?: readonly string[] } = {},
): ResultadoAuditoriaProyecto {
  const aceptadas = new Set(opts.acceptedIssues ?? [])
  const { incidencias, evidencia, resumen } = auditarProyecto(state)
  const issues: string[] = []
  const warnings: string[] = []
  const detalle: ResultadoAuditoriaProyecto['incidencias'] = []

  for (const i of incidencias) {
    const bloqueante = AUDIT_BLOQUEANTES.has(i.codigo) && !aceptadas.has(i.codigo)
    detalle.push({ codigo: i.codigo, mensaje: i.mensaje, severidad: i.severidad })
    if (bloqueante) issues.push(i.mensaje)
    else warnings.push(i.mensaje)
  }

  return {
    limpio: issues.length === 0,
    issues,
    warnings,
    resumen,
    incidencias: detalle,
    evidencia: evidencia.map((e) => e.descripcion),
  }
}

// ── Herramientas ─────────────────────────────────────────────────────────────

type Args = Record<string, unknown>

function str(args: Args, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function num(args: Args, key: string): number | undefined {
  const v = args[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function bool(args: Args, key: string): boolean | undefined {
  const v = args[key]
  return typeof v === 'boolean' ? v : undefined
}

function strList(args: Args, key: string): string[] {
  const v = args[key]
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
}

/** Resumen del plan: porcentaje, paso actual y bloqueos. */
export function resumenPlan(plan: ReturnType<typeof leerPlan>): {
  estadoPlan: string
  revision: number
  total: number
  hechos: number
  porcentaje: number
  pasoActual: string | null
  bloqueados: string[]
  pasos: Array<{ id: string; titulo: string; estado: string; agente: string; evidencia: string[] }>
} {
  if (!plan) {
    return {
      estadoPlan: 'sin-plan',
      revision: 0,
      total: 0,
      hechos: 0,
      porcentaje: 0,
      pasoActual: null,
      bloqueados: [],
      pasos: [],
    }
  }
  const total = plan.pasos.length
  const hechos = plan.pasos.filter((p) => p.estado === 'hecho').length
  const pendientes = plan.pasos.filter((p) => p.estado === 'pendiente' || p.estado === 'en-curso')
  return {
    estadoPlan: plan.estadoPlan,
    revision: plan.revision,
    total,
    hechos,
    porcentaje: total ? Math.round((hechos / total) * 100) : 0,
    pasoActual: pendientes[0]?.id ?? null,
    bloqueados: plan.pasos.filter((p) => p.estado === 'bloqueado').map((p) => `${p.id} (${p.titulo})`),
    pasos: plan.pasos.map((p) => ({
      id: p.id,
      titulo: p.titulo,
      estado: p.estado,
      agente: p.agente,
      evidencia: p.evidencia,
    })),
  }
}

function pasoById(plan: ReturnType<typeof leerPlan>, id: string): import('@jaswave/ai-harness').PlanPaso | undefined {
  return plan?.pasos.find((p) => p.id === id)
}

/**
 * Ejecuta una herramienta de A9. `deps` inyecta estado, plan, run y baseline:
 * el módulo no depende de Electron ni de React (testeable en Node).
 */
export function runAuditTool(name: string, args: Args, deps: AuditToolDeps): AuditToolResult {
  const now = deps.now ?? (() => Date.now())
  const state = deps.state
  const planMd = deps.getPlan() ?? undefined
  const plan = leerPlan(planMd as any)
  const mediciones = medicionesDesdeEstado(state)

  switch (name) {
    case A9_TOOLS.planGet: {
      if (!plan) return fail('NO_PLAN', 'No hay plan estructurado en plan.md.')
      return ok({
        estadoPlan: plan.estadoPlan,
        revision: plan.revision,
        objetivo: plan.objetivo,
        pasos: plan.pasos.map((p) => ({
          id: p.id,
          fase: p.fase,
          agente: p.agente,
          titulo: p.titulo,
          estado: p.estado,
          criterios: p.criterios,
          herramientas: p.herramientas,
          evidencia: p.evidencia,
          motivoBloqueo: p.motivoBloqueo,
        })),
      })
    }

    case A9_TOOLS.planStatus: {
      return ok(resumenPlan(plan))
    }

    case A9_TOOLS.planUpdateStep: {
      const id = str(args, 'id')
      const estado = str(args, 'estado') as PlanPaso['estado'] | undefined
      if (!id) return fail('BAD_ARGS', 'Falta «id» del paso.')
      if (!estado) return fail('BAD_ARGS', 'Falta «estado» del paso.')
      if (!plan) return fail('NO_PLAN', 'No hay plan estructurado en plan.md.')
      const paso = pasoById(plan, id)
      if (!paso) return fail('NO_STEP', `El plan no tiene el paso ${id}.`)
      if (!deps.writePlan) return fail('NO_WRITE', 'No se puede escribir el plan en este contexto.')

      const evidencia = strList(args, 'evidencia')
      const notas = str(args, 'notas')

      // Fail closed: marcar «hecho» exige que la QA del paso pase.
      if (estado === 'hecho') {
        const auditoria = auditarPasoEnDAW(state, { id: paso.id, titulo: paso.titulo, criterios: paso.criterios }, mediciones)
        if (!auditoria.cumple) {
          return fail('QA_NOT_PASSED', `El paso ${id} no pasa la QA: ${auditoria.issues.join('; ')}`)
        }
        if (!auditoria.evidencia.length && !evidencia.length) {
          return fail('NO_EVIDENCE', `El paso ${id} no tiene evidencia para marcarlo como hecho.`)
        }
      }

      const siguiente = {
        ...paso,
        estado,
        evidencia: [...paso.evidencia, ...evidencia],
        notas: notas ? [...(paso.notas ?? []), notas] : paso.notas,
      }
      const actualizado = { ...plan, pasos: plan.pasos.map((p) => (p.id === id ? siguiente : p)) }
      const md = serializePlan(actualizado) ?? ''
      deps.writePlan(md)
      return ok({ id, estado, evidencia: siguiente.evidencia, plan: resumenPlan(actualizado) })
    }

    case A9_TOOLS.planAddStep: {
      const titulo = str(args, 'titulo')
      if (!titulo) return fail('BAD_ARGS', 'Falta «titulo» del paso.')
      if (!plan) return fail('NO_PLAN', 'No hay plan estructurado en plan.md.')
      if (!deps.writePlan) return fail('NO_WRITE', 'No se puede escribir el plan en este contexto.')
      const max = plan.pasos.reduce((acc, p) => {
        const n = Number(/^S(\d+)$/i.exec(p.id)?.[1] ?? '0')
        return Number.isFinite(n) && n > acc ? n : acc
      }, 0)
      const nuevo: PlanPaso = {
        id: `S${max + 1}`,
        fase: str(args, 'fase') ?? 'general',
        agente: (str(args, 'agente') ?? 'coproductor').replace(/^@/, ''),
        titulo,
        estado: 'pendiente',
        criterios: strList(args, 'criterios'),
        herramientas: strList(args, 'herramientas'),
        evidencia: [],
      }
      const actualizado = { ...plan, pasos: [...plan.pasos, nuevo] }
      deps.writePlan(serializePlan(actualizado))
      return ok({ id: nuevo.id, paso: nuevo, plan: resumenPlan(actualizado) })
    }

    case A9_TOOLS.planProposeChange: {
      const motivo = str(args, 'motivo')
      if (!motivo) return fail('BAD_ARGS', 'Falta «motivo» de la propuesta.')
      if (!plan) return fail('NO_PLAN', 'No hay plan estructurado en plan.md.')
      const pasos = Array.isArray(args.pasos) ? (args.pasos as Args[]) : []
      const retirar = strList(args, 'retirar')
      const propuesta = {
        motivo,
        pasos: pasos
          .map((p) => ({
            titulo: str(p, 'titulo') ?? '',
            fase: str(p, 'fase'),
            agente: str(p, 'agente'),
            criterios: strList(p, 'criterios'),
          }))
          .filter((p) => p.titulo),
        retirar,
        requiereAprobacion: true,
        creadoEn: now(),
      }
      return ok({
        propuesta,
        aplicado: false,
        mensaje: 'Propuesta registrada: el replan se aplica cuando el usuario lo apruebe.',
      })
    }

    case A9_TOOLS.runLog: {
      const runId = str(args, 'runId')
      const run = deps.getRun?.(runId)
      if (!run) return fail('NO_RUN', runId ? `No hay run ${runId}.` : 'No hay turno activo.')
      const desde = num(args, 'desde')
      const agente = str(args, 'agente')
      const herramienta = str(args, 'herramienta')
      const limite = num(args, 'limite') ?? 50
      const entradas = (run.log ?? [])
        .filter((e) => (desde === undefined ? true : e.at >= desde))
        .filter((e) => (agente ? e.role === agente : true))
        .filter((e) => (herramienta ? e.tool === herramienta : true))
        .slice(-limite)
      return ok({
        runId: run.id,
        rol: run.role,
        estado: run.status,
        total: run.log?.length ?? 0,
        entradas: entradas.map((e) => ({
          at: e.at,
          kind: e.kind,
          agente: e.role,
          herramienta: e.tool,
          args: e.args,
          status: e.status,
          mensaje: e.message,
          duracionMs: e.durationMs,
          pasoId: e.stepId,
        })),
      })
    }

    case A9_TOOLS.runDiff: {
      const desde = str(args, 'desde') ?? 'turno'
      const base = deps.getBaseline?.(desde)
      if (!base) {
        return fail('NO_BASELINE', `No hay punto de comparación «${desde}» (usa «turno» o «paso:S<n>»).`)
      }
      const diff = computeSemanticDiff(base, proyectarParaDiff(state))
      return ok({ desde, diff, resumen: resumenDiff(diff) })
    }

    case A9_TOOLS.auditProject: {
      const proyecto = auditarProyectoEnDAW(state, { acceptedIssues: deps.acceptedIssues })
      const incluirMix = bool(args, 'incluirMix') ?? false
      const data: Record<string, unknown> = { ...proyecto }
      if (incluirMix) data.mix = auditarMezclaEnDAW(state, { history: deps.history })
      return ok(data)
    }

    case A9_TOOLS.auditMix: {
      const objetivo = str(args, 'objetivo')
      const data = auditarMezclaEnDAW(state, { history: deps.history, objetivo })
      return ok(data)
    }

    case A9_TOOLS.auditStep: {
      const stepId = str(args, 'stepId')
      if (!stepId) return fail('BAD_ARGS', 'Falta «stepId».')
      if (!plan) return fail('NO_PLAN', 'No hay plan estructurado en plan.md.')
      const paso = pasoById(plan, stepId)
      if (!paso) return fail('NO_STEP', `El plan no tiene el paso ${stepId}.`)
      const r = auditarPasoEnDAW(state, { id: paso.id, titulo: paso.titulo, criterios: paso.criterios }, mediciones)
      return ok({ stepId, cumple: r.cumple, issues: r.issues, evidencia: r.evidencia, criterios: r.criterios })
    }

    case A9_TOOLS.auditHistory: {
      const history = deps.history
      if (!history) return fail('NO_HISTORY', 'No hay historial de mediciones del proyecto.')
      const metrica = str(args, 'metrica')
      const limite = num(args, 'limite') ?? 50
      const muestras = history.samples.filter((s) => (metrica ? s.metrica === metrica : true)).slice(-limite)
      return ok({ metrica: metrica ?? null, total: history.samples.length, muestras })
    }

    case A9_TOOLS.auditCompareReference: {
      const referencia = pistaDeReferencia(state)
      if (!referencia) {
        return fail('NO_REFERENCE', 'No hay pista de referencia cargada en el proyecto.')
      }
      const ref = medicionesDesdeEstado({ ...state, project: { ...state.project, analysis: { ...state.project.analysis, tracks: [referencia.analisis] } } } as DAWState)
      const r = compareReference({
        referencia: { nombre: referencia.nombre, lufs: ref.lufs, truePeak: ref.tp, plr: ref.plr },
        mediciones: { lufs: mediciones.lufs, tp: mediciones.tp, plr: mediciones.plr },
      })
      return ok(r)
    }

    case A9_TOOLS.sessionSummary: {
      const run = deps.getRun?.()
      const resumen = resumenPlan(plan)
      const s = generarSessionSummary({
        runId: run?.id ?? 'sin-turno',
        proyectoId: deps.projectId,
        pasosCompletados: resumen.hechos,
        pasosFallidos: resumen.bloqueados.length,
        herramientasUsadas: contarHerramientas(run),
      })
      return ok({
        ...s,
        objetivo: plan?.objetivo ?? null,
        plan: resumen,
        ultimasMediciones: Object.fromEntries(Object.entries(mediciones).slice(0, 8)),
        ultimosProblemas: resumen.bloqueados,
      })
    }

    default:
      return fail('UNKNOWN_TOOL', `Herramienta de auditoría desconocida: ${name}`)
  }
}

function contarHerramientas(run: EngineRunLike | undefined): Array<{ nombre: string; count: number }> {
  const conteo = new Map<string, number>()
  for (const e of run?.log ?? []) {
    if (!e.tool) continue
    conteo.set(e.tool, (conteo.get(e.tool) ?? 0) + 1)
  }
  return [...conteo.entries()].map(([nombre, count]) => ({ nombre, count })).sort((a, b) => b.count - a.count)
}

/** Resumen legible del diff semántico (para el modelo y para la UI). */
export function resumenDiff(diff: SemanticStateDiff): string {
  const partes: string[] = []
  if (diff.tracksAdded.length) partes.push(`+${diff.tracksAdded.length} pista(s)`)
  if (diff.tracksRemoved.length) partes.push(`-${diff.tracksRemoved.length} pista(s)`)
  if (diff.tracksModified.length) partes.push(`~${diff.tracksModified.length} pista(s) modificada(s)`)
  if (diff.clipsAdded) partes.push(`+${diff.clipsAdded} clip(s)`)
  if (diff.clipsRemoved) partes.push(`-${diff.clipsRemoved} clip(s)`)
  if (diff.notesAdded) partes.push(`+${diff.notesAdded} nota(s)`)
  if (diff.notesRemoved) partes.push(`-${diff.notesRemoved} nota(s)`)
  if (diff.pluginParamChanges.length) partes.push(`${diff.pluginParamChanges.length} parámetro(s)`)
  if (diff.volumeChanges.length) partes.push(`${diff.volumeChanges.length} volumen(es)`)
  if (diff.sendsAdded) partes.push(`+${diff.sendsAdded} envío(s)`)
  if (diff.sidechainsAdded) partes.push(`+${diff.sidechainsAdded} sidechain(s)`)
  return partes.length ? partes.join(' · ') : 'sin cambios'
}

/** Auditoría de mezcla con las mediciones del estado y comparación con el historial. */
export function auditarMezclaEnDAW(
  state: DAWState,
  opts: { history?: AnalysisHistoryLike; objetivo?: string } = {},
): {
  cumpleCriterios: boolean
  mediciones: Record<string, number>
  issues: string[]
  warnings: string[]
  objetivo: string
} {
  const mediciones = medicionesDesdeEstado(state)
  const r = auditMixCore({
    runId: 'auditoria',
    mediciones,
    contexto: opts.history ? { history: opts.history } : undefined,
  } as Parameters<typeof auditMixCore>[0])
  const issues = r.incidencias.filter((i) => i.severidad === 'error' || i.severidad === 'critical').map((i) => i.mensaje)
  const warnings = r.incidencias.filter((i) => i.severidad === 'warning').map((i) => i.mensaje)
  return {
    cumpleCriterios: r.cumpleCriterios,
    mediciones,
    issues,
    warnings,
    objetivo: opts.objetivo ?? 'streaming (-14 LUFS)',
  }
}

function pistaDeReferencia(state: DAWState): { nombre: string; analisis: NonNullable<DAWState['project']['analysis']['tracks']>[number] } | null {
  const tracks = state.project?.tracks ?? []
  const ref = tracks.find((t) => /ref|referencia/i.test(t.nombre ?? ''))
  if (!ref) return null
  const analisis = state.project?.analysis?.tracks?.find((t) => t.trackId === ref.id)
  if (!analisis) return null
  return { nombre: ref.nombre ?? ref.id, analisis }
}
