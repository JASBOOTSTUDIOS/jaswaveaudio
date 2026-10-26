import { PLAN_SLUG, buildReadOnlyProjectContext, getAgentDoc, listAgentDocs, toolRegistry } from '@jaswave/host-sdk'
import type { DAWState, TiendaDAW } from '@jaswave/host-sdk'
import { cargarEspecialistas } from './especialistas-storage'

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
    'El usuario puede invocar a cada especialista mencionándolo en el chat con @nombre (ej. @pianista, @baterista, @bajista, @qa, @director, etc.):',
    ...especialistas.map(
      (e) =>
        `- **@${e.nombre}** (${e.role}${e.instrumento ? ` · ${e.instrumento}` : ''}): ${e.descripcion || ''} | Skills: [${e.skills.join(', ')}]${
          e.instruccionesPersonalizadas ? ` | Reglas personalizadas: "${e.instruccionesPersonalizadas}"` : ''
        }`,
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
          ...knowledgeDocs.map((d) => `### Documento: ${d.title || d.slug} (@${d.slug})\n${d.content.slice(0, 4000)}`),
        ].join('\n\n')
      : ''

  // Catálogo de directrices de estilo musical y análisis
  const skillsGlobalesBlock = [
    '## Catálogo de Skills Musicales y de Producción JasWave',
    '- **Worship Moderno / Íntimo**: Pianos con voicings abiertos (1-5-9 o 1-5-10), arpegios sutiles, pads envolventes con modulación lenta, tempo habitualmente entre 68 y 78 BPM, baterías con bombo redondo y dinámicas en coros, reverbs estéreo largas en envíos.',
    '- **Análisis de Audio (Lens)**: Usa analysis.timing para detectar BPM real y confidence; analysis.buffer para perfil armónico/tonalidad; analysis.mix para balance espectral y headroom. Aplica las configuraciones inmediatamente a project.setBpm y project.setKey.',
    '- **Control de Calidad (QA)**: Comprobación estricta de clipping (True Peak < -0.5 dBTP), coherencia armónica en la escala del tema y ausencia de vacíos o solapes de notas anómalos.',
  ].join('\n')

  return [
    buildReadOnlyProjectContext(state),
    '',
    formatSessionRulesBlock(rules),
    '',
    especialistasBlock,
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
