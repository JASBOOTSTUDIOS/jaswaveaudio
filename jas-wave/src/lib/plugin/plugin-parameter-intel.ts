/**
 * Capa semántica conservadora sobre parámetros VST3.
 * Solo etiqueta si el nombre nativo es reconocible. Nunca inventa cutoff para "P47".
 */

export type HostParameterRaw = {
  id?: number
  parameterId: string
  name: string
  shortName?: string
  unit?: string
  displayValue?: string
  normalizedValue: number
  defaultNormalizedValue?: number
  stepCount?: number
  automatable?: boolean
  readOnly?: boolean
  hidden?: boolean
  bypass?: boolean
  programChange?: boolean
}

export type SemanticParameter = HostParameterRaw & {
  pluginInstanceId: string
  slotId: string
  semanticTags: string[]
}

const TAG_RULES: Array<{ re: RegExp; tags: string[] }> = [
  { re: /cutoff|cut.?off|frequency|freq\b|brill|bright|tone|timbre/i, tags: ['filter', 'cutoff', 'brightness', 'tone'] },
  { re: /reson|q\s*factor|\bq\b/i, tags: ['filter', 'resonance'] },
  { re: /\battack\b|ataque/i, tags: ['envelope', 'attack'] },
  { re: /\bdecay\b|ca[ií]da/i, tags: ['envelope', 'decay'] },
  { re: /\bsustain\b|sosten/i, tags: ['envelope', 'sustain'] },
  { re: /\brelease\b|relaj/i, tags: ['envelope', 'release'] },
  { re: /volume|gain|level|amp\b|output|volumen/i, tags: ['level', 'volume'] },
  { re: /\bpan\b|balance|paneo/i, tags: ['pan'] },
  { re: /\bmix\b|\bwet\b|\bdry\b/i, tags: ['mix', 'wet'] },
  { re: /drive|satur|distort|overdrive/i, tags: ['drive', 'saturation'] },
  { re: /reverb|room|hall|decay time/i, tags: ['reverb'] },
  { re: /\bdelay\b|echo/i, tags: ['delay'] },
  { re: /chorus|flanger|phaser/i, tags: ['modulation'] },
  { re: /\blfo\b|mod\s*wheel|modulation/i, tags: ['modulation', 'lfo'] },
  { re: /filter|filtro/i, tags: ['filter'] },
  { re: /macro/i, tags: ['macro'] },
  { re: /bypass/i, tags: ['bypass'] },
  { re: /preset|program|patch/i, tags: ['program'] },
  { re: /velocity|velocidad/i, tags: ['velocity', 'dynamics'] },
  { re: /expression|expres/i, tags: ['expression'] },
]

const OPAQUE_NAME = /^(p|param|cc|ctrl)?[\s_\-#]*\d+$/i

export function inferSemanticTags(name: string, unit = ''): string[] {
  const blob = `${name} ${unit}`.trim()
  if (!blob || OPAQUE_NAME.test(name.trim())) return []
  const tags: string[] = []
  for (const rule of TAG_RULES) {
    if (rule.re.test(blob)) tags.push(...rule.tags)
  }
  return [...new Set(tags)]
}

export function enrichParameter(
  raw: HostParameterRaw,
  pluginInstanceId: string,
  slotId: string,
): SemanticParameter {
  return {
    ...raw,
    parameterId: String(raw.parameterId ?? raw.id ?? ''),
    pluginInstanceId,
    slotId,
    semanticTags: inferSemanticTags(raw.name || raw.shortName || '', raw.unit),
  }
}

export function searchParameters(
  params: SemanticParameter[],
  query: string,
  opts?: { includeHidden?: boolean; limit?: number },
): SemanticParameter[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    return params
      .filter((p) => opts?.includeHidden || !p.hidden)
      .slice(0, opts?.limit ?? 80)
  }
  const scored = params
    .filter((p) => opts?.includeHidden || !p.hidden)
    .map((p) => {
      const name = (p.name || '').toLowerCase()
      const shortN = (p.shortName || '').toLowerCase()
      const unit = (p.unit || '').toLowerCase()
      const tags = p.semanticTags.join(' ').toLowerCase()
      let score = 0
      if (name === q || shortN === q) score += 100
      if (name.includes(q)) score += 40
      if (shortN.includes(q)) score += 30
      if (tags.split(/\s+/).includes(q)) score += 35
      if (tags.includes(q)) score += 15
      if (unit.includes(q)) score += 8
      return { p, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, opts?.limit ?? 24).map((x) => x.p)
}

export function summarizeParametersForAi(params: SemanticParameter[], limit = 60): string {
  const visible = params.filter((p) => !p.hidden && !p.readOnly)
  const lines = visible.slice(0, limit).map((p) => {
    const tags = p.semanticTags.length ? ` tags=${p.semanticTags.join(',')}` : ''
    const unit = p.unit ? ` ${p.unit}` : ''
    const disp = p.displayValue ? ` = ${p.displayValue}` : ` = ${p.normalizedValue.toFixed(3)}`
    return `  - ${p.name} id=${p.parameterId}${disp}${unit}${p.automatable ? '' : ' [no auto]'}${tags}`
  })
  const extra = visible.length > limit ? `\n  … +${visible.length - limit} más (usa plugin.searchParameters)` : ''
  return `${visible.length} parámetros automatable/visibles:\n${lines.join('\n')}${extra}`
}
