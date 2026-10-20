/**
 * Motor de turnos headless (A1): `runTurn(input)` → eventos + `EngineRun` persistido.
 *
 * Ciclo de vida de un run:
 *   running → completed | failed | cancelled
 *   running → waiting-user  (needs-user)  → answer() → running …
 *   running → paused (pause())            → resume() → running …
 *   running → interrupted (recarga)       → resume() → running …
 */

import { createAgentBudgetTracker, resolveAgentBudget } from '../agent/budget'
import type {
  EngineAnswer,
  EngineEvent,
  EngineEventPayload,
  EngineHost,
  EngineTurnResult,
  TurnHandle,
  TurnInput,
  TurnProgram,
  TurnProgramOutcome,
} from './engine-types'
import { modeCapabilities } from './mode-capabilities'
import { createEngineRun, isTerminalRunStatus, type EngineRun } from './run-state'
import { createToolLoopProgram } from './tool-loop'
import { createTurnContext } from './turn-context'

export type TurnEngine = {
  runTurn(input: TurnInput): TurnHandle
  /** Respuesta del usuario a un `needs-user` (aprobar plan, confirmar, aclarar, aplicar…). */
  answer(runId: string, answer: EngineAnswer): TurnHandle
  /** Reanuda un run pausado o interrumpido (tras recargar la ventana). */
  resume(runId: string): TurnHandle
  cancel(runId: string): boolean
  pause(runId: string): boolean
  /**
   * A5: deshace el último snapshot del turno (capturado al empezar a ejecutar el plan)
   * vía `host.restoreSnapshot`. false si no hay snapshot o el host no restaura.
   */
  undoTurn(runId: string): Promise<boolean>
  /** A5: deshace el último paso capturado (LIFO). false si no hay pasos que deshacer. */
  undoStep(runId: string): Promise<boolean>
  getRun(runId: string): EngineRun | undefined
  /** Carga un run de memoria o del almacén del host. */
  loadRun(runId: string): Promise<EngineRun | null>
  isActive(runId: string): boolean
  subscribe(listener: (e: EngineEvent) => void): () => void
}

export type CreateTurnEngineOptions = {
  /** Programas extra (se enrutan por `run.programId`). */
  programs?: TurnProgram[]
}

class EventQueue implements AsyncIterable<EngineEvent> {
  private buf: EngineEvent[] = []
  private waiters: Array<(r: IteratorResult<EngineEvent>) => void> = []
  private closed = false
  push(e: EngineEvent) {
    const w = this.waiters.shift()
    if (w) w({ value: e, done: false })
    else this.buf.push(e)
  }
  close() {
    this.closed = true
    for (const w of this.waiters.splice(0)) w({ value: undefined as unknown as EngineEvent, done: true })
  }
  [Symbol.asyncIterator](): AsyncIterator<EngineEvent> {
    return {
      next: () => {
        const e = this.buf.shift()
        if (e) return Promise.resolve({ value: e, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as unknown as EngineEvent, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      },
    }
  }
}

function isAbortError(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError'
}

export function createTurnEngine(host: EngineHost, options: CreateTurnEngineOptions = {}): TurnEngine {
  const toolLoop = createToolLoopProgram()
  const programs = new Map<string, TurnProgram>()
  programs.set(toolLoop.id, toolLoop)
  for (const p of options.programs ?? []) programs.set(p.id, p)
  if (host.program) programs.set(host.program.id, host.program)
  const defaultProgram = host.program ?? toolLoop

  const runs = new Map<string, EngineRun>()
  const active = new Map<string, { controller: AbortController; pauseRequested: boolean }>()
  const listeners = new Set<(e: EngineEvent) => void>()
  /** Snapshots A5 en memoria (no se persisten): el host decide qué serializar. */
  const snapshots = new Map<string, { turn?: unknown; steps: Array<{ id: string; snap: unknown }> }>()
  let seq = 0

  const newId = (prefix: string): string => {
    const custom = host.newId?.(prefix)
    if (custom) return custom
    seq += 1
    return `${prefix}-${host.now().toString(36)}-${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
  }

  const persist = async (run: EngineRun) => {
    run.updatedAt = host.now()
    try {
      await host.persistRun?.(run)
    } catch (e) {
      host.log?.('warn', 'engine: no se pudo persistir el run', { runId: run.id, error: String(e) })
    }
  }

  const loadRun = async (runId: string): Promise<EngineRun | null> => {
    const mem = runs.get(runId)
    if (mem) return mem
    const loaded = (await host.loadRun?.(runId)) ?? null
    if (loaded) runs.set(runId, loaded)
    return loaded
  }

  type Phase = { kind: 'run' } | { kind: 'answer'; answer: EngineAnswer } | { kind: 'resume' }

  function start(runId: string, prepare: () => Promise<EngineRun>, phase: Phase, history?: TurnInput['history']): TurnHandle {
    const queue = new EventQueue()
    const controller = new AbortController()
    const slot = { controller, pauseRequested: false }
    let resolveResult!: (r: EngineTurnResult) => void
    const result = new Promise<EngineTurnResult>((r) => (resolveResult = r))

    const emitFor = (run: EngineRun) => (payload: EngineEventPayload) => {
      const e = { ...payload, runId: run.id, at: host.now() } as EngineEvent
      queue.push(e)
      for (const l of listeners) {
        try {
          l(e)
        } catch {
          /* un listener roto no detiene el turno */
        }
      }
    }

    const exec = async () => {
      let run: EngineRun
      try {
        run = await prepare()
      } catch (e) {
        const fake = { id: runId } as EngineRun
        const msg = e instanceof Error ? e.message : String(e)
        emitFor(fake)({ type: 'turn.failed', reason: 'error', error: msg })
        queue.close()
        resolveResult({ runId, status: 'failed', summary: msg, run: fake })
        return
      }
      runs.set(run.id, run)
      active.set(run.id, slot)
      const emit = emitFor(run)
      const program = programs.get(run.programId) ?? defaultProgram
      const budget = createAgentBudgetTracker(run.budget.budget, () => host.now(), {
        modelCalls: run.budget.modelCalls,
        inputChars: run.budget.inputChars,
        elapsedMs: run.budget.elapsedMs,
      })
      const startedUsage = budget.usage()
      const ctx = createTurnContext({
        run,
        host,
        signal: controller.signal,
        budget,
        capabilities: modeCapabilities(run.mode),
        emit,
        persist: () => persist(run),
        newId,
        history,
        rememberSnapshot: (kind, snap, stepId) => {
          let entry = snapshots.get(run.id)
          if (!entry) {
            entry = { steps: [] }
            snapshots.set(run.id, entry)
          }
          if (kind === 'turn') entry.turn = snap
          else entry.steps.push({ id: stepId ?? `paso-${entry.steps.length + 1}`, snap })
        },
      })
      const pendingNeed = run.pending
      run.status = 'running'
      run.pending = undefined
      run.error = undefined
      emit({
        type: 'turn.started',
        mode: run.mode,
        conversationId: run.conversationId,
        messageId: run.messageId,
        text: run.userText,
        kind: run.kind,
        resumed: phase.kind !== 'run',
      })
      if (phase.kind === 'answer') {
        ctx.log({ kind: 'answer', message: JSON.stringify({ approved: phase.answer.approved, text: phase.answer.text?.slice(0, 120) }) })
      }
      await persist(run)

      let outcome: TurnProgramOutcome
      let cancelled = false
      try {
        if (phase.kind === 'answer') {
          if (!pendingNeed) throw new Error('El run no tiene una petición pendiente')
          if (phase.answer.needId && phase.answer.needId !== pendingNeed.id) {
            throw new Error('La respuesta no corresponde a la petición pendiente')
          }
          if (!program.answer) throw new Error(`El programa ${program.id} no admite respuestas`)
          outcome = await program.answer(ctx, pendingNeed, phase.answer)
        } else if (phase.kind === 'resume') {
          outcome = program.resume ? await program.resume(ctx) : await program.run(ctx)
        } else {
          outcome = await program.run(ctx)
        }
      } catch (e) {
        if (isAbortError(e) || controller.signal.aborted) {
          cancelled = true
          outcome = { status: 'failed', error: slot.pauseRequested ? 'Pausado' : 'Cancelado' }
        } else {
          outcome = { status: 'failed', error: e instanceof Error ? e.message : String(e) }
          host.log?.('error', 'engine: el programa lanzó', { runId: run.id, error: String(e) })
        }
      }

      const usage = budget.usage()
      run.budget = {
        budget: { ...budget.budget },
        modelCalls: usage.modelCalls,
        inputChars: usage.inputChars,
        elapsedMs: run.budget.elapsedMs + Math.max(0, usage.elapsedMs - startedUsage.elapsedMs),
      }

      let summary = ''
      if (cancelled) {
        run.status = slot.pauseRequested ? 'paused' : 'cancelled'
        summary = slot.pauseRequested ? 'Turno en pausa' : 'Turno cancelado'
        run.summary = summary
        if (slot.pauseRequested) emit({ type: 'turn.done', status: 'paused', summary })
        else emit({ type: 'turn.failed', reason: 'cancelled', error: summary })
      } else if (outcome.status === 'completed') {
        run.status = 'completed'
        summary = outcome.summary
        run.summary = summary
        emit({ type: 'turn.done', status: 'completed', summary, outcome: outcome.data })
      } else if (outcome.status === 'needs-user') {
        run.status = 'waiting-user'
        run.pending = outcome.need
        summary = outcome.summary ?? outcome.need.message
        run.summary = summary
        ctx.log({ kind: 'need', message: `${outcome.need.kind}: ${outcome.need.message}`.slice(0, 300) })
        emit({ type: 'needs-user', need: outcome.need })
        emit({ type: 'turn.done', status: 'waiting-user', summary, outcome: outcome.data })
      } else {
        run.status = 'failed'
        run.error = outcome.error
        summary = outcome.error
        run.summary = summary
        ctx.log({ kind: 'error', message: outcome.error.slice(0, 300) })
        emit({ type: 'turn.failed', reason: outcome.reason ?? 'error', error: outcome.error, outcome: outcome.data })
      }
      await persist(run)
      active.delete(run.id)
      queue.close()
      resolveResult({
        runId: run.id,
        status: run.status,
        summary,
        outcome: cancelled ? undefined : outcome.data,
        run,
      })
    }

    void exec()
    return {
      runId,
      result,
      cancel: () => controller.abort(),
      [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](),
    }
  }

  return {
    runTurn(input) {
      const id = newId('run')
      return start(
        id,
        async () =>
          createEngineRun({
            id,
            input,
            programId: defaultProgram.id,
            budget: resolveAgentBudget({ ...host.budget, ...input.budget }),
            now: host.now(),
          }),
        { kind: 'run' },
        input.history,
      )
    },
    answer(runId, answer) {
      return start(
        runId,
        async () => {
          if (active.has(runId)) throw new Error('El turno sigue en curso')
          const run = await loadRun(runId)
          if (!run) throw new Error(`Run no encontrado: ${runId}`)
          if (run.status !== 'waiting-user' || !run.pending) {
            throw new Error(`El run ${runId} no espera respuesta (estado ${run.status})`)
          }
          return run
        },
        { kind: 'answer', answer },
      )
    },
    resume(runId) {
      return start(
        runId,
        async () => {
          if (active.has(runId)) throw new Error('El turno sigue en curso')
          const run = await loadRun(runId)
          if (!run) throw new Error(`Run no encontrado: ${runId}`)
          if (isTerminalRunStatus(run.status) || run.status === 'waiting-user') {
            throw new Error(`El run ${runId} no se puede reanudar (estado ${run.status})`)
          }
          return run
        },
        { kind: 'resume' },
      )
    },
    cancel(runId) {
      const a = active.get(runId)
      if (!a) return false
      a.controller.abort()
      return true
    },
    pause(runId) {
      const a = active.get(runId)
      if (!a) return false
      a.pauseRequested = true
      a.controller.abort()
      return true
    },
    async undoTurn(runId) {
      const entry = snapshots.get(runId)
      if (!entry?.turn || !host.restoreSnapshot) return false
      await host.restoreSnapshot(entry.turn)
      entry.turn = undefined
      entry.steps = []
      return true
    },
    async undoStep(runId) {
      const entry = snapshots.get(runId)
      if (!entry || !entry.steps.length || !host.restoreSnapshot) return false
      const last = entry.steps[entry.steps.length - 1]!
      await host.restoreSnapshot(last.snap)
      entry.steps.pop()
      return true
    },
    getRun: (runId) => runs.get(runId),
    loadRun,
    isActive: (runId) => active.has(runId),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Consume un turno hasta el final (útil en CLI y tests). */
export async function drainTurn(handle: TurnHandle, onEvent?: (e: EngineEvent) => void): Promise<EngineTurnResult> {
  for await (const e of handle) onEvent?.(e)
  return handle.result
}
