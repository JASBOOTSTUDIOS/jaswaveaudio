import { describe, it, expect, vi } from 'vitest'
import type { HarnessDawAction } from '../types/actions'
import {
  parseReadBlockFromText,
  runAbbreviatedReasoning,
  runReasoningLoop,
  stripReadBlock,
  sanitizeInnerThought,
  REASONING_REPAIR_PHASES,
} from '../agent/reasoning-loop'
import {
  estimateReasoningDepth,
  parseModelIntentBrief,
  planReasoningPhases,
  REASONING_MAX_STEPS,
  REASONING_MIN_STEPS,
} from '../agent/reasoning-depth'
import { detectAgentMode, modeBlocksMutation, wantsFullProject } from '../agent/modes'
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

describe('sanitizeInnerThought', () => {
  it('quita aperturas de asistente', () => {
    expect(sanitizeInnerThought('¡Perfecto! Veo que el tempo está alto.')).toBe(
      'Veo que el tempo está alto.',
    )
  })
})

describe('parseModelIntentBrief', () => {
  it('parsea INTENT con traducción construye→crea', () => {
    const raw = `El usuario dijo construye.
<<<INTENT
{"promptCanonico":"crea una canción ambient de 2 minutos","intent":"create_song","depth":7,"depthReason":"canción nueva","aliasesMapped":[{"from":"construye","to":"crea"}]}
INTENT>>>`
    const brief = parseModelIntentBrief(raw, 'construye ambient')
    expect(brief?.promptCanonico).toMatch(/crea una canción/)
    expect(brief?.depth).toBe(7)
    expect(brief?.aliasesMapped?.[0]).toEqual({ from: 'construye', to: 'crea' })
  })

  it('clampa depth a 2–10', () => {
    const raw = `<<<INTENT {"promptCanonico":"mute pista","intent":"transport","depth":1} INTENT>>>`
    expect(parseModelIntentBrief(raw, 'mute')?.depth).toBe(2)
    const raw2 = `<<<INTENT {"promptCanonico":"audita todo","intent":"audit","depth":99} INTENT>>>`
    expect(parseModelIntentBrief(raw2, 'audita')?.depth).toBe(10)
  })
})

describe('estimateReasoningDepth (fallback)', () => {
  it('usa mínimo 2 en confirmaciones / mute / BPM simple', () => {
    expect(estimateReasoningDepth('hazlo', 'create').depth).toBe(2)
    expect(estimateReasoningDepth('mute la batería', 'create').depth).toBe(2)
    expect(estimateReasoningDepth('baja el tempo a 72 bpm', 'create').depth).toBe(2)
  })

  it('siempre normalize…commit y entre min/max', () => {
    for (const text of ['ok', 'crea un pad', 'analiza el proyecto', 'plan del tema']) {
      const p = planReasoningPhases(text, 'auto')
      expect(p.depth).toBeGreaterThanOrEqual(REASONING_MIN_STEPS)
      expect(p.depth).toBeLessThanOrEqual(REASONING_MAX_STEPS)
      expect(p.phases[0]).toBe('normalize')
      expect(p.phases[p.phases.length - 1]).toBe('commit')
      expect(p.phases).toHaveLength(p.depth)
    }
  })
})

describe('runReasoningLoop', () => {
  it('usa depth y prompt canónico del modelo (INTENT)', async () => {
    const phases: string[] = []
    let call = 0
    const chat = vi.fn(async () => {
      call += 1
      if (call === 1) {
        return {
          success: true,
          content: `Traduzco construye→crea.
<<<INTENT
{"promptCanonico":"crea un pad suave en la pista seleccionada","intent":"edit_clip","depth":3,"depthReason":"pedido simple","aliasesMapped":[{"from":"construye","to":"crea"}]}
INTENT>>>`,
        }
      }
      return { success: true, content: 'ok, sigo.' }
    })

    const result = await runReasoningLoop({
      userText: 'construye un pad suave',
      mode: 'create',
      projectContext: 'Proyecto: 1 pista',
      chat,
      runReadTools: async () => '(ok)',
      onStep: (s) => phases.push(s.phase),
    })

    expect(result.depth).toBe(3)
    expect(result.canonicalPrompt).toMatch(/crea un pad/)
    expect(result.steps.map((s) => s.phase)).toEqual(['normalize', 'research1', 'commit'])
    expect(result.steps).toHaveLength(3)
    expect(result.steps[0]!.title).toMatch(/1\/3/)
    expect(result.finalUserMessage).toContain('construye un pad suave')
    expect(result.finalUserMessage).toContain('crea un pad suave')
    expect(chat).toHaveBeenCalledTimes(3)
    expect(new Set(phases).has('normalize')).toBe(true)
    expect(phases.filter((p) => p === 'commit')).toHaveLength(1)
  })

  it('si no hay INTENT, cae al fallback heurístico', async () => {
    const chat = vi.fn(async () => ({
      success: true,
      content: 'veo el pedido sin bloque intent.',
    }))
    const result = await runReasoningLoop({
      userText: '¿Cómo suena el bajo?',
      mode: 'ask',
      projectContext: 'Proyecto: 2 pistas',
      chat,
      runReadTools: async () => '(ok)',
    })
    expect(result.depth).toBe(3)
    expect(result.depthReason).toMatch(/fallback/)
    expect(result.steps[0]!.phase).toBe('normalize')
    expect(chat).toHaveBeenCalledTimes(3)
  })

  it('respeta override de fases (máx 10)', async () => {
    const chat = vi.fn(async () => ({ success: true, content: 'ok' }))
    const result = await runReasoningLoop({
      userText: 'crea una canción',
      mode: 'create',
      projectContext: 'ctx',
      chat,
      runReadTools: async () => '',
      phases: [
        'normalize',
        'frame',
        'explore',
        'research1',
        'critique',
        'research2',
        'stress',
        'synthesize',
        'verify',
        'commit',
      ],
    })
    expect(result.depth).toBe(10)
    expect(chat).toHaveBeenCalledTimes(10)
    expect(result.steps[9]!.title).toMatch(/10\/10/)
  })

  it('ejecuta runReadTools en capas de investigación', async () => {
    let call = 0
    const chat = vi.fn(async () => {
      call += 1
      if (call === 1) {
        return {
          success: true,
          content: `<<<INTENT {"promptCanonico":"revisa el buffer","intent":"ask","depth":5} INTENT>>>`,
        }
      }
      // depth 5: normalize, frame, research1, synthesize, commit → research1 es call 3
      if (call === 3) {
        return {
          success: true,
          content: `Miro el buffer\n<<<READ [{"type":"analysis.buffer","payload":{}}] READ>>>`,
        }
      }
      return { success: true, content: 'ok, sigo pensando.' }
    })
    const runReadTools = vi.fn(async () => 'buffer: healthy')

    await runReasoningLoop({
      userText: 'revisa el buffer del proyecto',
      mode: 'think',
      projectContext: 'ctx',
      chat,
      runReadTools,
    })

    expect(runReadTools).toHaveBeenCalledTimes(1)
    const passedActions = (runReadTools.mock.calls as unknown as Array<[HarnessDawAction[]]>)[0]?.[0]
    expect(passedActions).toEqual([{ type: 'analysis.buffer', payload: {} }])
  })

  it('runAbbreviatedReasoning usa 3 capas de reparación', async () => {
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

describe('modo ask / vocab', () => {
  it('modeBlocksMutation bloquea mutaciones', () => {
    expect(modeBlocksMutation('ask')).toBe(true)
  })

  it('detectAgentMode elige ask para preguntas', () => {
    expect(detectAgentMode('¿qué hay en el plan?', 'auto')).toBe('ask')
    expect(detectAgentMode('explícame la cadena FX', 'auto')).toBe('ask')
    expect(detectAgentMode('crea un pad', 'auto')).toBe('create')
    expect(detectAgentMode('construye una canción ambient', 'auto')).toBe('create')
  })

  it('wantsFullProject reconoce construye', () => {
    expect(wantsFullProject('construye una canción de 2 minutos')).toBe(true)
  })

  it('web.search es acción read-only', () => {
    expect(isReadOnlyAction({ type: 'web.search', payload: { query: 'x' } })).toBe(true)
  })
})
