import { describe, expect, it } from 'vitest'
import {
  detectAgentMode,
  inferBpmFromTempoIntent,
  isGenreRewriteIntent,
  isProjectAuditIntent,
  isProjectWipeIntent,
  isSongRefineIntent,
  isStyleGapIntent,
  isStyleApplyIntent,
  isMidiClipEditIntent,
  isTempoOnlyRefine,
  wantsFullProject,
  wantsWebResearch,
} from '../agent/modes'
import { estimateReasoningDepth } from '../agent/reasoning-depth'

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

  it('detecta analizame + pista (sin word-boundary estricto)', () => {
    const t =
      'analizame la pista de la bateria y dime que le falta para que este como worship moderno estilo averly morillo, investiga en internet'
    expect(isProjectAuditIntent(t)).toBe(true)
    expect(isStyleGapIntent(t)).toBe(true)
    expect(isStyleApplyIntent(t)).toBe(false)
    expect(wantsWebResearch(t)).toBe(true)
    expect(detectAgentMode(t)).toBe('ask')
    expect(detectAgentMode(t, 'create')).toBe('ask')
  })

  it('aplicar estilo worship → create (no ask)', () => {
    const t =
      'haz que la bateria tenga esa sensacion y estilo, adecua el proyecto completo para tenga el estilo worship como averly morrillo'
    expect(isStyleApplyIntent(t)).toBe(true)
    expect(isStyleGapIntent(t)).toBe(false)
    expect(detectAgentMode(t)).toBe('create')
  })

  it('editar intro suave / toms → create sin full musicBuild', () => {
    const t =
      'ok, siento que la intro de la cancion es demasiado explosiva, arreglala para que sea un poco mas suave, y que haga un grove de toms con juego con los platillos'
    expect(isMidiClipEditIntent(t)).toBe(true)
    expect(wantsFullProject(t)).toBe(false)
    expect(detectAgentMode(t)).toBe('create')
  })

  it('no confunde refine con audit', () => {
    expect(isProjectAuditIntent('hazla más lenta')).toBe(false)
  })

  it('créame pista de batería worship es create, no gap/ask', () => {
    const t =
      'creame una pista de bateria worship con crescendo y usando mucho los toms, quiero que el tiempo sea 72 4/4'
    expect(isStyleGapIntent(t)).toBe(false)
    expect(detectAgentMode(t)).toBe('create')
    expect(wantsFullProject(t)).toBe(false)
    expect(inferBpmFromTempoIntent(t, 120)).toBe(72)
  })

  it('limpia + arma bachata → full project / genre rewrite, profundidad baja', () => {
    const t = 'ok, limpia este proyecto y armame una pista de bachata'
    expect(isGenreRewriteIntent(t)).toBe(true)
    expect(wantsFullProject(t)).toBe(true)
    expect(estimateReasoningDepth(t, 'create').depth).toBeLessThanOrEqual(4)
  })

  it('borra todo → wipe corto, no musicBuild', () => {
    const t = 'limpia todo el proyecto'
    expect(isProjectWipeIntent(t)).toBe(true)
    expect(wantsFullProject(t)).toBe(false)
    expect(estimateReasoningDepth(t, 'create').depth).toBe(3)
  })

  it('prince royce bachata → rewrite', () => {
    const t = 'arreglame este proyecto para que sea una bachata moderna como prince royce'
    expect(isGenreRewriteIntent(t)).toBe(true)
    expect(wantsFullProject(t)).toBe(true)
  })
})
