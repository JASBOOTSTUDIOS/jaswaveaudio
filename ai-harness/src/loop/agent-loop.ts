import { EventosIAExt } from '@jaswave/shared'
import { AGENT_LOOP_LIMITS, type AgentDecision, type AgentExecutionLimits, type AgentLoopResume, type AgentLoopToolCall, type AgentLoopToolResult, type AgentObservation, type AgentRunEventName, type AgentRunResult, type AgentRunStatus } from './agent-run-types'
import { parseAgentDecisionFromText } from '../recovery/parse-agent-decision'
import { isLoopReadTool, validateAgentToolCalls } from './validate-tool-calls'
import { isProjectWipeIntent, wantsFullProject } from '../agent/modes'
import type { DAWState } from '@jaswave/shared'

export type AgentLoopDeps = {
  userText: string
  chat: (prompt: string, observation: AgentObservation, iteration: number) => Promise<string>
  observe: (lastResults: AgentLoopToolResult[]) => AgentObservation | Promise<AgentObservation>
  executeCalls: (calls: AgentLoopToolCall[]) => Promise<AgentLoopToolResult[]>
  getState: () => DAWState
  knownTools: Iterable<string>
  abort?: AbortSignal
  onEvent?: (name: AgentRunEventName, payload: Record<string, unknown>) => void
  onStatus?: (status: AgentRunStatus) => void
  limits?: Partial<AgentExecutionLimits>
  requireConfirmationForWrites?: boolean
  /** default true; en wipe tras el 1.er Aplicar se puede desactivar */
  requireConfirmationForDangerous?: boolean
  resume?: AgentLoopResume
  /** Compromiso del razonamiento previo (no repetir capas 1/N). */
  priorBrief?: string
}

function emit(deps: AgentLoopDeps, name: AgentRunEventName, payload: Record<string, unknown>): void {
  deps.onEvent?.(name, payload)
}

function setStatus(deps: AgentLoopDeps, status: AgentRunStatus): void {
  deps.onStatus?.(status)
  emit(deps, EventosIAExt.runEstado as AgentRunEventName, { status })
}

function unresolvedFailures(results: AgentLoopToolResult[]): AgentLoopToolResult[] {
  return results.filter((r) => r.status === 'error' || r.status === 'rejected')
}

function formatObservationPrompt(
  obs: AgentObservation,
  userText: string,
  iteration: number,
  priorBrief?: string,
  failures: AgentLoopToolResult[] = [],
): string {
  const brief = priorBrief?.trim()
  return [
    `Iteración ${iteration + 1} del Agent Loop.`,
    `Pedido del usuario: ${userText}`,
    brief
      ? [
          '',
          '## Compromiso ya decidido (razonamiento previo — NO lo reescribas)',
          brief.slice(0, 2500),
          'Traduce ese compromiso a tools YA. PROHIBIDO repetir capas 1/6, «Traducir pedido», «Encuadre», etc.',
        ].join('\n')
      : '',
    obs.text,
    '',
    '## Verificación obligatoria',
    '1) LEE «Resultados recientes de herramientas».',
    '2) Si hay [error] o [rejected]: corrige con tool-calls (p. ej. track.list → track.update con trackId real) o {"type":"fail"}.',
    '3) PROHIBIDO {"type":"complete"} mientras existan fallos sin corregir.',
    failures.length
      ? `4) Fallos abiertos ahora:\n${failures
          .slice(-8)
          .map((f) => `   - ${f.tool}: ${f.error?.message ?? f.status}`)
          .join('\n')}`
      : '',
    '',
    '## Formato obligatorio (emite ESTO primero; prosa opcional DESPUÉS)',
    '<<<DECISION',
    '{"type":"tool-calls","calls":[{"id":"c1","tool":"nombre","arguments":{}}]}',
    'DECISION>>>',
    'Alternativa: <<<ACTIONS [{"type":"daw.musicBuild","payload":{…}}] ACTIONS>>>',
    'Tipos: tool-calls | request-confirmation | request-user-input | replan | complete | fail.',
    'Máx. 4 calls por iteración. Si falta trackId: selection.get / track.list ANTES de mutar.',
    'Solo complete si TODOS los resultados relevantes son success, el pedido está cumplido,',
    'Y (si hubo mutación creativa: musicBuild/clips/mezcla) ya pediste feedback de Kael con request-user-input o CLARIFY.',
    'Tras éxito creativo, preferí:',
    '<<<DECISION {"type":"request-user-input","message":"Kael (QA): Revisé el resultado en el DAW. ¿Te gustó? ¿Ajustamos algo?"} DECISION>>>',
    'Excepción wipe/transporte trivial: complete OK.',
  ]
    .filter(Boolean)
    .join('\n')
}

function formatRepairPrompt(userText: string, priorBrief: string | undefined, rawSnippet: string): string {
  return [
    'ERROR DE PROTOCOLO: tu respuesta anterior NO contenía <<<DECISION>>> ni <<<ACTIONS>>>.',
    'Responde ÚNICAMENTE con un bloque DECISION o ACTIONS. Cero razonamiento, cero 1/6, cero markdown de plan.',
    `Pedido: ${userText}`,
    priorBrief?.trim() ? `Compromiso previo:\n${priorBrief.trim().slice(0, 1800)}` : '',
    'Ejemplo mínimo para construir/limpiar canción:',
    '<<<DECISION',
    JSON.stringify({
      type: 'tool-calls',
      calls: [
        {
          id: 'c1',
          tool: 'daw.musicBuild',
          arguments: { aplicar: true, prompt: userText.slice(0, 200), midiSource: 'ai' },
        },
      ],
    }),
    'DECISION>>>',
    rawSnippet.trim()
      ? `Fragmento de tu respuesta anterior (solo contexto):\n${rawSnippet.trim().slice(0, 600)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function runAgentLoop(deps: AgentLoopDeps): Promise<AgentRunResult> {
  const wipe = isProjectWipeIntent(deps.userText)
  const songBuild = wantsFullProject(deps.userText)
  const limits: AgentExecutionLimits = {
    ...AGENT_LOOP_LIMITS,
    ...(wipe || songBuild
      ? {
          maxIterations: songBuild ? 64 : 48,
          maxToolCallsPerIteration: 2,
          maxTotalToolCalls: songBuild ? 128 : 96,
        }
      : {}),
    ...deps.limits,
  }
  const decisions: AgentDecision[] = [...(deps.resume?.decisions ?? [])]
  let results: AgentLoopToolResult[] = [...(deps.resume?.results ?? [])]
  let iterations = deps.resume?.iterations ?? 0
  let lastFp = deps.resume?.fingerprint ?? ''
  let replans = 0
  let parseRetries = 0
  const requireDanger =
    deps.requireConfirmationForDangerous !== undefined
      ? deps.requireConfirmationForDangerous
      : true

  emit(deps, EventosIAExt.runIniciado as AgentRunEventName, { userText: deps.userText })
  setStatus(deps, 'idle')

  const resumePending = deps.resume?.pendingCalls
  if (resumePending?.length) {
    setStatus(deps, 'executing')
    const executed = await deps.executeCalls(resumePending)
    results.push(...executed)
    iterations += 1
  }

  while (iterations < limits.maxIterations && results.length <= limits.maxTotalToolCalls) {
    if (deps.abort?.aborted) {
      setStatus(deps, 'cancelled')
      emit(deps, EventosIAExt.runCancelado as AgentRunEventName, { iterations })
      return { status: 'cancelled', summary: 'Cancelado', iterations, results, decisions }
    }

    setStatus(deps, 'observing')
    const observation = await deps.observe(results)
    if (lastFp && observation.fingerprint !== lastFp && results.length > 0) {
      decisions.push({ type: 'replan', reason: `STATE_CONFLICT: revision ${lastFp} → ${observation.fingerprint}` })
      replans += 1
      if (replans > 3) {
        setStatus(deps, 'failed')
        return {
          status: 'failed',
          summary: `Conflicto de estado (revision ${lastFp} → ${observation.fingerprint})`,
          iterations,
          results,
          decisions,
          lastObservation: observation,
        }
      }
      lastFp = observation.fingerprint
      iterations += 1
      continue
    }
    lastFp = observation.fingerprint

    setStatus(deps, 'planning')
    const openFails = unresolvedFailures(results)
    let raw = await deps.chat(
      formatObservationPrompt(observation, deps.userText, iterations, deps.priorBrief, openFails),
      observation,
      iterations,
    )
    if (deps.abort?.aborted) {
      setStatus(deps, 'cancelled')
      emit(deps, EventosIAExt.runCancelado as AgentRunEventName, { iterations })
      return { status: 'cancelled', summary: 'Cancelado', iterations, results, decisions, lastObservation: observation }
    }

    let decision = parseAgentDecisionFromText(raw)
    if (!decision && parseRetries < 1) {
      parseRetries += 1
      setStatus(deps, 'planning')
      raw = await deps.chat(
        formatRepairPrompt(deps.userText, deps.priorBrief, raw),
        observation,
        iterations,
      )
      if (deps.abort?.aborted) {
        setStatus(deps, 'cancelled')
        emit(deps, EventosIAExt.runCancelado as AgentRunEventName, { iterations })
        return { status: 'cancelled', summary: 'Cancelado', iterations, results, decisions, lastObservation: observation }
      }
      decision = parseAgentDecisionFromText(raw)
    }
    if (!decision) {
      setStatus(deps, 'failed')
      emit(deps, EventosIAExt.runCompletado as AgentRunEventName, { ok: false })
      return {
        status: 'failed',
        summary: 'El modelo no emitió DECISION ni ACTIONS',
        iterations,
        results,
        decisions,
        lastObservation: observation,
      }
    }
    decisions.push(decision)

    if (decision.type === 'complete') {
      const fails = unresolvedFailures(results)
      if (fails.length) {
        decisions.push({
          type: 'replan',
          reason: `No se puede completar: ${fails.length} tool(s) fallaron (${fails
            .slice(0, 3)
            .map((f) => `${f.tool}: ${f.error?.message ?? f.status}`)
            .join('; ')})`,
        })
        replans += 1
        if (replans > 3) {
          setStatus(deps, 'failed')
          return {
            status: 'failed',
            summary: `Fallos sin corregir: ${fails.map((f) => f.tool).join(', ')}`,
            iterations,
            results,
            decisions,
            lastObservation: observation,
          }
        }
        iterations += 1
        continue
      }
      setStatus(deps, 'completed')
      emit(deps, EventosIAExt.runCompletado as AgentRunEventName, { ok: true })
      return { status: 'completed', summary: decision.summary, iterations, results, decisions, lastObservation: observation }
    }
    if (decision.type === 'fail') {
      setStatus(deps, 'failed')
      emit(deps, EventosIAExt.runCompletado as AgentRunEventName, { ok: false })
      return { status: 'failed', summary: decision.reason, iterations, results, decisions, lastObservation: observation }
    }
    if (decision.type === 'request-user-input') {
      setStatus(deps, 'waiting-for-user')
      return {
        status: 'waiting-for-user',
        summary: decision.message,
        iterations,
        results,
        decisions,
        lastObservation: observation,
      }
    }
    if (decision.type === 'replan') {
      replans += 1
      if (replans > 3) {
        setStatus(deps, 'failed')
        return { status: 'failed', summary: `Replan excesivo: ${decision.reason}`, iterations, results, decisions, lastObservation: observation }
      }
      iterations += 1
      continue
    }

    const calls =
      decision.type === 'request-confirmation' || decision.type === 'tool-calls' ? decision.calls : []

    setStatus(deps, 'validating')
    const validated = validateAgentToolCalls(calls, {
      knownTools: deps.knownTools,
      state: deps.getState(),
      maxPerIteration: limits.maxToolCallsPerIteration,
      requireConfirmationForWrites: deps.requireConfirmationForWrites,
      requireConfirmationForDangerous: requireDanger,
    })

    for (const r of validated.rejected) {
      results.push({
        callId: r.id,
        tool: r.tool,
        status: 'rejected',
        error: { code: 'VALIDATION', message: r.reason },
        stateRevision: observation.fingerprint,
      })
    }

    if (!validated.accepted.length && validated.rejected.length) {
      iterations += 1
      continue
    }

    if (decision.type === 'request-confirmation' || validated.needsConfirmation) {
      const writes = validated.accepted.filter((c) => !isLoopReadTool(c.tool))
      const reads = validated.accepted.filter((c) => isLoopReadTool(c.tool))
      if (reads.length) {
        setStatus(deps, 'executing')
        for (const c of reads) emit(deps, EventosIAExt.herramientaSolicitada as AgentRunEventName, { tool: c.tool })
        const readOut = await deps.executeCalls(reads)
        results.push(...readOut)
        setStatus(deps, 'observing-result')
      }
      // Nunca pausar con más de 1 mutación
      const pendingWrites = writes.slice(0, 1)
      if (pendingWrites.length) {
        setStatus(deps, 'waiting-for-confirmation')
        const tool = pendingWrites[0]!.tool
        return {
          status: 'waiting-for-confirmation',
          summary:
            decision.type === 'request-confirmation'
              ? decision.message
              : `Confirma 1 paso (${tool}); luego continúo validando uno a uno.`,
          iterations,
          results,
          pendingCalls: pendingWrites,
          decisions,
          lastObservation: observation,
        }
      }
      if (!pendingWrites.length) {
        iterations += 1
        continue
      }
    }

    if (!validated.accepted.length) {
      iterations += 1
      continue
    }

    if (results.length + validated.accepted.length > limits.maxTotalToolCalls) {
      setStatus(deps, 'failed')
      return {
        status: 'failed',
        summary: 'Límite de tool calls del Agent Loop',
        iterations,
        results,
        decisions,
        lastObservation: observation,
      }
    }

    setStatus(deps, 'executing')
    for (const c of validated.accepted) {
      emit(deps, EventosIAExt.herramientaSolicitada as AgentRunEventName, { tool: c.tool, id: c.id })
    }
    const stamped = validated.accepted.map((c) => ({
      ...c,
      arguments: { ...c.arguments, __expectedRevision: observation.fingerprint },
    }))
    const out = await deps.executeCalls(stamped)
    results.push(...out)
    const failed = out.filter((r) => r.status === 'error' || r.status === 'rejected')
    for (const f of failed) {
      emit(deps, EventosIAExt.herramientaFallida as AgentRunEventName, { tool: f.tool, error: f.error })
    }
    for (const ok of out.filter((r) => r.status === 'success')) {
      emit(deps, EventosIAExt.herramientaEjecutada as AgentRunEventName, { tool: ok.tool })
    }
    setStatus(deps, 'observing-result')
    setStatus(deps, 'deciding')
    iterations += 1
  }

  setStatus(deps, 'failed')
  return {
    status: 'failed',
    summary: 'Límite de iteraciones del Agent Loop',
    iterations,
    results,
    decisions,
  }
}
