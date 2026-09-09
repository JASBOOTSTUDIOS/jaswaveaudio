/**
 * Sesiones de la Terminal (estilo VS Code): varias instancias, split y kill.
 */

import {
  listAiDawAudit,
  subscribeAiDawAudit,
  type AiDawAuditEntry,
} from './ai-daw-audit-store'

export type TerminalLine = {
  id: string
  kind: 'in' | 'out' | 'err' | 'sys' | 'help' | 'agent'
  text: string
}

export type TerminalSession = {
  id: string
  name: string
  lines: TerminalLine[]
  history: string[]
  cwd: string[]
}

type TerminalState = {
  sessions: TerminalSession[]
  panes: [string] | [string, string]
  focusedPane: 0 | 1
}

const listeners = new Set<() => void>()
let seq = 1

function notify(): void {
  for (const l of listeners) l()
}

function newId(): string {
  return `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function banner(): TerminalLine[] {
  return [
    {
      id: newId(),
      kind: 'sys',
      text: 'JasWave CLI  ·  escribe ayuda',
    },
  ]
}

function makeSession(): TerminalSession {
  const n = seq++
  return {
    id: newId(),
    name: `jaswave-${n}`,
    lines: banner(),
    history: [],
    cwd: [],
  }
}

let state: TerminalState = (() => {
  const first = makeSession()
  return { sessions: [first], panes: [first.id], focusedPane: 0 }
})()

export function subscribeTerminalSessions(cb: () => void): () => void {
  ensureTerminalAuditMirror()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function getTerminalState(): TerminalState {
  return state
}

function setState(next: TerminalState): void {
  state = next
  notify()
}

export function createTerminalSession(assignToFocused = true): string {
  const session = makeSession()
  const sessions = [...state.sessions, session]
  if (!assignToFocused) {
    setState({ ...state, sessions })
    return session.id
  }
  const panes = [...state.panes] as TerminalState['panes']
  panes[state.focusedPane] = session.id
  setState({ ...state, sessions, panes })
  return session.id
}

export function selectTerminalSession(id: string): void {
  if (!state.sessions.some((s) => s.id === id)) return
  const panes = [...state.panes] as TerminalState['panes']
  panes[state.focusedPane] = id
  setState({ ...state, panes })
}

export function focusTerminalPane(index: 0 | 1): void {
  if (index === 1 && state.panes.length < 2) return
  if (state.focusedPane === index) return
  setState({ ...state, focusedPane: index })
}

export function splitTerminal(): void {
  if (state.panes.length >= 2) return
  const id = createTerminalSession(false)
  setState({
    ...state,
    panes: [state.panes[0], id],
    focusedPane: 1,
  })
}

export function unsplitTerminal(): void {
  if (state.panes.length < 2) return
  const keep = state.panes[state.focusedPane]
  if (!keep) return
  setState({ ...state, panes: [keep], focusedPane: 0 })
}

export function killFocusedTerminal(): void {
  const id = state.panes[state.focusedPane]
  let sessions = state.sessions.filter((s) => s.id !== id)
  if (sessions.length === 0) {
    const fresh = makeSession()
    sessions = [fresh]
    setState({ sessions, panes: [fresh.id], focusedPane: 0 })
    return
  }
  const fallback = sessions[sessions.length - 1]!.id
  if (state.panes.length === 2) {
    const other = state.panes[state.focusedPane === 0 ? 1 : 0]
    if (other === id) {
      setState({ sessions, panes: [fallback], focusedPane: 0 })
      return
    }
    setState({ sessions, panes: [other], focusedPane: 0 })
    return
  }
  setState({ sessions, panes: [fallback], focusedPane: 0 })
}

export function appendTerminalLine(sessionId: string, kind: TerminalLine['kind'], text: string): void {
  setState({
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === sessionId
        ? { ...s, lines: [...s.lines, { id: newId(), kind, text }].slice(-500) }
        : s,
    ),
  })
}

export function pushTerminalHistory(sessionId: string, line: string): void {
  const t = line.trim()
  if (!t) return
  setState({
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === sessionId ? { ...s, history: [...s.history.filter((h) => h !== t), t].slice(-80) } : s,
    ),
  })
}

export function clearTerminalSession(sessionId: string): void {
  setState({
    ...state,
    sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, lines: banner() } : s)),
  })
}

export function setTerminalCwd(sessionId: string, cwd: string[]): void {
  setState({
    ...state,
    sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, cwd } : s)),
  })
}

const mirroredAudit = new Set<string>()
let mirroring = false

function auditDetail(e: AiDawAuditEntry): string {
  const p = e.params ?? {}
  for (const k of ['nombre', 'name', 'pistaNombre', 'clipNombre', 'pista'] as const) {
    const v = p[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  const msg = e.result?.error || e.result?.message
  return typeof msg === 'string' ? msg.replace(/\s+/g, ' ').slice(0, 90) : ''
}

function formatAgentAuditLine(e: AiDawAuditEntry): string {
  const pending =
    e.status === 'proposed' ||
    e.status === 'pending_confirm' ||
    (e.result?.message === 'Pendiente de Aplicar' && e.result?.success !== false && e.status !== 'failed')
  const failed =
    !pending && (e.status === 'failed' || e.result?.success === false)
  const running = e.status === 'proposed' || e.status === 'pending_confirm' || pending
  const st = failed ? 'fail' : running ? 'pendiente' : 'ok'
  return `${e.tool}\t${st}\t${auditDetail(e)}`
}

function echoAuditToTerminal(e: AiDawAuditEntry): void {
  try {
    if (e.source === 'cli') return
    if (mirroredAudit.has(e.id)) return
    mirroredAudit.add(e.id)
    const target = state.panes[state.focusedPane] ?? state.sessions[0]?.id
    if (!target) return
    const line: TerminalLine = {
      id: e.id,
      kind: 'agent',
      text: formatAgentAuditLine(e),
    }
    setState({
      ...state,
      sessions: state.sessions.map((s) =>
        s.id === target ? { ...s, lines: [...s.lines, line].slice(-500) } : s,
      ),
    })
  } catch {
    /* no tumbar el turno de la IA */
  }
}

/** Espejo del log IA → DAW en la sesión de Terminal activa. */
export function ensureTerminalAuditMirror(): void {
  if (mirroring) return
  mirroring = true
  try {
    const target = state.panes[state.focusedPane] ?? state.sessions[0]?.id
    const pending: TerminalLine[] = []
    for (const e of [...listAiDawAudit(80)].reverse()) {
      if (e.source === 'cli' || mirroredAudit.has(e.id)) continue
      mirroredAudit.add(e.id)
      pending.push({ id: e.id, kind: 'agent', text: formatAgentAuditLine(e) })
    }
    if (target && pending.length) {
      setState({
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === target ? { ...s, lines: [...s.lines, ...pending].slice(-500) } : s,
        ),
      })
    }
    subscribeAiDawAudit(() => {
      try {
        for (const e of [...listAiDawAudit(40)].reverse()) echoAuditToTerminal(e)
      } catch {
        /* ignore */
      }
    })
  } catch {
    mirroring = false
  }
}
