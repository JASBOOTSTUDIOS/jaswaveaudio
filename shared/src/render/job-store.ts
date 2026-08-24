/**
 * Store en memoria de RenderJob (no persiste en .jaswave).
 */

import type { RenderJob } from '../types/render'

const jobs = new Map<string, RenderJob>()

export function renderJobPut(job: RenderJob): void {
  jobs.set(job.id, job)
}

export function renderJobGet(id: string): RenderJob | undefined {
  return jobs.get(id)
}

export function renderJobUpdate(id: string, patch: Partial<RenderJob>): RenderJob | undefined {
  const cur = jobs.get(id)
  if (!cur) return undefined
  const next = { ...cur, ...patch }
  jobs.set(id, next)
  return next
}

export function renderJobList(): RenderJob[] {
  return [...jobs.values()]
}

export function renderJobActive(): RenderJob | undefined {
  return [...jobs.values()].find((j) => j.status === 'pending' || j.status === 'rendering')
}
