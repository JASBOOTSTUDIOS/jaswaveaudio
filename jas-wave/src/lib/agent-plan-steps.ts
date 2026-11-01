/**
 * Operaciones del plan estructurado (A4) sobre plan.md: las usa el editor de
 * Docs (vista de pasos) y las pruebas. Todo pasa por parse/serialize del
 * formato estructurado; las Notas del usuario se conservan siempre.
 */

import {
  aprobarPlan,
  marcarPaso,
  parsePlan,
  serializePlan,
  siguientePasoPendiente,
  type PlanEstructurado,
  type PlanPaso,
} from '@jaswave/ai-harness'

export type { PlanEstructurado, PlanPaso }

/** Parsea el markdown del plan; null si no tiene el formato estructurado. */
export function leerPlan(md: string): PlanEstructurado | null {
  return parsePlan(md)
}

function write(plan: PlanEstructurado): string {
  return serializePlan(plan)
}

/** Marca/desmarca un paso como hecho. Devuelve el markdown o null si no cambia. */
export function alternarPasoHecho(md: string, id: string): string | null {
  const plan = parsePlan(md)
  const paso = plan?.pasos.find((p) => p.id === id)
  if (!plan || !paso) return null
  const estado = paso.estado === 'hecho' ? 'pendiente' : 'hecho'
  return write(marcarPaso(plan, id, estado))
}

/** Marca un paso como omitido. */
export function omitirPaso(md: string, id: string): string | null {
  const plan = parsePlan(md)
  if (!plan || !plan.pasos.some((p) => p.id === id)) return null
  return write(marcarPaso(plan, id, 'omitido'))
}

/** Vuelve a poner un paso omitido/bloqueado/hecho en pendiente. */
export function reanudarPaso(md: string, id: string): string | null {
  const plan = parsePlan(md)
  if (!plan || !plan.pasos.some((p) => p.id === id)) return null
  return write(marcarPaso(plan, id, 'pendiente'))
}

/** Añade un paso pendiente al final. `siguienteId` = S<último+1>. */
export function agregarPaso(
  md: string,
  titulo: string,
  opts?: { fase?: string; agente?: string; criterios?: string[]; herramientas?: string[] },
): string | null {
  const plan = parsePlan(md)
  const t = titulo.replace(/\s+/g, ' ').trim()
  if (!plan || !t) return null
  const max = plan.pasos.reduce((acc, p) => {
    const n = Number(/^S(\d+)$/i.exec(p.id)?.[1] ?? '0')
    return Number.isFinite(n) && n > acc ? n : acc
  }, 0)
  const paso: PlanPaso = {
    id: `S${max + 1}`,
    fase: opts?.fase?.trim() || 'general',
    agente: opts?.agente?.replace(/^@/, '').trim() || 'coproductor',
    titulo: t,
    estado: 'pendiente',
    criterios: opts?.criterios ?? [],
    herramientas: opts?.herramientas ?? [],
    evidencia: [],
  }
  return write({ ...plan, pasos: [...plan.pasos, paso] })
}

/** Aprobar el plan (borrador → aprobado, revisión + 1). Null si ya estaba aprobado. */
export function aprobarPlanMd(md: string, fecha?: string): string | null {
  const plan = parsePlan(md)
  if (!plan || plan.estadoPlan === 'aprobado') return null
  return write(aprobarPlan(plan, fecha))
}

/** Vuelve a borrador (para re-editar antes de re-ejecutar). */
export function volverABorrador(md: string): string | null {
  const plan = parsePlan(md)
  if (!plan || plan.estadoPlan === 'borrador') return null
  return write({ ...plan, estadoPlan: 'borrador' })
}

/** Texto del paso para pedirle a la IA que lo ejecute (mensaje de turno). */
export function mensajeDeEjecucionDePaso(paso: PlanPaso): string {
  const lineas = [
    `Implementa SOLO la sección del paso ${paso.id} del plan: «${paso.titulo}».`,
    paso.fase ? `Fase: ${paso.fase}.` : '',
    `Agente asignado: @${paso.agente}.`,
    paso.criterios.length ? `Criterios de aceptación:\n${paso.criterios.map((c) => `- ${c}`).join('\n')}` : '',
    paso.herramientas.length ? `Herramientas permitidas: ${paso.herramientas.join(', ')}.` : '',
    'Emite <<<ACTIONS>>> reales vía el Tool Registry. No reescribas el plan entero ni Notas del usuario.',
    `Cuando termines con evidencia, marca ${paso.id} [x] en plan.md con una línea «evidencia:».`,
  ]
  return lineas.filter(Boolean).join('\n')
}

/** Primer paso que la ejecución debe intentar (pendientes en orden). */
export function pasoSiguienteDeEjecucion(plan: PlanEstructurado): PlanPaso | undefined {
  return siguientePasoPendiente(plan)
}

/** Resumen corto para la UI: «3/5 · 1 bloqueado». */
export function resumenPasos(plan: PlanEstructurado): string {
  const total = plan.pasos.length
  const hechos = plan.pasos.filter((p) => p.estado === 'hecho').length
  const bloqueados = plan.pasos.filter((p) => p.estado === 'bloqueado').length
  const omitidos = plan.pasos.filter((p) => p.estado === 'omitido').length
  const partes = [`${hechos}/${total}`]
  if (bloqueados) partes.push(`${bloqueados} bloqueado${bloqueados > 1 ? 's' : ''}`)
  if (omitidos) partes.push(`${omitidos} omitido${omitidos > 1 ? 's' : ''}`)
  return partes.join(' · ')
}
