/**
 * Alias y rutas candidatas para VSTs frecuentes (p. ej. usuario dice "Descent" = DecentSampler).
 */

export type KnownVstHit = {
  name: string
  paths: string[]
}

function envPath(name: string): string {
  if (typeof process === 'undefined') return ''
  return String(process.env[name] ?? '').trim()
}

function winVst3(...parts: string[]): string[] {
  const common = envPath('CommonProgramFiles') || 'C:\\Program Files\\Common Files'
  const program = envPath('ProgramFiles') || 'C:\\Program Files'
  const roots = [common, program]
  return roots.map((root) => [root, 'VST3', ...parts].join('\\'))
}

/** Clave normalizada: sin espacios, minúsculas. */
export function normalizePluginAliasKey(query: string): string {
  return query.replace(/\s+/g, '').toLowerCase().trim()
}

const ALIAS_TABLE: Record<string, KnownVstHit> = {
  descent: {
    name: 'DecentSampler',
    paths: [
      envPath('JASWAVE_DECENT_PATH'),
      ...winVst3('DecentSampler.vst3'),
    ].filter(Boolean),
  },
  decentsampler: {
    name: 'DecentSampler',
    paths: [
      envPath('JASWAVE_DECENT_PATH'),
      ...winVst3('DecentSampler.vst3'),
    ].filter(Boolean),
  },
  decentsample: {
    name: 'DecentSampler',
    paths: [
      envPath('JASWAVE_DECENT_PATH'),
      ...winVst3('DecentSampler.vst3'),
    ].filter(Boolean),
  },
  font: {
    name: 'Kontakt',
    paths: [...winVst3('Kontakt.vst3')].filter(Boolean),
  },
  fontpiano: {
    name: 'Kontakt',
    paths: [...winVst3('Kontakt.vst3')].filter(Boolean),
  },
  kontakt: {
    name: 'Kontakt',
    paths: [...winVst3('Kontakt.vst3')].filter(Boolean),
  },
  bfd: {
    name: 'BFD Player',
    paths: [...winVst3('BFDPlayer.vst3')].filter(Boolean),
  },
  bfdplayer: {
    name: 'BFD Player',
    paths: [...winVst3('BFDPlayer.vst3')].filter(Boolean),
  },
}

/** Nombre canónico si el query es un alias conocido; si no, el query original. */
export function canonicalPluginName(query: string): string {
  const hit = ALIAS_TABLE[normalizePluginAliasKey(query)]
  return hit?.name ?? query.trim()
}

/** Variantes de búsqueda para matching fuzzy en el registry. */
export function expandPluginNameQueries(query: string): string[] {
  const raw = query.trim()
  if (!raw) return []
  const key = normalizePluginAliasKey(raw)
  const hit = ALIAS_TABLE[key]
  const out = new Set<string>([raw, key, raw.toLowerCase()])
  if (hit) {
    out.add(hit.name)
    out.add(normalizePluginAliasKey(hit.name))
  }
  // "Descent" no es substring de "DecentSampler"; añadir token canónico compacto.
  if (key === 'descent') {
    out.add('decentsampler')
    out.add('DecentSampler')
  }
  return [...out]
}

export function lookupKnownVst(query: string): KnownVstHit | undefined {
  return ALIAS_TABLE[normalizePluginAliasKey(query)]
}

/** Preferencia de ruta: env > Common Files > Program Files. */
export function preferredKnownVstPath(query: string): string {
  const hit = lookupKnownVst(query)
  return hit?.paths[0] ?? ''
}
