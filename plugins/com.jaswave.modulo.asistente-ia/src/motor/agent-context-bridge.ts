import { PLAN_SLUG, buildReadOnlyProjectContext, getAgentDoc, listAgentDocs, toolRegistry } from '@jaswave/host-sdk'
import type { DAWState, TiendaDAW } from '@jaswave/host-sdk'
import { cargarEspecialistas, type EspecialistaConfig } from './especialistas-storage'
import { instruccionesHabilidadesEspecialista } from './especialistas-habilidades'

/** Habilidades ejecutables del especialista: instrucciones numeradas compactas (para modelos pequeños). */
function habilidadesBlock(e: EspecialistaConfig): string {
  const txt = instruccionesHabilidadesEspecialista(e)
  return txt ? `\n  Habilidades ejecutables de @${e.nombre}:\n${txt.replace(/^/gm, '    ')}` : ''
}

/** Máximo por documento en el prompt: conserva el inicio (contexto) y el FINAL (donde se añaden las reglas nuevas). */
const MAX_DOC_PROMPT = 4000
const CABECERA_DOC_PROMPT = 1200
function recortarDocParaPrompt(contenido: string): string {
  if (contenido.length <= MAX_DOC_PROMPT) return contenido
  const resto = MAX_DOC_PROMPT - CABECERA_DOC_PROMPT
  return `${contenido.slice(0, CABECERA_DOC_PROMPT).trimEnd()}\n[… recortado …]\n${contenido.slice(-resto).trimStart()}`
}

export type SessionRules = {
  genre?: string
  targetLufs?: number
  allowedPlugins?: string[]
  notes?: string
}

const SESSION_RULES_KEY = 'jaswave.sessionRules'

export function loadSessionRules(projectId: string): SessionRules {
  try {
    const raw = localStorage.getItem(`${SESSION_RULES_KEY}:${projectId}`)
    return raw ? (JSON.parse(raw) as SessionRules) : {}
  } catch {
    return {}
  }
}

export function saveSessionRules(projectId: string, rules: SessionRules): void {
  localStorage.setItem(`${SESSION_RULES_KEY}:${projectId}`, JSON.stringify(rules))
}

export function formatSessionRulesBlock(rules: SessionRules): string {
  const lines: string[] = []
  if (rules.genre) lines.push(`- Género objetivo: ${rules.genre}`)
  if (typeof rules.targetLufs === 'number') lines.push(`- Target LUFS: ${rules.targetLufs}`)
  if (rules.allowedPlugins?.length) lines.push(`- Plugins permitidos: ${rules.allowedPlugins.join(', ')}`)
  if (rules.notes) lines.push(`- Notas: ${rules.notes}`)
  return lines.length ? ['## Reglas de sesión', ...lines].join('\n') : ''
}

export function startCoproducerSession(tienda: TiendaDAW): void {
  tienda.iniciarSesionIA()
}

export function endCoproducerSession(tienda: TiendaDAW): void {
  tienda.finalizarSesionIA()
}

export function buildAssembledAgentContext(
  tienda: TiendaDAW,
  state: DAWState,
  userText: string,
  chatTurns: Array<{ role: 'user' | 'assistant'; content: string }>,
  libraryPresetsBlock?: string,
): string {
  const projectId = state.project?.id ?? 'default'
  const plan = getAgentDoc(projectId, PLAN_SLUG)
  const rules = loadSessionRules(projectId)

  // Combinar herramientas del registro de comandos con el toolRegistry completo (analysis.*, audioLens, plugin.*, etc.)
  const commandTools = tienda.registroComandos.list().map((c) => ({
    type: c.type,
    category: 'system' as const,
    description: c.description,
    risk: c.risk,
  }))
  const registryTools = (toolRegistry?.list ? toolRegistry.list() : []).map((t: any) => ({
    type: t.name || t.type,
    category: (t.category || 'ai') as any,
    description: t.description || '',
    risk: 'read' as const,
  }))
  const allKnownTools = [...registryTools, ...commandTools]
  const deduplicatedToolsMap = new Map<string, typeof allKnownTools[0]>()
  for (const t of allKnownTools) {
    if (!deduplicatedToolsMap.has(t.type)) deduplicatedToolsMap.set(t.type, t)
  }
  const toolsToSend = Array.from(deduplicatedToolsMap.values())

  const selectedId = state.selection?.idsPistas?.[0]
  const assembled = tienda.ensamblarContexto(
    {
      userIntent: userText,
      selectedTrackId: selectedId,
      selectedClipId: state.selection?.idsClips?.[0],
    },
    chatTurns.slice(-12).map((m, i) => ({
      role: m.role,
      content: m.content,
      marcaTiempo: Date.now() - (chatTurns.length - i) * 1000,
    })),
    toolsToSend,
  )

  const memoryBlock =
    assembled.contextWindow.level4_sessionMemory.length > 0
      ? [
          '## Memoria de sesión',
          ...assembled.contextWindow.level4_sessionMemory.slice(0, 8).map((m) => `- ${m.content}`),
        ].join('\n')
      : ''

  // Especialistas activos y músicos
  const especialistas = cargarEspecialistas().filter((e) => e.activo)
  const especialistasBlock = [
    '## Equipo de Especialistas y Músicos Virtuales Disponibles',
    'El usuario puede invocar a cada especialista mencionándolo en el chat con @nombre (ej. @pianista, @guitarrista, @baterista, @bajista, @qa, @director, etc.):',
    ...especialistas.map(
      (e) =>
        `- **@${e.nombre}** (${e.role}${e.instrumento ? ` · ${e.instrumento}` : ''}): ${e.descripcion || ''} | Skills: [${e.skills.join(', ')}]${
          e.instruccionesPersonalizadas ? ` | Reglas personalizadas: "${e.instruccionesPersonalizadas}"` : ''
        }${habilidadesBlock(e)}`,
    ),
  ].join('\n')

  // Base de conocimientos Markdown del proyecto
  let allDocs: Array<{ slug: string; title?: string; content: string }> = []
  try {
    allDocs = listAgentDocs(projectId)
  } catch {
    /* ignore */
  }
  const knowledgeDocs = allDocs.filter((d) => d.slug !== PLAN_SLUG && d.content?.trim())
  const knowledgeBlock =
    knowledgeDocs.length > 0
      ? [
          '## Base de Conocimientos Markdown (.md) del Proyecto',
          'El usuario ha creado o incorporado estos documentos de referencia técnica y musical. Úsalos como fuentes de verdad para tus respuestas y ejecución:',
          ...knowledgeDocs.map((d) => `### Documento: ${d.title || d.slug} (@${d.slug})\n${recortarDocParaPrompt(d.content)}`),
        ].join('\n\n')
      : ''

  // Catálogo de directrices de estilo musical y análisis
  const skillsGlobalesBlock = [
    '## Catálogo de Skills Musicales y de Producción JasWave',
    '- **Worship Moderno / Íntimo**: Pianos con voicings abiertos (1-5-9 o 1-5-10), arpegios sutiles, pads envolventes con modulación lenta, tempo habitualmente entre 68 y 78 BPM, baterías con bombo redondo y dinámicas en coros, reverbs estéreo largas en envíos.',
    '- **Análisis de Audio (Lens)**: Usa analysis.timing para detectar BPM real y confidence; analysis.buffer para perfil armónico/tonalidad; analysis.mix para balance espectral y headroom. Aplica las configuraciones inmediatamente a project.setBpm y project.setKey.',
    '- **Control de Calidad (QA)**: Comprobación estricta de clipping (True Peak ≤ -1.0 dBTP), coherencia armónica en la escala del tema y ausencia de vacíos o solapes de notas anómalos.',
  ].join('\n')

  // Inspección profunda de FX y Plugins de la pista seleccionada y del proyecto
  const fxInspectionLines: string[] = ['## Cadena de Plugins y Efectos (FX Chain) del Proyecto']
  for (const track of state.project?.tracks ?? []) {
    const isSelected = track.id === selectedId
    const plugins = track.plugins ?? []
    if (plugins.length > 0 || isSelected) {
      const plugDesc =
        plugins.length > 0
          ? plugins.map((p, idx) => `${idx + 1}. ${p.nombre} (id: ${p.id}, tipo: ${p.tipo}${p.bypass ? ', BYPASS' : ''})`).join(' -> ')
          : '(sin plugins todavía)'
      fxInspectionLines.push(`- Pista «${track.nombre}» [${track.tipo}] id=${track.id}${isSelected ? ' ← SELECCIONADA' : ''}: ${plugDesc}`)
    }
  }
  if (state.project?.master?.plugins?.length) {
    const masterPlugs = state.project.master.plugins.map((p, idx) => `${idx + 1}. ${p.nombre} (id: ${p.id})`).join(' -> ')
    fxInspectionLines.push(`- Master FX Chain: ${masterPlugs}`)
  }
  const fxInspectionBlock = fxInspectionLines.length > 1 ? fxInspectionLines.join('\n') : ''

  const specialistFxDirectives = [
    '## Directiva de Especialistas: Inspección y Gestión de Plugins (FX Chain)',
    'Los especialistas activos listados arriba pueden proponer cambios en la cadena de efectos. Cada cambio se ejecuta con un comando (con undo) y respeta la autonomía del usuario; los plugins de otros fabricantes o por ruta requieren confirmación.',
    '- **Inspección**: revisa la FX chain de la pista (bloque anterior; las posiciones se numeran desde 1, los comandos usan índice desde 0) antes de actuar.',
    '- **Añadir (`plugin.insert`)** solo plugins del catálogo: JasWave Param EQ, Bus Compressor, Smart De-esser, Ambience (reverb/espacio), TruePeak Limiter, Utility. Para guitarra, bajo, piano, cuerdas, pad y batería el instrumento ya incluye su propio procesado (amp/cab/delay, drive, reverb de sala…): ajústalo con `plugin.setParameter` en lugar de añadir otro.',
    '- **Retirar o silenciar (`plugin.remove` / `plugin.bypass`)**: solo lo redundante o que ensucia la mezcla (p. ej. reverbs largas en bombo o bajo).',
    '- **Ajuste fino (`plugin.setParameter`)**: valores normalizados entre 0 y 1; lee antes los parámetros con `plugin.listParameters`.',
  ].join('\n')

  return [
    buildReadOnlyProjectContext(state),
    '',
    formatSessionRulesBlock(rules),
    '',
    especialistasBlock,
    '',
    specialistFxDirectives,
    '',
    fxInspectionBlock,
    '',
    skillsGlobalesBlock,
    '',
    knowledgeBlock,
    '',
    libraryPresetsBlock
      ? `## Biblioteca de presets (global + proyecto)\nUsa presetId en Music Build; preferir sobre plugin.setParameter.\n${libraryPresetsBlock}`
      : '',
    plan?.content ? `## plan.md (fuente de verdad)\n${plan.content.slice(0, 8000)}` : '',
    '',
    memoryBlock,
    '',
    '## Capabilities',
    assembled.capabilitiesPrompt,
  ]
    .filter(Boolean)
    .join('\n')
}
