/**
 * Catálogo de acciones DAW que la IA (y la CLI) pueden ejecutar.
 * Incluye comandos del registry + orquestaciones solo-cliente (musicBuild, masterPass, …).
 */

export type CatalogEntry = {
  type: string
  kind: 'command' | 'agent' | 'both'
  description: string
  examplePayload?: Record<string, unknown>
}

/** Acciones orquestadas por executeDawActions (pueden no existir en registry). */
export const AGENT_ONLY_ACTIONS: CatalogEntry[] = [
  {
    type: 'daw.musicBuild',
    kind: 'agent',
    description: 'Orquesta proyecto/MIDI/VSTs por fases',
    examplePayload: { aplicar: true, prompt: 'techno 120bpm', genero: 'techno', bpm: 120 },
  },
  {
    type: 'daw.composeProject',
    kind: 'agent',
    description: 'Compose de alto nivel (plan + build)',
    examplePayload: { aplicar: true, nombre: 'Demo', bpm: 100 },
  },
  {
    type: 'daw.generateMidiSong',
    kind: 'agent',
    description: 'Genera canción MIDI en pista(s)',
    examplePayload: { aplicar: true, prompt: 'funk bass', minutos: 1 },
  },
  {
    type: 'daw.masterPass',
    kind: 'agent',
    description: 'Cadena master + bounce + compareTarget',
    examplePayload: { target: 'streaming' },
  },
  {
    type: 'plugin.lookup',
    kind: 'agent',
    description: 'Busca VST en catálogo/web',
    examplePayload: { nombre: 'Serum' },
  },
  {
    type: 'plugin.probe',
    kind: 'agent',
    description: 'Prueba carga de plugin en host',
    examplePayload: { nombre: 'Soft Pad' },
  },
  {
    type: 'plugin.listParameters',
    kind: 'agent',
    description: 'Lista parámetros VST de un slot',
    examplePayload: { trackId: '…', pluginInstanceId: '…' },
  },
  {
    type: 'plugin.searchParameters',
    kind: 'agent',
    description: 'Busca parámetros por nombre',
    examplePayload: { trackId: '…', query: 'cutoff' },
  },
  {
    type: 'plugin.getParameter',
    kind: 'agent',
    description: 'Lee un parámetro VST',
    examplePayload: { trackId: '…', pluginInstanceId: '…', parameterId: '0' },
  },
  {
    type: 'track.getFxChain',
    kind: 'agent',
    description: 'Devuelve cadena FX de una pista',
    examplePayload: { trackId: '…' },
  },
  {
    type: 'library.preset.list',
    kind: 'agent',
    description: 'Lista presets del proyecto',
    examplePayload: {},
  },
  {
    type: 'library.preset.search',
    kind: 'agent',
    description: 'Busca presets',
    examplePayload: { query: 'pad' },
  },
  {
    type: 'library.preset.save',
    kind: 'agent',
    description: 'Guarda preset desde pista',
    examplePayload: { trackId: '…', nombre: 'Mi pad', rol: 'pad' },
  },
  {
    type: 'library.preset.apply',
    kind: 'agent',
    description: 'Aplica preset a pista',
    examplePayload: { presetId: '…', trackId: '…' },
  },
  {
    type: 'library.preset.audition',
    kind: 'agent',
    description: 'Audiciona preset',
    examplePayload: { presetId: '…', bars: 2 },
  },
  {
    type: 'doc.list',
    kind: 'agent',
    description: 'Lista docs del agente',
    examplePayload: {},
  },
  {
    type: 'doc.read',
    kind: 'agent',
    description: 'Lee un doc (plan.md, …)',
    examplePayload: { slug: 'plan.md' },
  },
  {
    type: 'doc.create',
    kind: 'agent',
    description: 'Crea doc',
    examplePayload: { slug: 'notas.md', content: '# Notas\n' },
  },
  {
    type: 'doc.write',
    kind: 'agent',
    description: 'Escribe doc completo',
    examplePayload: { slug: 'plan.md', content: '# Plan\n' },
  },
  {
    type: 'doc.append',
    kind: 'agent',
    description: 'Añade texto a un doc',
    examplePayload: { slug: 'plan.md', content: '\n- item\n' },
  },
  {
    type: 'doc.evaluate',
    kind: 'agent',
    description: 'Evalúa plan vs DAW',
    examplePayload: {},
  },
  {
    type: 'track.freeze',
    kind: 'agent',
    description: 'Congela pista (bounce→clip + bypass)',
    examplePayload: { trackId: '…' },
  },
  {
    type: 'track.unfreeze',
    kind: 'agent',
    description: 'Descongela pista',
    examplePayload: { trackId: '…' },
  },
  {
    type: 'audio.listDevices',
    kind: 'agent',
    description: 'Lista backends/dispositivos de audio del host',
    examplePayload: {},
  },
  {
    type: 'audio.getDevice',
    kind: 'agent',
    description: 'Dispositivo de audio actual',
    examplePayload: {},
  },
  {
    type: 'audio.setDevice',
    kind: 'agent',
    description: 'Aplica backend/dispositivo (refleja en proyecto/UI)',
    examplePayload: { backend: 'asio', deviceId: '…', sampleRate: 48000, bufferSize: 512 },
  },
  {
    type: 'audio.ensureBest',
    kind: 'agent',
    description: 'Elige ASIO óptimo (UMC…) o WASAPI y sincroniza UI',
    examplePayload: { preferName: 'UMC' },
  },
]

/** Tipos que executeDawActions entiende (unión útil para list/filter). */
export const KNOWN_AGENT_ACTION_TYPES: string[] = [
  'project.setBpm',
  'project.setTimeSignature',
  'ui.setZoom',
  'track.create',
  'track.delete',
  'track.update',
  'track.toggleMute',
  'track.toggleSolo',
  'track.toggleArm',
  'transport.toggle',
  'transport.stop',
  'transport.toggleLoop',
  'transport.toggleMetronome',
  'transport.toggleRecord',
  'transport.seek',
  'master.update',
  'clip.delete',
  'clip.move',
  'midi.notes.set',
  'midi.clip.create',
  'midi.transpose',
  'midi.quantize',
  'midi.humanize',
  'midi.setVelocity',
  'midi.deleteNotes',
  'midi.createNotes',
  'midi.makeStaccato',
  'midi.makeLegato',
  'midi.repeatPattern',
  'midi.reverse',
  'midi.invert',
  'midi.timeStretch',
  'midi.constrainScale',
  'midi.generatePattern',
  'midi.applyGroove',
  'midi.setCC',
  'midi.setPitchBend',
  'plugin.insert',
  'plugin.remove',
  'plugin.move',
  'plugin.bypass',
  'plugin.duplicate',
  'plugin.replace',
  'plugin.setParameter',
  'fxChain.copy',
  'fxChain.paste',
  'fxChain.loadPreset',
  'fxChain.savePreset',
  'render.start',
  'render.cancel',
  'render.getStatus',
  'analysis.loudness',
  'analysis.compareTarget',
  'analysis.spectrum',
  'analysis.stereo',
  'analysis.fullReport',
  'automation.setCurve',
  'automation.clear',
  'bus.create',
  'send.set',
  'sidechain.connect',
  'track.freeze',
  'track.unfreeze',
  'audio.listDevices',
  'audio.getDevice',
  'audio.setDevice',
  'audio.ensureBest',
  'project.new',
  ...AGENT_ONLY_ACTIONS.map((a) => a.type),
]

export function mergeActionCatalog(
  registryTypes: Array<{ type: string; description?: string; risk?: string }>,
): CatalogEntry[] {
  const byType = new Map<string, CatalogEntry>()
  for (const t of KNOWN_AGENT_ACTION_TYPES) {
    byType.set(t, {
      type: t,
      kind: 'agent',
      description: AGENT_ONLY_ACTIONS.find((a) => a.type === t)?.description ?? t,
      examplePayload: AGENT_ONLY_ACTIONS.find((a) => a.type === t)?.examplePayload,
    })
  }
  for (const r of registryTypes) {
    const prev = byType.get(r.type)
    byType.set(r.type, {
      type: r.type,
      kind: prev ? 'both' : 'command',
      description: r.description || prev?.description || r.type,
      examplePayload: prev?.examplePayload,
    })
  }
  for (const a of AGENT_ONLY_ACTIONS) {
    if (!byType.has(a.type)) byType.set(a.type, a)
    else {
      const cur = byType.get(a.type)!
      byType.set(a.type, {
        ...cur,
        kind: cur.kind === 'command' ? 'both' : cur.kind,
        description: a.description || cur.description,
        examplePayload: a.examplePayload ?? cur.examplePayload,
      })
    }
  }
  return [...byType.values()].sort((a, b) => a.type.localeCompare(b.type))
}
