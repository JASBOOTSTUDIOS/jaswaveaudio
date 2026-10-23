/**
 * Módulos que vienen con JasWave pero son opcionales: cada uno vive en su propio chunk y se puede
 * desactivar desde Módulos. El asistente IA funciona igual en escritorio (gateway de Electron) y en
 * la web (gateway del backend, ver src/lib/ia/transporte-ia.ts).
 */

import { registrarModulo } from './registro-modulos'

let registrados = false

export function registrarModulosIntegrados(): void {
  if (registrados) return
  registrados = true

  registrarModulo({
    id: 'asistente-ia',
    nombre: 'Asistente Jas (IA)',
    descripcion:
      'Coproductor con IA: chat, agente que edita el proyecto con comandos deshacibles, plan.md, docs del proyecto y progreso. En la web usa el servidor de JasWave; en escritorio, tus proveedores.',
    version: '1.0.0',
    herramientas: ['coproducer', 'docs', 'docs-explorer', 'progress'],
    capacidades: ['ia.chat', 'ia.agente', 'ia.plan', 'ia.docs'],
    cargar: async () => {
      const [{ CoProducerPanel }, { AgentDocsPanel }, { DocsExplorerPanel }, { ProgressPanel }] = await Promise.all([
        import('@/components/coproducer-panel'),
        import('@/components/agent-docs-panel'),
        import('@/components/docs-explorer-panel'),
        import('@/components/progress-panel'),
      ])
      return { coproducer: CoProducerPanel, docs: AgentDocsPanel, 'docs-explorer': DocsExplorerPanel, progress: ProgressPanel }
    },
  })

  registrarModulo({
    id: 'partitura',
    nombre: 'Partitura',
    descripcion: 'Editor de partitura sincronizado con el clip MIDI y exportación.',
    version: '1.0.0',
    herramientas: ['score-editor'],
    cargar: async () => ({ 'score-editor': (await import('@/components/score-editor-panel')).ScoreEditorToolPanel }),
  })

  registrarModulo({
    id: 'midi-md',
    nombre: 'MIDI · Markdown',
    descripcion: 'Clip MIDI como documento .md con sincronización en vivo al piano roll (útil para la IA).',
    version: '1.0.0',
    herramientas: ['midi-md'],
    cargar: async () => ({ 'midi-md': (await import('@/components/midi-clip-md-panel')).MidiClipMdPanel }),
  })
}
