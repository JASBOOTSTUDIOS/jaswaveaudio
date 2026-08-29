import { describe, it, expect, vi } from 'vitest'
import type { HarnessDawAction } from '../types/actions'
import {
  parseReadBlockFromText,
  runAbbreviatedReasoning,
  runReasoningLoop,
  stripReadBlock,
  REASONING_REPAIR_PHASES,
} from '../agent/reasoning-loop'
import { detectAgentMode, modeBlocksMutation } from '../agent/modes'
import { isReadOnlyAction } from '../agent/action-policy'

describe('parseReadBlockFromText', () => {
  it('extrae acciones JSON del bloque READ', () => {
    const text = `Analizo el proyecto.
<<<READ [{"type":"doc.read","payload":{"slug":"plan.md"}},{"type":"web.search","payload":{"query":"techno BPM"}}] READ>>>
Fin.`
    const actions = parseReadBlockFromText(text)
    expect(actions).toHaveLength(2)
    expect(actions[0]).toEqual({ type: 'doc.read', payload: { slug: 'plan.md' } })
    expect(actions[1]).toEqual({ type: 'web.search', payload: { query: 'techno BPM' } })
  })

  it('ignora bloques malformados', () => {
    expect(parseReadBlockFromText('<<<READ not-json READ>>>')).toEqual([])
    expect(parseReadBlockFromText('sin bloque')).toEqual([])
  })

  it('limita a 4 acciones por bloque', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      type: 'doc.list',
      payload: { n: i },
    }))
    const text = `<<<READ ${JSON.stringify(many)} READ>>>`
    expect(parseReadBlockFromText(text)).toHaveLength(4)
  })

  it('stripReadBlock elimina el bloque', () => {
    const raw = 'Pensando…\n<<<READ [] READ>>>\nListo.'
    expect(stripReadBlock(raw).replace(/\n{2,}/g, '\n')).toBe('Pensando…\nListo.')
  })
})

describe('runReasoningLoop', () => {
  it('emite 6 pasos internos (think→decision)', async () => {
    const phases: string[] = []
    const chat = vi.fn(async () => ({
      success: true,
      content: 'Respuesta de fase.',
    }))

    const result = await runReasoningLoop({
      userText: '¿Cómo suena el bajo?',
      mode: 'ask',
      projectContext: 'Proyecto: 2 pistas',
      chat,
      runReadTools: async () => '(ok)',
      onStep: (s) => phases.push(s.phase),
    })

    expect(phases).toEqual([
      'think1',
      'research1',
      'think2',
      'research2',
      'analysis',
      'decision',
    ])
    expect(result.steps).toHaveLength(6)
    expect(result.decisionBrief).toContain('Respuesta')
    expect(result.finalUserMessage).toContain('¿Cómo suena el bajo?')
    expect(chat).toHaveBeenCalledTimes(6)
  })

  it('ejecuta runReadTools en fases de investigación', async () => {
    let call = 0
    const chat = vi.fn(async () => {
      call += 1
      if (call === 2) {
        return {
          success: true,
          content: `Busco docs\n<<<READ [{"type":"analysis.buffer","payload":{}}] READ>>>`,
        }
      }
      return { success: true, content: 'ok' }
    })
    const runReadTools = vi.fn(async () => 'buffer: healthy')

    await runReasoningLoop({
      userText: 'revisa el buffer',
      mode: 'think',
      projectContext: 'ctx',
      chat,
      runReadTools,
    })

    expect(runReadTools).toHaveBeenCalledTimes(1)
    const passedActions = (runReadTools.mock.calls as unknown as Array<[HarnessDawAction[]]>)[0]?.[0]
    expect(passedActions).toEqual([{ type: 'analysis.buffer', payload: {} }])
  })

  it('runAbbreviatedReasoning usa 3 fases de reparación', async () => {
    const phases: string[] = []
    await runAbbreviatedReasoning({
      userText: 'arregla el mix',
      mode: 'create',
      projectContext: 'ctx',
      repairContext: 'plugin.insert falló',
      chat: async () => ({ success: true, content: 'brief' }),
      runReadTools: async () => '',
      onStep: (s) => phases.push(s.phase),
    })
    expect(phases).toEqual(REASONING_REPAIR_PHASES)
  })
})

describe('modo ask', () => {
  it('modeBlocksMutation bloquea mutaciones', () => {
    expect(modeBlocksMutation('ask')).toBe(true)
  })

  it('detectAgentMode elige ask para preguntas', () => {
    expect(detectAgentMode('¿qué hay en el plan?', 'auto')).toBe('ask')
    expect(detectAgentMode('explícame la cadena FX', 'auto')).toBe('ask')
    expect(detectAgentMode('crea un pad', 'auto')).toBe('create')
  })

  it('web.search es acción read-only', () => {
    expect(isReadOnlyAction({ type: 'web.search', payload: { query: 'x' } })).toBe(true)
  })
})
