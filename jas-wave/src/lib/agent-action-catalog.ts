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
    type: 'analysis.timing',
    kind: 'agent',
    description: 'Diagnóstico sync mix/ASIO (ahead, skew, buffer)',
    examplePayload: {},
  },
  {
    type: 'analysis.buffer',
    kind: 'agent',
    description:
      'Salud del buffer mix→pipe→ring→ASIO: fill, underruns, overflows, cola IPC (saturated/starving/healthy)',
    examplePayload: { sampleMs: 400, reset: true },
  },
  {
    type: 'analysis.fxBlame',
    kind: 'agent',
    description:
      'Aísla qué FX/VST degrada el audio: bypass A/B + buffer/peaks; restaura la cadena al terminar',
    examplePayload: { sampleMs: 350, settleMs: 120, includeInstruments: false },
  },
  {
    type: 'daw.masterPass',
    kind: 'agent',
    description: 'Cadena master + bounce + compareTarget',
    examplePayload: { target: 'streaming' },
  },
  {
    type: 'audio.import',
    kind: 'agent',
    description: 'Importa archivo de audio a pista (crea pista audio si falta trackId)',
    examplePayload: { filePath: 'C:/samples/loop.wav', trackId: '…', inicio: 0 },
  },
  {
    type: 'reference.import',
    kind: 'agent',
    description: 'Importa pista de referencia A/B (muted por defecto)',
    examplePayload: { filePath: 'C:/refs/master.wav' },
  },
  {
    type: 'reference.toggleAB',
    kind: 'agent',
    description: 'Alterna escucha mix vs solo referencia',
    examplePayload: { mode: 'toggle' },
  },
  {
    type: 'midi.notes.get',
    kind: 'agent',
    description: 'Lee notas de un clip MIDI (solo lectura)',
    examplePayload: { clipId: '…', pistaId: '…', limit: 64 },
  },
  {
    type: 'midi.getClipSummary',
    kind: 'agent',
    description: 'Resumen compacto de un clip MIDI',
    examplePayload: { clipId: '…' },
  },
  {
    type: 'midi.notes.dedupe',
    kind: 'agent',
    description: 'Elimina notas duplicadas (mismo pitch+inicio) en un clip',
    examplePayload: { pistaId: '…', clipId: '…' },
  },
  {
    type: 'midi.clip.md.read',
    kind: 'agent',
    description: 'Lee el .md nota-a-nota de un clip (Docs o serializa desde el DAW)',
    examplePayload: { clipId: '…', pistaId: '…' },
  },
  {
    type: 'midi.clip.md.upsert',
    kind: 'agent',
    description: 'Escribe clip-*.md con tabla de notas (preview; no timeline hasta apply)',
    examplePayload: { clipId: '…', pistaId: '…', markdown: '---…', aplicar: false },
  },
  {
    type: 'midi.clip.md.apply',
    kind: 'agent',
    description: 'Aplica el .md del clip al DAW (midi.notes.set / clip.create)',
    examplePayload: { clipId: '…', pistaId: '…' },
  },
  {
    type: 'midi.notes.compare',
    kind: 'agent',
    description: 'Compara dos conjuntos de notas por id (clip vs md, o clipA vs clipB)',
    examplePayload: { clipId: '…', pistaId: '…', otherClipId: '…' },
  },
  {
    type: 'plugin.lookup',
    kind: 'agent',
    description: 'Busca VST en catálogo/web',
    examplePayload: { nombre: 'Serum' },
  },
  {
    type: 'web.search',
    kind: 'agent',
    description: 'Búsqueda web general (DuckDuckGo/Wikipedia) — solo lectura',
    examplePayload: { query: 'sidechain compression technique' },
  },
  {
    type: 'plugin.probe',
    kind: 'agent',
    description: 'Prueba carga de plugin en host',
    examplePayload: { nombre: 'JasWave Roles' },
  },
  {
    type: 'plugin.snapshotState',
    kind: 'agent',
    description: 'Captura chunk/params VST del host al proyecto (todas las pistas o un slot)',
    examplePayload: {},
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
    description: 'Lista presets (scope: project|global|all)',
    examplePayload: { scope: 'all' },
  },
  {
    type: 'library.preset.listGlobal',
    kind: 'agent',
    description: 'Lista presets globales cross-proyecto',
    examplePayload: {},
  },
  {
    type: 'library.preset.search',
    kind: 'agent',
    description: 'Busca presets (scope all por defecto)',
    examplePayload: { query: 'pad', scope: 'all' },
  },
  {
    type: 'library.preset.searchGlobal',
    kind: 'agent',
    description: 'Busca presets globales',
    examplePayload: { query: 'bass' },
  },
  {
    type: 'library.preset.save',
    kind: 'agent',
    description: 'Guarda preset en biblioteca del proyecto',
    examplePayload: { trackId: '…', nombre: 'Mi pad', rol: 'pad' },
  },
  {
    type: 'library.preset.saveGlobal',
    kind: 'agent',
    description: 'Guarda preset en biblioteca global (userData)',
    examplePayload: { trackId: '…', nombre: 'Trap bass', rol: 'bass', generoTags: ['trap'] },
  },
  {
    type: 'library.preset.promote',
    kind: 'agent',
    description: 'Promueve preset de proyecto a global',
    examplePayload: { presetId: '…' },
  },
  {
    type: 'library.preset.apply',
    kind: 'agent',
    description: 'Aplica preset (global o proyecto) a pista',
    examplePayload: { presetId: '…', trackId: '…' },
  },
  {
    type: 'library.preset.audition',
    kind: 'agent',
    description: 'Audiciona preset',
    examplePayload: { presetId: '…', bars: 2 },
  },
  {
    type: 'library.preset.saveFxChainGlobal',
    kind: 'agent',
    description: 'Guarda cadena FX completa en biblioteca global',
    examplePayload: { trackId: '…', nombre: 'Vocal chain' },
  },
  {
    type: 'style.profile.list',
    kind: 'agent',
    description: 'Lista perfiles de estilo (scope: project|global|all)',
    examplePayload: { scope: 'all' },
  },
  {
    type: 'style.profile.search',
    kind: 'agent',
    description: 'Busca perfiles de estilo por query/rol/tag',
    examplePayload: { query: 'worship', rol: 'drums', scope: 'all' },
  },
  {
    type: 'style.profile.saveFromClip',
    kind: 'agent',
    description: 'Extrae StyleProfile del clip MIDI (sin embeber notas) y lo guarda',
    examplePayload: { pistaId: '…', clipId: '…', nombre: 'Mi groove', tags: ['worship'], global: false },
  },
  {
    type: 'style.profile.apply',
    kind: 'agent',
    description: 'Aplica priors del perfil al clip (genera variación, no copia MIDI origen)',
    examplePayload: { profileId: '…', pistaId: '…', clipId: '…', replace: true },
  },
  {
    type: 'score.exportClip',
    kind: 'agent',
    description: 'Exporta partitura PDF del clip MIDI (diálogo o ruta)',
    examplePayload: { pistaId: '…', clipId: '…' },
  },
  {
    type: 'score.exportProject',
    kind: 'agent',
    description: 'Exporta un PDF por cada clip MIDI a una carpeta (scores/)',
    examplePayload: { folderPath: '…', includeProject: false },
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
  {
    type: 'audio.armNative',
    kind: 'agent',
    description: 'Arma clips/Roles → pipe → ASIO (sync nativo)',
    examplePayload: {},
  },
  {
    type: 'audio.clearQuarantine',
    kind: 'agent',
    description: 'Limpia VST aislados tras crash del host y restaura ASIO + mix',
    examplePayload: {},
  },
]

/** Tipos que executeDawActions entiende (unión útil para list/filter). */
export const KNOWN_AGENT_ACTION_TYPES: string[] = [
  'project.setBpm',
  'project.setTimeSignature',
  'ui.setZoom',
  'track.create',
  'track.delete',
  'track.move',
  'track.update',
  'track.toggleMute',
  'track.toggleSolo',
  'track.toggleArm',
  'transport.toggle',
  'transport.stop',
  'transport.toggleLoop',
  'transport.toggleMetronome',
  'transport.toggleRecord',
  'transport.togglePunch',
  'transport.toggleCountIn',
  'transport.seek',
  'master.update',
  'clip.create',
  'clip.split',
  'clip.merge',
  'midi.clip.splitIntoSections',
  'clip.resize',
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
  'midi.notes.dedupe',
  'midi.clip.md.apply',
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
  'analysis.timing',
  'analysis.buffer',
  'analysis.fxBlame',
  'automation.setCurve',
  'automation.writePoint',
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
  'audio.armNative',
  'audio.clearQuarantine',
  'project.new',
  'project.update',
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
