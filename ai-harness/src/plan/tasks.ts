/**
 * Utilidades de tareas plan.md (sin persistencia).
 */

import { parsePlanTasks } from './eval'

export function planHasOpenTasks(markdown: string | null | undefined): boolean {
  if (!markdown?.trim()) return false
  return parsePlanTasks(markdown).some((t) => !t.done && !/añade tareas/i.test(t.text))
}
