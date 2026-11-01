/** Fase en vivo del agente, para la Terminal (fuera del chat). */

let phase = ''
let startedAt = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

export function setAgentRuntimePhase(next: string): void {
  if (phase === next) return
  if (!phase && next) startedAt = Date.now()
  if (!next) startedAt = 0
  phase = next
  notify()
}

export function getAgentRuntimePhase(): string {
  return phase
}

export function getAgentRuntimeStartedAt(): number {
  return startedAt
}

export function subscribeAgentRuntimePhase(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
