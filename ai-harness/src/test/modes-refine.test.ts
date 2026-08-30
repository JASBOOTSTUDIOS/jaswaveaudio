import { describe, expect, it } from 'vitest'
import {
  detectAgentMode,
  inferBpmFromTempoIntent,
  isProjectAuditIntent,
  isSongRefineIntent,
  isTempoOnlyRefine,
  wantsFullProject,
} from '../agent/modes'

describe('song refine intents', () => {
  const refine =
    'ahora necesito que me hagas esta cancion mas sublime, mas lenta, esta muy rapida'

  it('detecta refine → create (incluso con picker plan)', () => {
    expect(isSongRefineIntent(refine)).toBe(true)
    expect(isTempoOnlyRefine(refine)).toBe(false)
    expect(detectAgentMode(refine)).toBe('create')
    expect(detectAgentMode(refine, 'plan')).toBe('create')
    expect(wantsFullProject(refine)).toBe(true)
  })

  it('solo tempo → no full rebuild', () => {
    const t = 'está muy rápida, hazla más lenta'
    expect(isSongRefineIntent(t)).toBe(true)
    expect(isTempoOnlyRefine(t)).toBe(true)
    expect(wantsFullProject(t)).toBe(false)
    expect(inferBpmFromTempoIntent(t, 120)).toBe(72)
  })

  it('no propone 120 si pide más lenta', () => {
    expect(inferBpmFromTempoIntent('más lenta', 128)).toBe(72)
    expect(inferBpmFromTempoIntent('más lenta', 80)).toBeLessThan(80)
  })
})

describe('project audit intents', () => {
  const audit =
    'analiza todo el proyecto, todos los clips midi, y asi dime lo que hay que arreglar.'

  it('detecta auditoría → ask (no create/plan)', () => {
    expect(isProjectAuditIntent(audit)).toBe(true)
    expect(detectAgentMode(audit)).toBe('ask')
    expect(detectAgentMode(audit, 'create')).toBe('ask')
    expect(detectAgentMode(audit, 'plan')).toBe('ask')
  })

  it('no confunde refine con audit', () => {
    expect(isProjectAuditIntent('hazla más lenta')).toBe(false)
  })
})
