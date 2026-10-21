/**
 * Plan estructurado de A4: `plan.md` como fuente de verdad del trabajo.
 *
 * Formato:
 * ```markdown
 * # Plan · <objetivo corto>
 * > Objetivo: <pedido> · Modo: create · Estado: borrador (2026-10-20) · Revisión: 1
 *
 * ## Pasos
 * - [ ] S1 · estructura · @coproductor — Crear pista «Batería»
 *   - criterio: la pista existe y suena con ≥1.5 notas/beat
 *   - herramientas: track.create
 *   - evidencia: …
 *   - bloqueado: <motivo>
 *
 * ## Notas del usuario
 * (texto libre que el motor nunca reescribe)
 * ```
 *
 * Marcas: `[ ]` pendiente · `[~]` en curso · `[x]` hecho · `[-]` omitido · `[!]` bloqueado.
 * Parseo tolerante a ediciones a mano: líneas sin id → id nuevo; sin agente → `director`.
 */

export const PLAN_PASOS_HEADING = 'Pasos'
export const PLAN_NOTAS_HEADING = 'Notas del usuario'

export type PlanStepEstado = 'pendiente' | 'en-curso' | 'hecho' | 'omitido' | 'bloqueado'

export type PlanPaso = {
  id: string
  fase: string
  agente: string
  titulo: string
  estado: PlanStepEstado
  criterios: string[]
  herramientas: string[]
  evidencia: string[]
  /** Notas del agente sobre el paso (no son evidencia ni criterios). */
  notas?: string[]
  motivoBloqueo?: string
}

export type PlanEstructurado = {
  titulo: string
  objetivo: string
  modo: string
  estadoPlan: 'borrador' | 'aprobado'
  fecha: string
  revision: number
  pasos: PlanPaso[]
  notasUsuario: string
}

const MARK_TO_ESTADO: Record<string, PlanStepEstado> = {
  ' ': 'pendiente',
  '~': 'en-curso',
  x: 'hecho',
  X: 'hecho',
  '-': 'omitido',
  '!': 'bloqueado',
}

const ESTADO_TO_MARK: Record<PlanStepEstado, string> = {
  pendiente: ' ',
  'en-curso': '~',
  hecho: 'x',
  omitido: '-',
  bloqueado: '!',
}

/** Encabezado de paso: `- [X] S1 · Fase · @agente — Título`. */
const STEP_RE = /^\s*[-*]\s*\[([ xX~!-])\]\s*(?:([A-Za-z0-9_-]+)\s*·\s*)?(.*?)\s*$/
const AGENT_RE = /@([A-Za-z0-9_.-]+)/

function hoy(): string {
  return new Date().toISOString().slice(0, 10)
}

/** ¿El markdown tiene el formato estructurado de A4 (sección «## Pasos»)? */
export function isStructuredPlan(md: string | null | undefined): boolean {
  return Boolean(md && /^##\s+Pasos\s*$/im.test(md))
}

function parseMetaLine(line: string): Pick<PlanEstructurado, 'objetivo' | 'modo' | 'estadoPlan' | 'fecha' | 'revision'> {
  const objetivo = /Objetivo:\s*(.*?)\s*(?=·\s*Modo:|$)/i.exec(line)?.[1]?.trim() ?? ''
  const modo = /Modo:\s*([a-z]+)/i.exec(line)?.[1]?.trim() ?? 'create'
  const estadoRaw = /Estado:\s*(borrador|aprobado)/i.exec(line)?.[1]?.toLowerCase() ?? 'borrador'
  const fecha = /\(([^)]+)\)/.exec(line)?.[1]?.trim() ?? ''
  const revision = Number(/Revisi[oó]n:\s*(\d+)/i.exec(line)?.[1] ?? '0')
  return {
    objetivo,
    modo,
    estadoPlan: estadoRaw === 'aprobado' ? 'aprobado' : 'borrador',
    fecha,
    revision: Number.isFinite(revision) ? revision : 0,
  }
}

function splitStepRest(rest: string): { fase: string; agente: string; titulo: string; motivo?: string } {
  // «Fase · @agente — Título» (con separadores opcionales)
  let fase = ''
  let agente = 'director'
  let titulo = rest
  let motivo: string | undefined

  const agentHit = AGENT_RE.exec(rest)
  if (agentHit) {
    agente = agentHit[1]!
    const before = rest.slice(0, agentHit.index).replace(/[·,\s-]+$/, '').trim()
    const after = rest.slice(agentHit.index + agentHit[0].length).replace(/^[\s—–-]+/, '').trim()
    if (before) fase = before.replace(/·\s*$/, '').trim()
    titulo = after || rest
  } else if (rest.includes('·')) {
    const parts = rest.split('·')
    fase = parts[0]!.trim()
    titulo = parts.slice(1).join('·').replace(/^[\s—–-]+/, '').trim() || rest
  } else {
    const dash = /\s+[—–]\s+/.exec(rest)
    if (dash) {
      fase = rest.slice(0, dash.index).trim()
      titulo = rest.slice(dash.index + dash[0].length).trim() || rest
    }
  }
  const bloqueo = /bloqueado:\s*(.+)$/i.exec(titulo)
  if (bloqueo) {
    motivo = bloqueo[1]!.trim()
    titulo = titulo.slice(0, bloqueo.index).replace(/[\s—–-]+$/, '').trim()
  }
  return { fase, agente, titulo: titulo || rest, motivo }
}

function subField(line: string, name: string): string | null {
  const re = new RegExp(`^\\s+-\\s*${name}:\\s*(.*)$`, 'i')
  const m = re.exec(line)
  return m ? m[1]!.trim() : null
}

/** Parsea plan.md en formato estructurado; null si no lo es (formato viejo o vacío). */
export function parsePlan(md: string | null | undefined): PlanEstructurado | null {
  if (!md || !isStructuredPlan(md)) return null
  const lines = md.split(/\r?\n/)
  const titulo = /^#\s+Plan\s*[·:]\s*(.+)$/im.exec(md)?.[1]?.trim() ?? 'Plan'
  const metaLine = /^>\s*(.*)$/m.exec(md)?.[1] ?? ''
  const meta = parseMetaLine(metaLine)

  const pasos: PlanPaso[] = []
  let enPasos = false
  let notasStart = -1
  let nextId = 1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^##\s+/.test(line)) {
      const h = /^##\s+(.*)$/.exec(line)?.[1]?.trim() ?? ''
      if (h === PLAN_PASOS_HEADING) {
        enPasos = true
        continue
      }
      if (h === PLAN_NOTAS_HEADING) {
        notasStart = i + 1
        enPasos = false
        continue
      }
      enPasos = false
      continue
    }
    if (!enPasos) continue
    const m = STEP_RE.exec(line)
    if (!m) continue
    const mark = m[1]!
    const estado = MARK_TO_ESTADO[mark] ?? 'pendiente'
    let id = m[2] ?? ''
    const rest = m[3]!.trim()
    const num = Number(/^S(\d+)$/i.exec(id)?.[1] ?? '')
    if (Number.isFinite(num) && num >= nextId) nextId = num + 1
    if (!id) id = `S${nextId++}`
    const { fase, agente, titulo: stepTitulo, motivo } = splitStepRest(rest)
    const paso: PlanPaso = {
      id,
      fase,
      agente,
      titulo: stepTitulo,
      estado,
      criterios: [],
      herramientas: [],
      evidencia: [],
      notas: [],
    }
    if (motivo) paso.motivoBloqueo = motivo
    // Sublíneas indentadas del paso.
    while (i + 1 < lines.length) {
      const nxt = lines[i + 1]!
      if (STEP_RE.test(nxt) || /^\s*[-*]\s*\[/.test(nxt) || /^#/.test(nxt.trim())) break
      if (!/^\s+-\s+\S/.test(nxt)) break
      i += 1
      const crit = subField(nxt, 'criterio')
      if (crit !== null) {
        paso.criterios.push(crit)
        continue
      }
      const herr = subField(nxt, 'herramientas')
      if (herr !== null) {
        paso.herramientas.push(...herr.split(',').map((s) => s.trim()).filter(Boolean))
        continue
      }
      const evid = subField(nxt, 'evidencia')
      if (evid !== null) {
        paso.evidencia.push(evid)
        continue
      }
      const blo = subField(nxt, 'bloqueado')
      if (blo !== null) {
        paso.motivoBloqueo = blo
        continue
      }
      const nota = subField(nxt, 'nota')
      if (nota !== null) {
        paso.notas!.push(nota)
        continue
      }
    }
    pasos.push(paso)
  }

  const notasUsuario = notasStart >= 0 ? lines.slice(notasStart).join('\n').replace(/\n+$/, '') : ''
  return {
    titulo,
    objetivo: meta.objetivo,
    modo: meta.modo,
    estadoPlan: meta.estadoPlan,
    fecha: meta.fecha,
    revision: meta.revision,
    pasos,
    notasUsuario,
  }
}

/** Serializa a markdown canónico (round-trip estable con `parsePlan`). */
export function serializePlan(plan: PlanEstructurado): string {
    const pasos = plan.pasos.map((p) => {
      const mark = ESTADO_TO_MARK[p.estado] ?? ' '
      const head = `- [${mark}] ${p.id} - ${p.fase || 'general'} - @${p.agente || 'director'} - ${p.titulo}`
      const sub: string[] = []
      for (const c of p.criterios) sub.push(`  - criterio: ${c}`)
      if (p.herramientas.length) sub.push(`  - herramientas: ${p.herramientas.join(', ')}`)
      for (const e of p.evidencia) sub.push(`  - evidencia: ${e}`)
      for (const n of p.notas ?? []) sub.push(`  - nota: ${n}`)
      if (p.estado === 'bloqueado' && p.motivoBloqueo) sub.push(`  - bloqueado: ${p.motivoBloqueo}`)
      return [head, ...sub].join('\n')
    })
  return [
    `# Plan · ${plan.titulo || 'Plan'}`,
    '',
    `> Objetivo: ${plan.objetivo || '—'} · Modo: ${plan.modo || 'create'} · Estado: ${plan.estadoPlan} (${plan.fecha || hoy()}) · Revisión: ${plan.revision}`,
    '',
    `## ${PLAN_PASOS_HEADING}`,
    pasos.length ? pasos.join('\n') : '_Sin pasos todavía._',
    '',
    `## ${PLAN_NOTAS_HEADING}`,
    plan.notasUsuario || '_Tus notas no se pisan automáticamente._',
    '',
  ].join('\n')
}

function canon(plan: PlanEstructurado): string {
  return serializePlan({ ...plan, fecha: '' })
}

/** Hash estable del contenido del plan (para detectar ediciones del usuario). */
export function planHash(md: string | PlanEstructurado): string {
  const plan = typeof md === 'string' ? parsePlan(md) : md
  if (!plan) {
    const s = typeof md === 'string' ? md : ''
    let h = 5381
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
    return `raw:${(h >>> 0).toString(36)}`
  }
  let h = 5381
  const s = canon(plan)
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `p:${(h >>> 0).toString(36)}`
}

export type PlanDiff = {
  added: PlanPaso[]
  removed: PlanPaso[]
  edited: PlanPaso[]
  /** Ids cuyo orden cambió respecto a `a`. */
  reordered: string[]
  changed: boolean
}

/** Diferencias entre dos planes por id de paso (para re-sincronizar ediciones del usuario). */
export function diffPlans(a: PlanEstructurado, b: PlanEstructurado): PlanDiff {
  const before = new Map(a.pasos.map((p) => [p.id, p]))
  const after = new Map(b.pasos.map((p) => [p.id, p]))
  const added: PlanPaso[] = []
  const removed: PlanPaso[] = []
  const edited: PlanPaso[] = []
  for (const [id, p] of after) {
    const prev = before.get(id)
    if (!prev) added.push(p)
    else if (JSON.stringify(prev) !== JSON.stringify(p)) edited.push(p)
  }
  for (const [id, p] of before) if (!after.has(id)) removed.push(p)
  const common = a.pasos.filter((p) => after.has(p.id)).map((p) => p.id)
  const commonAfter = b.pasos.filter((p) => before.has(p.id)).map((p) => p.id)
  const reordered = common.filter((id, i) => commonAfter[i] !== id)
  return { added, removed, edited, reordered, changed: added.length + removed.length + edited.length + reordered.length > 0 }
}

/** Siguiente paso sobre el que trabajar: pendientes en orden; omitidos/hechos/bloqueados se saltan. */
export function siguientePasoPendiente(plan: PlanEstructurado): PlanPaso | undefined {
  return plan.pasos.find((p) => p.estado === 'pendiente')
}

/** Copia del plan con el paso marcado (inmutable). `evidencia` se añade a la existente. */
export function marcarPaso(
  plan: PlanEstructurado,
  id: string,
  estado: PlanStepEstado,
  opts?: { evidencia?: string[]; motivoBloqueo?: string },
): PlanEstructurado {
  return {
    ...plan,
    pasos: plan.pasos.map((p) => {
      if (p.id !== id) return p
      const next: PlanPaso = {
        ...p,
        estado,
        criterios: [...p.criterios],
        herramientas: [...p.herramientas],
        evidencia: opts?.evidencia?.length ? [...p.evidencia, ...opts.evidencia] : [...p.evidencia],
      }
      if (opts?.motivoBloqueo !== undefined) next.motivoBloqueo = opts.motivoBloqueo
      return next
    }),
  }
}

/** Copia del plan aprobado (borrador → aprobado, revisión + 1). */
export function aprobarPlan(plan: PlanEstructurado, fecha = hoy()): PlanEstructurado {
  return { ...plan, estadoPlan: 'aprobado', fecha, revision: plan.revision + 1 }
}

/** ¿El plan aprobado tiene pasos por hacer? */
export function hayPasosPendientes(plan: PlanEstructurado): boolean {
  return plan.pasos.some((p) => p.estado === 'pendiente' || p.estado === 'en-curso')
}
